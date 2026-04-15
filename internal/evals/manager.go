package evals

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Manager struct {
	DB            *sql.DB
	WorkspaceRoot string
	wg            sync.WaitGroup
}

func NewManager(db *sql.DB, workspaceRoot string) *Manager {
	return &Manager{DB: db, WorkspaceRoot: workspaceRoot}
}

func (m *Manager) Start(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.processOne(ctx)
		}
	}
}

func (m *Manager) Wait() { m.wg.Wait() }

func (m *Manager) processOne(ctx context.Context) {
	var evalRunID, suiteID string
	var provider, model string
	var maxSteps int
	err := m.DB.QueryRowContext(ctx, `SELECT id,suite_id,provider,model,max_steps FROM eval_runs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`).
		Scan(&evalRunID, &suiteID, &provider, &model, &maxSteps)
	if err == sql.ErrNoRows {
		return
	}
	if err != nil {
		return
	}
	res, err := m.DB.ExecContext(ctx, `UPDATE eval_runs SET status='running', started_at=?, error='' WHERE id=? AND status='queued'`, now(), evalRunID)
	if err != nil {
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return
	}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		_ = m.executeEvalRun(ctx, evalRunID, suiteID, provider, model, maxSteps)
	}()
}

func (m *Manager) executeEvalRun(ctx context.Context, evalRunID, suiteID, provider, model string, maxSteps int) error {
	if maxSteps <= 0 {
		maxSteps = 30
	}
	var suiteAgentID string
	if err := m.DB.QueryRowContext(ctx, `SELECT agent_id FROM eval_suites WHERE id=?`, suiteID).Scan(&suiteAgentID); err != nil {
		return m.failEvalRun(ctx, evalRunID, err)
	}
	var defaultProvider, defaultModel string
	if err := m.DB.QueryRowContext(ctx, `SELECT provider, model FROM agents WHERE id=?`, suiteAgentID).Scan(&defaultProvider, &defaultModel); err != nil {
		return m.failEvalRun(ctx, evalRunID, err)
	}
	if provider == "" {
		provider = defaultProvider
	}
	if model == "" {
		model = defaultModel
	}

	type evalCase struct {
		ID        string
		Name      string
		Task      string
		Assertion string
	}
	rows, err := m.DB.QueryContext(ctx, `SELECT id,name,task,assertion_json FROM eval_cases WHERE suite_id=? ORDER BY position ASC, created_at ASC`, suiteID)
	if err != nil {
		return m.failEvalRun(ctx, evalRunID, err)
	}
	defer rows.Close()
	cases := make([]evalCase, 0)
	for rows.Next() {
		var c evalCase
		if err := rows.Scan(&c.ID, &c.Name, &c.Task, &c.Assertion); err != nil {
			return m.failEvalRun(ctx, evalRunID, err)
		}
		cases = append(cases, c)
	}
	_, _ = m.DB.ExecContext(ctx, `UPDATE eval_runs SET total_cases=? WHERE id=?`, len(cases), evalRunID)

	passed := 0
	failed := 0
	type caseSummary struct {
		CaseID       string  `json:"case_id"`
		CaseName     string  `json:"case_name"`
		RunID        string  `json:"run_id"`
		Status       string  `json:"status"`
		Score        float64 `json:"score"`
		LatencyMs    int64   `json:"latency_ms"`
		InputTokens  int     `json:"input_tokens"`
		OutputTokens int     `json:"output_tokens"`
	}
	summaries := make([]caseSummary, 0, len(cases))

	for _, c := range cases {
		select {
		case <-ctx.Done():
			return m.failEvalRun(context.Background(), evalRunID, ctx.Err())
		default:
		}
		runID := uuid.NewString()
		workspacePath := filepath.Join(m.WorkspaceRoot, runID)
		if err := os.MkdirAll(workspacePath, 0o755); err != nil {
			return m.failEvalRun(ctx, evalRunID, err)
		}
		nowTS := now()
		_, err := m.DB.ExecContext(ctx, `
			INSERT INTO runs(id,agent_id,status,task,workspace_path,provider,model,max_steps,replay_source_run_id,replay_from_step,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
		`, runID, suiteAgentID, "queued", c.Task, workspacePath, provider, model, maxSteps, "", 1, nowTS, nowTS)
		if err != nil {
			return m.failEvalRun(ctx, evalRunID, err)
		}
		_, _ = m.DB.ExecContext(ctx, `INSERT INTO events(id,run_id,event_type,seq,payload_json,created_at) VALUES(?,?,?,?,?,?)`, uuid.NewString(), runID, "run.created", 1, `{"status":"queued","eval":true}`, nowTS)

		outcome, waitErr := m.waitRunOutcome(ctx, runID, 20*time.Minute)
		caseStatus := "failed"
		caseScore := 0.0
		checks := make([]map[string]any, 0)
		excerpt := ""
		caseErr := ""
		if waitErr != nil {
			caseErr = waitErr.Error()
		} else {
			excerpt = truncate(outcome.ResultText, 350)
			caseStatus, caseScore, checks = scoreOutcome(outcome, c.Assertion)
		}
		if caseStatus == "passed" {
			passed++
		} else {
			failed++
		}
		checksJSON, _ := json.Marshal(checks)
		_, _ = m.DB.ExecContext(context.Background(), `
			INSERT INTO eval_case_runs(id,eval_run_id,suite_id,case_id,run_id,status,score,latency_ms,input_tokens,output_tokens,result_excerpt,checks_json,error,created_at,completed_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		`, uuid.NewString(), evalRunID, suiteID, c.ID, runID, caseStatus, caseScore, outcome.LatencyMs, outcome.InputTokens, outcome.OutputTokens, excerpt, string(checksJSON), caseErr, now(), now())
		summaries = append(summaries, caseSummary{
			CaseID: c.ID, CaseName: c.Name, RunID: runID, Status: caseStatus, Score: caseScore,
			LatencyMs: outcome.LatencyMs, InputTokens: outcome.InputTokens, OutputTokens: outcome.OutputTokens,
		})
	}

	summaryJSON, _ := json.Marshal(map[string]any{
		"pass_rate":    passRate(passed, len(cases)),
		"cases":        summaries,
		"provider":     provider,
		"model":        model,
		"total_cases":  len(cases),
		"passed_cases": passed,
		"failed_cases": failed,
		"completed_at": now(),
	})
	_, _ = m.DB.ExecContext(context.Background(), `
		UPDATE eval_runs SET status='completed', passed_cases=?, failed_cases=?, completed_at=?, summary_json=?, error=''
		WHERE id=?
	`, passed, failed, now(), string(summaryJSON), evalRunID)
	return nil
}

type runOutcome struct {
	Status       string
	Error        string
	ResultText   string
	LatencyMs    int64
	InputTokens  int
	OutputTokens int
}

func (m *Manager) waitRunOutcome(ctx context.Context, runID string, timeout time.Duration) (runOutcome, error) {
	deadline := time.Now().Add(timeout)
	for {
		if ctx.Err() != nil {
			return runOutcome{}, ctx.Err()
		}
		out, done, err := m.fetchRunOutcome(ctx, runID)
		if err != nil {
			return runOutcome{}, err
		}
		if done {
			return out, nil
		}
		if time.Now().After(deadline) {
			return runOutcome{}, fmt.Errorf("eval case timed out waiting for run %s", runID)
		}
		time.Sleep(1200 * time.Millisecond)
	}
}

func (m *Manager) fetchRunOutcome(ctx context.Context, runID string) (runOutcome, bool, error) {
	var status, runErr string
	var startedAt, completedAt sql.NullString
	err := m.DB.QueryRowContext(ctx, `SELECT status,error,started_at,completed_at FROM runs WHERE id=?`, runID).Scan(&status, &runErr, &startedAt, &completedAt)
	if err != nil {
		return runOutcome{}, false, err
	}
	out := runOutcome{Status: status, Error: runErr}
	s := parseTime(startedAt.String)
	e := parseTime(completedAt.String)
	if !e.IsZero() && !s.IsZero() && e.After(s) {
		out.LatencyMs = e.Sub(s).Milliseconds()
	}
	rows, err := m.DB.QueryContext(ctx, `SELECT event_type,payload_json FROM events WHERE run_id=? ORDER BY seq ASC`, runID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var typ, payload string
			if err := rows.Scan(&typ, &payload); err != nil {
				continue
			}
			var parsed map[string]any
			_ = json.Unmarshal([]byte(payload), &parsed)
			if typ == "run.completed" && out.ResultText == "" {
				if v, ok := parsed["result"].(string); ok {
					out.ResultText = v
				}
			}
			if typ == "model.response" {
				if usage, ok := parsed["usage"].(map[string]any); ok {
					out.InputTokens += int(number(usage["input_tokens"]))
					out.OutputTokens += int(number(usage["output_tokens"]))
				}
				if out.ResultText == "" {
					if txt, ok := parsed["text"].(string); ok && strings.TrimSpace(txt) != "" {
						out.ResultText = txt
					}
				}
			}
		}
	}
	done := status == "completed" || status == "failed" || status == "cancelled"
	return out, done, nil
}

func scoreOutcome(out runOutcome, assertionJSON string) (string, float64, []map[string]any) {
	var assertion struct {
		ContainsAll   []string `json:"contains_all"`
		NotContains   []string `json:"not_contains"`
		MaxDurationMs int64    `json:"max_duration_ms"`
	}
	_ = json.Unmarshal([]byte(assertionJSON), &assertion)

	checks := make([]map[string]any, 0)
	total := 0
	passed := 0
	lowerResult := strings.ToLower(out.ResultText)

	for _, want := range assertion.ContainsAll {
		total++
		ok := strings.Contains(lowerResult, strings.ToLower(strings.TrimSpace(want)))
		if ok {
			passed++
		}
		checks = append(checks, map[string]any{"type": "contains_all", "value": want, "passed": ok})
	}
	for _, avoid := range assertion.NotContains {
		total++
		ok := !strings.Contains(lowerResult, strings.ToLower(strings.TrimSpace(avoid)))
		if ok {
			passed++
		}
		checks = append(checks, map[string]any{"type": "not_contains", "value": avoid, "passed": ok})
	}
	if assertion.MaxDurationMs > 0 {
		total++
		ok := out.LatencyMs > 0 && out.LatencyMs <= assertion.MaxDurationMs
		if ok {
			passed++
		}
		checks = append(checks, map[string]any{"type": "max_duration_ms", "value": assertion.MaxDurationMs, "actual": out.LatencyMs, "passed": ok})
	}
	if total == 0 {
		total = 1
		if out.Status == "completed" {
			passed = 1
		}
		checks = append(checks, map[string]any{"type": "completed", "passed": out.Status == "completed"})
	}
	score := float64(passed) / float64(total)
	status := "failed"
	if score >= 0.999 {
		status = "passed"
	}
	if out.Status != "completed" {
		status = "failed"
		score = 0
		checks = append(checks, map[string]any{"type": "run_status", "value": out.Status, "passed": false, "error": out.Error})
	}
	return status, score, checks
}

func (m *Manager) failEvalRun(ctx context.Context, evalRunID string, err error) error {
	_, _ = m.DB.ExecContext(context.Background(), `UPDATE eval_runs SET status='failed', completed_at=?, error=? WHERE id=?`, now(), err.Error(), evalRunID)
	return err
}

func number(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	default:
		return 0
	}
}

func passRate(passed, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(passed) / float64(total)
}

func truncate(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max]
}

func parseTime(v string) time.Time {
	if strings.TrimSpace(v) == "" {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339Nano, v)
	return t
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
