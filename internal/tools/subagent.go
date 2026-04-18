package tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	subagentMaxActive        = 5
	subagentDefaultWaitSec   = 300
	subagentMaxWaitSec       = 1800
	subagentWaitPollInterval = 500 * time.Millisecond
)

func (e *Executor) subagentSpawn(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		AgentID        string `json:"agent_id"`
		Task           string `json:"task"`
		SeedWorkspace  bool   `json:"seed_workspace"`
		MaxSteps       int    `json:"max_steps"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	req.AgentID = strings.TrimSpace(req.AgentID)
	req.Task = strings.TrimSpace(req.Task)
	if req.AgentID == "" {
		return Result{}, fmt.Errorf("agent_id required")
	}
	if req.Task == "" {
		return Result{}, fmt.Errorf("task required")
	}
	if e.DB == nil {
		return Result{}, fmt.Errorf("subagent.spawn requires a database")
	}

	var active int
	if err := e.DB.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM runs WHERE parent_run_id=? AND status IN ('queued','running','interrupted')`,
		runCtx.RunID).Scan(&active); err != nil {
		return Result{}, err
	}
	if active >= subagentMaxActive {
		return Result{}, fmt.Errorf("subagent cap reached (%d active children for this run)", active)
	}

	var provider, model string
	var defaultMaxSteps int
	var defaultWorkspacePath string
	err := e.DB.QueryRowContext(ctx,
		`SELECT provider, model, default_max_steps, default_workspace_path FROM agents WHERE id=?`,
		req.AgentID).Scan(&provider, &model, &defaultMaxSteps, &defaultWorkspacePath)
	if err == sql.ErrNoRows {
		return Result{}, fmt.Errorf("agent not found: %s", req.AgentID)
	}
	if err != nil {
		return Result{}, err
	}
	maxSteps := req.MaxSteps
	if maxSteps <= 0 {
		maxSteps = defaultMaxSteps
	}
	if maxSteps <= 0 {
		maxSteps = 30
	}

	childID := uuid.NewString()
	childWorkspace := deriveChildWorkspace(runCtx.Workspace, childID)
	if err := os.MkdirAll(childWorkspace, 0o755); err != nil {
		return Result{}, fmt.Errorf("create subagent workspace: %w", err)
	}
	if req.SeedWorkspace {
		if err := copyDirShallow(runCtx.Workspace, childWorkspace); err != nil {
			return Result{}, fmt.Errorf("seed subagent workspace: %w", err)
		}
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = e.DB.ExecContext(ctx, `
		INSERT INTO runs(
		  id, agent_id, status, task, workspace_path, provider, model, max_steps,
		  parent_run_id, replay_source_run_id, replay_from_step,
		  environment_id, credential_vault_id,
		  output_contract_type, output_contract_payload,
		  created_at, updated_at
		)
		VALUES(?, ?, 'queued', ?, ?, ?, ?, ?, ?, '', 1, ?, ?, 'none', '', ?, ?)
	`, childID, req.AgentID, req.Task, childWorkspace, provider, model, maxSteps,
		runCtx.RunID, runCtx.EnvironmentID, runCtx.CredentialVaultID, now, now)
	if err != nil {
		return Result{}, err
	}
	_, _ = e.DB.ExecContext(ctx,
		`INSERT INTO events(id, run_id, event_type, seq, payload_json, created_at) VALUES(?, ?, 'run.created', 1, ?, ?)`,
		uuid.NewString(), childID, fmt.Sprintf(`{"status":"queued","parent_run_id":%q}`, runCtx.RunID), now)

	return Result{Output: map[string]any{
		"run_id":         childID,
		"status":         "queued",
		"workspace_path": childWorkspace,
		"agent_id":       req.AgentID,
		"parent_run_id":  runCtx.RunID,
	}}, nil
}

func (e *Executor) subagentStatus(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		RunID string `json:"run_id"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	out, err := e.loadSubagentStatus(ctx, runCtx.RunID, strings.TrimSpace(req.RunID))
	if err != nil {
		return Result{}, err
	}
	return Result{Output: out}, nil
}

func (e *Executor) subagentWait(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		RunID          string `json:"run_id"`
		TimeoutSeconds int    `json:"timeout_seconds"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	childID := strings.TrimSpace(req.RunID)
	if childID == "" {
		return Result{}, fmt.Errorf("run_id required")
	}
	timeout := req.TimeoutSeconds
	if timeout <= 0 {
		timeout = subagentDefaultWaitSec
	}
	if timeout > subagentMaxWaitSec {
		timeout = subagentMaxWaitSec
	}
	deadline := time.Now().Add(time.Duration(timeout) * time.Second)
	for {
		out, err := e.loadSubagentStatus(ctx, runCtx.RunID, childID)
		if err != nil {
			return Result{}, err
		}
		status, _ := out["status"].(string)
		switch status {
		case "completed", "failed", "cancelled", "interrupted":
			return Result{Output: out}, nil
		}
		if time.Now().After(deadline) {
			out["timed_out"] = true
			return Result{Output: out}, nil
		}
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case <-time.After(subagentWaitPollInterval):
		}
	}
}

func (e *Executor) loadSubagentStatus(ctx context.Context, parentRunID, childID string) (map[string]any, error) {
	if childID == "" {
		return nil, fmt.Errorf("run_id required")
	}
	if e.DB == nil {
		return nil, fmt.Errorf("database not configured")
	}
	var parent, status, task, errText string
	var startedAt, completedAt sql.NullString
	err := e.DB.QueryRowContext(ctx, `
		SELECT parent_run_id, status, task, COALESCE(error,''), started_at, completed_at
		FROM runs WHERE id=?
	`, childID).Scan(&parent, &status, &task, &errText, &startedAt, &completedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("subagent run not found: %s", childID)
	}
	if err != nil {
		return nil, err
	}
	if parent != parentRunID {
		return nil, fmt.Errorf("run %s is not a subagent of this run", childID)
	}
	out := map[string]any{
		"run_id":        childID,
		"parent_run_id": parent,
		"status":        status,
		"task":          task,
	}
	if errText != "" {
		out["error"] = errText
	}
	if startedAt.Valid {
		out["started_at"] = startedAt.String
	}
	if completedAt.Valid {
		out["completed_at"] = completedAt.String
	}
	if status == "completed" || status == "failed" {
		if text := e.subagentFinalText(ctx, childID); text != "" {
			out["assistant_text"] = text
		}
	}
	return out, nil
}

func (e *Executor) subagentFinalText(ctx context.Context, childID string) string {
	var outputJSON string
	err := e.DB.QueryRowContext(ctx, `
		SELECT output_json FROM run_steps
		WHERE run_id=? AND step_type='model'
		ORDER BY idx DESC LIMIT 1
	`, childID).Scan(&outputJSON)
	if err != nil {
		return ""
	}
	var payload struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal([]byte(outputJSON), &payload)
	return strings.TrimSpace(payload.Text)
}

func deriveChildWorkspace(parentWorkspace, childID string) string {
	parent := strings.TrimSpace(parentWorkspace)
	if parent == "" {
		parent = os.TempDir()
	}
	return filepath.Join(parent, ".colosseum", "subagents", childID)
}

func copyDirShallow(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == ".colosseum" || entry.Name() == ".git" {
			continue
		}
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			if err := os.MkdirAll(dstPath, 0o755); err != nil {
				return err
			}
			if err := copyDirShallow(srcPath, dstPath); err != nil {
				return err
			}
			continue
		}
		data, err := os.ReadFile(srcPath)
		if err != nil {
			return err
		}
		if err := os.WriteFile(dstPath, data, 0o644); err != nil {
			return err
		}
	}
	return nil
}
