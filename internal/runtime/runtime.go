package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/adevireddy/colosseum/internal/policy"
	"github.com/adevireddy/colosseum/internal/providers"
	"github.com/adevireddy/colosseum/internal/tools"
	"github.com/google/uuid"
)

type SessionStore interface {
	AppendEvent(ctx context.Context, runID, stepID, eventType string, payload map[string]any) error
	GetEvents(ctx context.Context, runID string, afterSeq, limit int) ([]map[string]any, error)
	GetCheckpoint(ctx context.Context, runID string) (int, error)
}

type DBSessionStore struct{ DB *sql.DB }

func (s *DBSessionStore) AppendEvent(ctx context.Context, runID, stepID, eventType string, payload map[string]any) error {
	seq, err := s.GetCheckpoint(ctx, runID)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(payload)
	_, err = s.DB.ExecContext(ctx, `INSERT INTO events(id,run_id,step_id,event_type,seq,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`, uuid.NewString(), runID, stepID, eventType, seq+1, string(body), time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func (s *DBSessionStore) GetEvents(ctx context.Context, runID string, afterSeq, limit int) ([]map[string]any, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id,step_id,event_type,seq,payload_json,created_at FROM events WHERE run_id=? AND seq>? ORDER BY seq ASC LIMIT ?`, runID, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var id, stepID, typ, payload, created string
		var seq int
		if err := rows.Scan(&id, &stepID, &typ, &seq, &payload, &created); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "step_id": stepID, "event_type": typ, "seq": seq, "payload": json.RawMessage(payload), "created_at": created})
	}
	return out, nil
}

func (s *DBSessionStore) GetCheckpoint(ctx context.Context, runID string) (int, error) {
	var max int
	if err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq),0) FROM events WHERE run_id=?`, runID).Scan(&max); err != nil {
		return 0, err
	}
	return max, nil
}

type Manager struct {
	DB        *sql.DB
	Store     SessionStore
	Providers map[string]providers.Client
	Tools     *tools.Executor
	wg        sync.WaitGroup
}

func NewManager(db *sql.DB, providerMap map[string]providers.Client, toolExec *tools.Executor) *Manager {
	return &Manager{DB: db, Store: &DBSessionStore{DB: db}, Providers: providerMap, Tools: toolExec}
}

func (m *Manager) Start(ctx context.Context) {
	_ = m.RecoverInFlight(ctx)
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

func (m *Manager) RecoverInFlight(ctx context.Context) error {
	_, err := m.DB.ExecContext(ctx, `UPDATE runs SET status='queued', updated_at=? WHERE status='running'`, now())
	return err
}

// Wake allows any stateless harness instance to reattach to a run.
func (m *Manager) Wake(ctx context.Context, sessionID string) error {
	var count int
	if err := m.DB.QueryRowContext(ctx, `SELECT COUNT(1) FROM runs WHERE id=?`, sessionID).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return fmt.Errorf("run not found: %s", sessionID)
	}
	return nil
}

func (m *Manager) Interrupt(ctx context.Context, sessionID string) error {
	_, err := m.DB.ExecContext(ctx, `UPDATE runs SET status='interrupted', updated_at=? WHERE id=?`, now(), sessionID)
	return err
}

func (m *Manager) Resume(ctx context.Context, sessionID string) error {
	_, err := m.DB.ExecContext(ctx, `UPDATE runs SET status='queued', updated_at=? WHERE id=?`, now(), sessionID)
	return err
}

func (m *Manager) processOne(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	var runID, agentID, task, workspace, providerName, model string
	var maxSteps int
	err := m.DB.QueryRowContext(ctx, `SELECT id,agent_id,task,workspace_path,provider,model,max_steps FROM runs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`).Scan(&runID, &agentID, &task, &workspace, &providerName, &model, &maxSteps)
	if err == sql.ErrNoRows {
		return
	}
	if err != nil {
		log.Printf("runtime query queued run failed: %v", err)
		return
	}
	if _, err := m.DB.ExecContext(ctx, `UPDATE runs SET status='running', started_at=?, updated_at=? WHERE id=? AND status='queued'`, now(), now(), runID); err != nil {
		log.Printf("runtime claim run failed: %v", err)
		return
	}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		if err := m.run(ctx, runID, agentID, task, workspace, providerName, model, maxSteps); err != nil && ctx.Err() == nil {
			log.Printf("run %s failed: %v", runID, err)
		}
	}()
}

func (m *Manager) run(ctx context.Context, runID, agentID, task, workspace, providerName, model string, maxSteps int) error {
	if ctx.Err() != nil {
		return nil
	}
	provider := m.Providers[providerName]
	if provider == nil {
		return m.failRun(ctx, runID, fmt.Errorf("provider %s not configured", providerName))
	}
	var systemPrompt, allowedToolsJSON string
	if err := m.DB.QueryRowContext(ctx, `SELECT system_prompt, allowed_tools FROM agents WHERE id=?`, agentID).Scan(&systemPrompt, &allowedToolsJSON); err != nil {
		return m.failRun(ctx, runID, err)
	}
	var allowedTools []string
	_ = json.Unmarshal([]byte(allowedToolsJSON), &allowedTools)
	systemPrompt = buildEffectiveSystemPrompt(systemPrompt, allowedTools)
	if err := m.Store.AppendEvent(ctx, runID, "", "run.started", map[string]any{"provider": providerName, "model": model}); err != nil {
		return m.failRun(ctx, runID, err)
	}

	messages := []providers.Message{{Role: "user", Content: task}}
	lastEventSeq := 0
	if err := m.appendPendingUserMessages(ctx, runID, &messages, &lastEventSeq); err != nil {
		return m.failRun(ctx, runID, fmt.Errorf("load user events: %w", err))
	}
	var replaySourceRunID string
	var replayFromStep int
	_ = m.DB.QueryRowContext(ctx, `SELECT COALESCE(replay_source_run_id,''), COALESCE(replay_from_step,1) FROM runs WHERE id=?`, runID).Scan(&replaySourceRunID, &replayFromStep)
	if replayFromStep <= 0 {
		replayFromStep = 1
	}
	if replaySourceRunID != "" {
		var replayed int
		var replayErr error
		messages, replayed, replayErr = m.rebuildReplayContext(ctx, runID, replaySourceRunID, replayFromStep, task)
		if replayErr != nil {
			return m.failRun(ctx, runID, fmt.Errorf("replay bootstrap failed: %w", replayErr))
		}
		_ = m.Store.AppendEvent(ctx, runID, "", "replay.bootstrap", map[string]any{
			"source_run_id":    replaySourceRunID,
			"resume_from_step": replayFromStep,
			"replayed_steps":   replayed,
		})
	}
	var existingStepMax int
	_ = m.DB.QueryRowContext(ctx, `SELECT COALESCE(MAX(idx),0) FROM run_steps WHERE run_id=?`, runID).Scan(&existingStepMax)
	toolDefs, err := tools.ListDefinitions(ctx, m.DB, false)
	if err != nil {
		return m.failRun(ctx, runID, fmt.Errorf("list tools: %w", err))
	}
	providerTools := make([]providers.Tool, 0, len(toolDefs))
	for _, t := range toolDefs {
		providerTools = append(providerTools, providers.Tool{Name: t.Name, Description: t.Description, InputSchema: t.Schema})
	}

	for step := 1; step <= maxSteps; step++ {
		if ctx.Err() != nil {
			_ = m.Store.AppendEvent(context.Background(), runID, "", "run.cancelled_by_shutdown", map[string]any{"reason": "context_cancelled"})
			return nil
		}
		status, _ := m.currentStatus(runID)
		if status == "cancelled" || status == "interrupted" {
			_ = m.Store.AppendEvent(ctx, runID, "", "run.stopped", map[string]any{"status": status})
			return nil
		}
		if err := m.appendPendingUserMessages(ctx, runID, &messages, &lastEventSeq); err != nil {
			return m.failRun(ctx, runID, fmt.Errorf("load user events: %w", err))
		}
		stepIdx := existingStepMax + step
		stepID := uuid.NewString()
		modelSpanID := uuid.NewString()
		if _, err := m.DB.ExecContext(ctx, `INSERT INTO run_steps(id,run_id,idx,step_type,status,input_json,created_at,started_at) VALUES(?,?,?,?,?,?,?,?)`, stepID, runID, stepIdx, "model", "running", `{"message_count":`+fmt.Sprintf("%d", len(messages))+`}`, now(), now()); err != nil {
			return m.failRun(ctx, runID, err)
		}
		_, _ = m.DB.ExecContext(ctx, `INSERT INTO trace_spans(id,run_id,parent_id,name,kind,status,started_at,attrs_json) VALUES(?,?,?,?,?,?,?,?)`, modelSpanID, runID, "", "model.step", "model", "running", now(), `{"step_id":"`+stepID+`"}`)

		resp, err := m.completeWithRetry(ctx, provider, providers.CompletionRequest{Model: model, System: systemPrompt, Messages: messages, Tools: providerTools, Timeout: 120 * time.Second})
		if err != nil {
			_, _ = m.DB.ExecContext(ctx, `UPDATE run_steps SET status='failed', error=?, ended_at=? WHERE id=?`, err.Error(), now(), stepID)
			_, _ = m.DB.ExecContext(ctx, `UPDATE trace_spans SET status='failed', ended_at=?, attrs_json=? WHERE id=?`, now(), `{"error":`+strconv.Quote(err.Error())+`}`, modelSpanID)
			return m.failRun(ctx, runID, err)
		}

		outJSON, _ := json.Marshal(map[string]any{"text": resp.Text, "tool_calls": resp.ToolCalls, "usage": resp.Usage})
		_, _ = m.DB.ExecContext(ctx, `UPDATE run_steps SET status='completed', output_json=?, ended_at=? WHERE id=?`, string(outJSON), now(), stepID)
		_, _ = m.DB.ExecContext(ctx, `UPDATE trace_spans SET status='completed', ended_at=? WHERE id=?`, now(), modelSpanID)
		_ = m.Store.AppendEvent(ctx, runID, stepID, "model.response", map[string]any{"text": resp.Text, "tool_calls": resp.ToolCalls, "usage": resp.Usage})

		if len(resp.ToolCalls) == 0 {
			if strings.TrimSpace(resp.Text) == "" {
				continue
			}
			_, _ = m.DB.ExecContext(ctx, `UPDATE runs SET status='completed', completed_at=?, updated_at=? WHERE id=?`, now(), now(), runID)
			_ = m.Store.AppendEvent(ctx, runID, stepID, "run.completed", map[string]any{"result": resp.Text})
			return nil
		}

		messages = append(messages, providers.Message{Role: "assistant", Content: resp.Text, ToolCalls: resp.ToolCalls})
		for _, tc := range resp.ToolCalls {
			toolCallID := uuid.NewString()
			decision := policy.EvaluateTool(tc.Name, tc.Arguments, allowedTools)
			if !decision.Allow {
				_ = m.Store.AppendEvent(ctx, runID, stepID, "policy.denied", map[string]any{"tool": tc.Name, "reason": decision.Reason})
				return m.failRun(ctx, runID, fmt.Errorf("policy denied tool %s: %s", tc.Name, decision.Reason))
			}
			if decision.RequireApproval {
				approvalID := uuid.NewString()
				_, _ = m.DB.ExecContext(ctx, `INSERT INTO approvals(id,run_id,step_id,reason,status,requested_at) VALUES(?,?,?,?,?,?)`, approvalID, runID, stepID, decision.Reason, "pending", now())
				_, _ = m.DB.ExecContext(ctx, `UPDATE runs SET status='interrupted', updated_at=? WHERE id=?`, now(), runID)
				_ = m.Store.AppendEvent(ctx, runID, stepID, "approval.requested", map[string]any{"approval_id": approvalID, "reason": decision.Reason, "tool": tc.Name})
				return nil
			}
			_, _ = m.DB.ExecContext(ctx, `INSERT INTO tool_calls(id,run_id,step_id,tool_name,input_json,status,started_at) VALUES(?,?,?,?,?,?,?)`, toolCallID, runID, stepID, tc.Name, string(tc.Arguments), "running", now())
			toolSpanID := uuid.NewString()
			_, _ = m.DB.ExecContext(ctx, `INSERT INTO trace_spans(id,run_id,parent_id,name,kind,status,started_at,attrs_json) VALUES(?,?,?,?,?,?,?,?)`, toolSpanID, runID, modelSpanID, "tool."+tc.Name, "tool", "running", now(), `{"step_id":"`+stepID+`","tool_call_id":"`+toolCallID+`"}`)
			result, execErr := m.Tools.Execute(ctx, tools.Context{RunID: runID, StepID: stepID, Workspace: workspace}, tc.Name, tc.Arguments)
			outputJSON, _ := json.Marshal(result.Output)
			status := "completed"
			errClass := ""
			errMsg := ""
			if execErr != nil {
				status = "failed"
				errClass = "tool_error"
				errMsg = execErr.Error()
			}
			_, _ = m.DB.ExecContext(ctx, `UPDATE tool_calls SET output_json=?, status=?, ended_at=?, error_class=?, error_message=?, logs_path=? WHERE id=?`, string(outputJSON), status, now(), errClass, errMsg, "", toolCallID)
			_, _ = m.DB.ExecContext(ctx, `UPDATE trace_spans SET status=?, ended_at=?, attrs_json=? WHERE id=?`, status, now(), `{"error":`+strconv.Quote(errMsg)+`}`, toolSpanID)
			_ = m.Store.AppendEvent(ctx, runID, stepID, "tool.result", map[string]any{"tool": tc.Name, "status": status, "output": result.Output, "log": result.Log, "error": errMsg})
			if execErr != nil {
				messages = append(messages, providers.Message{Role: "tool", ToolCallID: tc.ID, Name: tc.Name, Content: `{"error":` + strconv.Quote(execErr.Error()) + `}`})
				continue
			}
			body, _ := json.Marshal(result.Output)
			messages = append(messages, providers.Message{Role: "tool", ToolCallID: tc.ID, Name: tc.Name, Content: string(body)})
		}
	}
	return m.failRun(ctx, runID, fmt.Errorf("max steps reached"))
}

func (m *Manager) completeWithRetry(ctx context.Context, provider providers.Client, req providers.CompletionRequest) (providers.CompletionResponse, error) {
	var lastErr error
	backoff := 1 * time.Second
	for attempt := 1; attempt <= 3; attempt++ {
		resp, err := provider.Complete(ctx, req)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if attempt < 3 {
			select {
			case <-ctx.Done():
				return providers.CompletionResponse{}, ctx.Err()
			case <-time.After(backoff):
			}
			backoff *= 2
		}
	}
	return providers.CompletionResponse{}, lastErr
}

func (m *Manager) rebuildReplayContext(ctx context.Context, runID, sourceRunID string, resumeFromStep int, task string) ([]providers.Message, int, error) {
	msgs := []providers.Message{{Role: "user", Content: task}}
	rows, err := m.DB.QueryContext(ctx, `
		SELECT id,idx,output_json FROM run_steps
		WHERE run_id=? AND step_type='model' AND status='completed' AND idx<?
		ORDER BY idx ASC
	`, sourceRunID, resumeFromStep)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	replayed := 0
	for rows.Next() {
		var stepID, outputJSON string
		var idx int
		if err := rows.Scan(&stepID, &idx, &outputJSON); err != nil {
			return nil, replayed, err
		}
		var modelOut struct {
			Text      string               `json:"text"`
			ToolCalls []providers.ToolCall `json:"tool_calls"`
		}
		if err := json.Unmarshal([]byte(outputJSON), &modelOut); err != nil {
			return nil, replayed, err
		}
		msgs = append(msgs, providers.Message{Role: "assistant", Content: modelOut.Text, ToolCalls: modelOut.ToolCalls})
		tcRows, err := m.DB.QueryContext(ctx, `
			SELECT status,output_json,error_message FROM tool_calls
			WHERE run_id=? AND step_id=?
			ORDER BY started_at ASC
		`, sourceRunID, stepID)
		if err != nil {
			return nil, replayed, err
		}
		type replayToolCall struct {
			Status string
			Output string
			ErrMsg string
		}
		recorded := make([]replayToolCall, 0)
		for tcRows.Next() {
			var row replayToolCall
			if err := tcRows.Scan(&row.Status, &row.Output, &row.ErrMsg); err != nil {
				_ = tcRows.Close()
				return nil, replayed, err
			}
			recorded = append(recorded, row)
		}
		_ = tcRows.Close()
		for i, tc := range modelOut.ToolCalls {
			content := `{}`
			if i < len(recorded) {
				if recorded[i].Status == "failed" {
					content = `{"error":` + strconv.Quote(recorded[i].ErrMsg) + `}`
				} else if strings.TrimSpace(recorded[i].Output) != "" {
					content = recorded[i].Output
				}
			}
			msgs = append(msgs, providers.Message{Role: "tool", ToolCallID: tc.ID, Name: tc.Name, Content: content})
		}
		replayed++
		_, _ = m.DB.ExecContext(ctx, `
			INSERT INTO run_steps(id,run_id,idx,step_type,status,input_json,output_json,created_at,started_at,ended_at)
			VALUES(?,?,?,?,?,?,?,?,?,?)
		`, uuid.NewString(), runID, idx, "replay", "completed",
			fmt.Sprintf(`{"source_run_id":"%s","source_step_id":"%s"}`, sourceRunID, stepID),
			outputJSON, now(), now(), now())
	}
	return msgs, replayed, nil
}

func (m *Manager) Wait() {
	m.wg.Wait()
}

func (m *Manager) failRun(ctx context.Context, runID string, err error) error {
	_, _ = m.DB.ExecContext(ctx, `UPDATE runs SET status='failed', error=?, completed_at=?, updated_at=? WHERE id=?`, err.Error(), now(), now(), runID)
	_ = m.Store.AppendEvent(ctx, runID, "", "run.failed", map[string]any{"error": err.Error()})
	return err
}

func (m *Manager) currentStatus(runID string) (string, error) {
	var s string
	err := m.DB.QueryRow(`SELECT status FROM runs WHERE id=?`, runID).Scan(&s)
	return s, err
}

func (m *Manager) appendPendingUserMessages(ctx context.Context, runID string, messages *[]providers.Message, lastSeq *int) error {
	for {
		events, err := m.Store.GetEvents(ctx, runID, *lastSeq, 200)
		if err != nil {
			return err
		}
		if len(events) == 0 {
			return nil
		}
		for _, ev := range events {
			seq := asInt(ev["seq"])
			if seq > *lastSeq {
				*lastSeq = seq
			}
			eventType, _ := ev["event_type"].(string)
			if eventType != "user.event" {
				continue
			}
			msg := extractUserMessage(ev["payload"])
			if msg == "" {
				continue
			}
			*messages = append(*messages, providers.Message{Role: "user", Content: msg})
		}
		if len(events) < 200 {
			return nil
		}
	}
}

func asInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	default:
		return 0
	}
}

func extractUserMessage(payload any) string {
	switch raw := payload.(type) {
	case json.RawMessage:
		return extractUserMessageFromJSON(raw)
	case []byte:
		return extractUserMessageFromJSON(raw)
	case string:
		return strings.TrimSpace(raw)
	default:
		return ""
	}
}

func extractUserMessageFromJSON(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return strings.TrimSpace(string(raw))
	}
	for _, key := range []string{"message", "text", "content", "instruction"} {
		if v, ok := obj[key]; ok {
			if s := strings.TrimSpace(fmt.Sprint(v)); s != "" {
				return s
			}
		}
	}
	return ""
}

func buildEffectiveSystemPrompt(base string, allowedTools []string) string {
	base = strings.TrimSpace(base)
	if len(allowedTools) == 0 {
		return base
	}
	toolPolicy := []string{
		"Operational tool policy:",
		"- Prefer tool-backed execution when tools are available.",
		"- If a task depends on external, current, or environment-specific facts, verify using tools before concluding.",
		"- Do not claim inability to access information when an allowed tool can fetch or verify it.",
		"- Ground final answers in observed tool output; summarize key evidence succinctly.",
		"- If a tool attempt fails, briefly report the failure and next best attempt.",
		"- Treat each run as a one-shot execution whenever feasible: complete the requested deliverable in this run.",
		"- Do not ask follow-up permission questions like 'want me to continue?' after completing the requested action.",
		"- If the user requested a concrete output (file, patch, screenshot, report), produce it directly and reference the produced output in the final answer.",
	}
	if hasAllowedTool(allowedTools, "shell.exec") {
		toolPolicy = append(toolPolicy,
			"- shell.exec is available: use terminal commands to retrieve and validate external data when needed.")
	}
	if hasAllowedToolPrefix(allowedTools, "browser.") {
		toolPolicy = append(toolPolicy,
			"- browser.* tools are available: when asked for a screenshot or page capture, capture it in-run and return the resulting artifact reference instead of offering additional optional captures.")
	}
	policyBlock := strings.Join(toolPolicy, "\n")
	if base == "" {
		return policyBlock
	}
	return base + "\n\n" + policyBlock
}

func hasAllowedTool(allowedTools []string, name string) bool {
	for _, t := range allowedTools {
		if strings.TrimSpace(t) == name {
			return true
		}
	}
	return false
}

func hasAllowedToolPrefix(allowedTools []string, prefix string) bool {
	for _, t := range allowedTools {
		if strings.HasPrefix(strings.TrimSpace(t), prefix) {
			return true
		}
	}
	return false
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
