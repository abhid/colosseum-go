package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/adevireddy/colosseum/internal/providers"
)

const chatTurnSummaryEvent = "chat.turn_summary"

// recordChatTurnSummary generates a compact 1–3 sentence recap of what the
// completed run accomplished and stores it as an event on that run. The
// packer reads these to show prior turns without replaying raw tool JSON.
func (m *Manager) recordChatTurnSummary(ctx context.Context, runID, task, finalAssistantText string) {
	if strings.TrimSpace(runID) == "" {
		return
	}
	var sessionID string
	if err := m.DB.QueryRowContext(ctx, `SELECT session_id FROM session_runs WHERE run_id=? LIMIT 1`, runID).Scan(&sessionID); err != nil {
		return
	}
	if existing, _ := m.readChatTurnSummary(ctx, runID); existing != "" {
		return
	}

	toolSummary := m.summarizeRunToolActivity(ctx, runID)
	summary := buildHeuristicTurnSummary(task, finalAssistantText, toolSummary)

	if providerName, model, ok := m.chatSessionProviderModel(ctx, sessionID); ok {
		if refined := m.refineTurnSummaryWithLLM(ctx, providerName, model, task, finalAssistantText, toolSummary); refined != "" {
			summary = refined
		}
	}

	summary = truncateForEvent(strings.TrimSpace(summary), 800)
	if summary == "" {
		return
	}
	_ = m.Store.AppendEvent(ctx, runID, "", chatTurnSummaryEvent, map[string]any{
		"summary": summary,
	})
}

func (m *Manager) readChatTurnSummary(ctx context.Context, runID string) (string, error) {
	var payload string
	err := m.DB.QueryRowContext(ctx, `
		SELECT payload_json FROM events
		WHERE run_id=? AND event_type=?
		ORDER BY seq DESC LIMIT 1
	`, runID, chatTurnSummaryEvent).Scan(&payload)
	if err != nil {
		return "", err
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(payload), &parsed); err != nil {
		return "", err
	}
	if v, ok := parsed["summary"].(string); ok {
		return strings.TrimSpace(v), nil
	}
	return "", nil
}

type runToolActivity struct {
	Tools     []string
	Artifacts []string
}

func (m *Manager) summarizeRunToolActivity(ctx context.Context, runID string) runToolActivity {
	out := runToolActivity{}
	rows, err := m.DB.QueryContext(ctx, `
		SELECT tool_name,status FROM tool_calls
		WHERE run_id=? ORDER BY started_at ASC LIMIT 12
	`, runID)
	if err == nil {
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			var name, status string
			if err := rows.Scan(&name, &status); err != nil {
				continue
			}
			label := strings.TrimSpace(name)
			if label == "" || seen[label] {
				continue
			}
			if status != "" && status != "completed" {
				label = label + "(" + status + ")"
			}
			seen[label] = true
			out.Tools = append(out.Tools, label)
		}
	}
	artRows, err := m.DB.QueryContext(ctx, `
		SELECT kind,path FROM artifacts WHERE run_id=? ORDER BY created_at DESC LIMIT 6
	`, runID)
	if err == nil {
		defer artRows.Close()
		for artRows.Next() {
			var kind, path string
			if err := artRows.Scan(&kind, &path); err != nil {
				continue
			}
			label := strings.TrimSpace(kind)
			if label == "" {
				label = "artifact"
			}
			base := filepathBase(path)
			if base != "" {
				label = label + ":" + base
			}
			out.Artifacts = append(out.Artifacts, label)
		}
	}
	return out
}

func filepathBase(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	if idx := strings.LastIndex(p, "/"); idx >= 0 && idx < len(p)-1 {
		return p[idx+1:]
	}
	return p
}

func buildHeuristicTurnSummary(task, finalText string, tool runToolActivity) string {
	parts := []string{}
	cleanTask := strings.TrimSpace(task)
	if cleanTask != "" {
		parts = append(parts, "User asked: "+truncateForEvent(cleanTask, 180))
	}
	if len(tool.Tools) > 0 {
		parts = append(parts, "Used tools: "+strings.Join(tool.Tools, ", "))
	}
	if len(tool.Artifacts) > 0 {
		parts = append(parts, "Produced: "+strings.Join(tool.Artifacts, ", "))
	}
	if finalText = strings.TrimSpace(finalText); finalText != "" {
		parts = append(parts, "Assistant replied: "+truncateForEvent(finalText, 220))
	}
	return strings.Join(parts, ". ")
}

func (m *Manager) chatSessionProviderModel(ctx context.Context, sessionID string) (string, string, bool) {
	if strings.TrimSpace(sessionID) == "" {
		return "", "", false
	}
	var provider, model string
	err := m.DB.QueryRowContext(ctx, `
		SELECT a.provider, a.model FROM chat_sessions s
		JOIN agents a ON a.id=s.agent_id
		WHERE s.id=?
	`, sessionID).Scan(&provider, &model)
	if err != nil {
		return "", "", false
	}
	return strings.TrimSpace(provider), strings.TrimSpace(model), provider != "" && model != ""
}

func (m *Manager) refineTurnSummaryWithLLM(ctx context.Context, providerName, model, task, finalText string, tool runToolActivity) string {
	client := m.Providers[providerName]
	if client == nil {
		return ""
	}
	lctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	prompt := buildTurnSummaryPrompt(task, finalText, tool)
	resp, err := client.Complete(lctx, providers.CompletionRequest{
		Model:   model,
		System:  "You write ultra-compact recaps of prior agent turns for long chat sessions. Output 1–3 plain sentences, no headers, no lists, ≤ 280 characters. Capture what the user asked, what tools ran, and what the agent produced or decided.",
		Messages: []providers.Message{{Role: "user", Content: prompt}},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		return ""
	}
	return strings.TrimSpace(resp.Text)
}

func buildTurnSummaryPrompt(task, finalText string, tool runToolActivity) string {
	var b strings.Builder
	b.WriteString("Summarize this completed turn in 1–3 sentences for future context.\n\n")
	if t := strings.TrimSpace(task); t != "" {
		fmt.Fprintf(&b, "User turn request:\n%s\n\n", truncateForEvent(t, 600))
	}
	if len(tool.Tools) > 0 {
		fmt.Fprintf(&b, "Tools used: %s\n", strings.Join(tool.Tools, ", "))
	}
	if len(tool.Artifacts) > 0 {
		fmt.Fprintf(&b, "Artifacts produced: %s\n", strings.Join(tool.Artifacts, ", "))
	}
	if ft := strings.TrimSpace(finalText); ft != "" {
		fmt.Fprintf(&b, "\nAssistant final message:\n%s\n", truncateForEvent(ft, 800))
	}
	return b.String()
}

// recentChatTurnSummaries returns prior-run summaries for a session (oldest first),
// up to `limit`. Summaries are paired with the run ID and turn index for ordering.
type chatTurnSummary struct {
	RunID     string
	TurnIndex int
	Summary   string
}

func (m *Manager) recentChatTurnSummaries(ctx context.Context, sessionID string, excludeRunID string, limit int) []chatTurnSummary {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	if limit <= 0 {
		limit = 6
	}
	rows, err := m.DB.QueryContext(ctx, `
		SELECT sr.run_id, sr.turn_index
		FROM session_runs sr
		WHERE sr.session_id=? AND sr.run_id<>?
		ORDER BY sr.turn_index DESC
		LIMIT ?
	`, sessionID, excludeRunID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	entries := make([]chatTurnSummary, 0, limit)
	for rows.Next() {
		var runID string
		var turnIndex int
		if err := rows.Scan(&runID, &turnIndex); err != nil {
			continue
		}
		summary, _ := m.readChatTurnSummary(ctx, runID)
		if summary == "" {
			// Lazy-backfill from the run's completed task + final assistant message.
			summary = m.synthesizeSummaryFromRun(ctx, runID)
		}
		if summary == "" {
			continue
		}
		entries = append(entries, chatTurnSummary{RunID: runID, TurnIndex: turnIndex, Summary: summary})
	}
	// reverse to oldest-first
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	return entries
}

func (m *Manager) synthesizeSummaryFromRun(ctx context.Context, runID string) string {
	var task string
	_ = m.DB.QueryRowContext(ctx, `SELECT COALESCE(task,'') FROM runs WHERE id=?`, runID).Scan(&task)
	var finalText string
	_ = m.DB.QueryRowContext(ctx, `
		SELECT COALESCE(content,'') FROM chat_messages
		WHERE run_id=? AND role='assistant'
		ORDER BY created_at DESC LIMIT 1
	`, runID).Scan(&finalText)
	tool := m.summarizeRunToolActivity(ctx, runID)
	return truncateForEvent(buildHeuristicTurnSummary(task, finalText, tool), 400)
}

var _ = sql.ErrNoRows
