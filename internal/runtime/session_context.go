package runtime

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"

	"github.com/adevireddy/colosseum/internal/providers"
)

// chatSessionContext holds the packed context for a chat-session run. It is
// a bounded alternative to rebuildReplayContext that avoids dumping raw tool
// output JSON back into the model's window on every turn.
type chatSessionContext struct {
	SessionID   string
	TurnIndex   int
	Messages    []providers.Message
	PackSummary map[string]any
}

// buildChatSessionContext composes the prior-turn context for a chat-session
// run. It replaces step-by-step replay with:
//  1. a synthetic "Session Primer" user message (summaries + workspace manifest
//     + conventions + available artifacts across the session)
//  2. the immediately prior user/assistant exchange for continuity
//  3. the current run's task as the final user message
//
// Returns ok=false when the run is not part of a chat session — the caller
// should fall back to the default replay path in that case.
func (m *Manager) buildChatSessionContext(ctx context.Context, runID, task, workspace string) (chatSessionContext, bool) {
	var sessionID string
	var turnIndex int
	err := m.DB.QueryRowContext(ctx, `
		SELECT session_id,turn_index FROM session_runs WHERE run_id=? LIMIT 1
	`, runID).Scan(&sessionID, &turnIndex)
	if err != nil {
		return chatSessionContext{}, false
	}

	sessionTitle := ""
	_ = m.DB.QueryRowContext(ctx, `SELECT COALESCE(title,'') FROM chat_sessions WHERE id=?`, sessionID).Scan(&sessionTitle)

	summaries := m.recentChatTurnSummaries(ctx, sessionID, runID, 6)
	manifest := scanWorkspaceManifest(workspace, 24)
	artifacts := m.sessionArtifactIndex(ctx, sessionID, runID, 16)
	scratchpad := m.sessionScratchpadIndex(ctx, sessionID, 10)
	prior := m.lastChatExchange(ctx, sessionID, runID)
	capabilities := probeSandbox(ctx, m.SandboxImage)
	plan := m.sessionPlanSnapshot(ctx, sessionID)
	planningMode := m.agentPlanningMode(ctx, runID)

	primer := buildSessionPrimer(sessionPrimerInput{
		SessionTitle: sessionTitle,
		TurnIndex:    turnIndex,
		Summaries:    summaries,
		Manifest:     manifest,
		Artifacts:    artifacts,
		Scratchpad:   scratchpad,
		Plan:         plan,
		PlanningMode: planningMode,
		Capabilities: capabilities,
	})

	msgs := make([]providers.Message, 0, 4)
	if strings.TrimSpace(primer) != "" {
		msgs = append(msgs, providers.Message{Role: "user", Content: primer, Source: "session.primer"})
	}
	for _, ex := range prior {
		msgs = append(msgs, ex)
	}
	cleanTask := strings.TrimSpace(task)
	if cleanTask != "" {
		msgs = append(msgs, providers.Message{Role: "user", Content: cleanTask})
	}

	summaryRows := make([]map[string]any, 0, len(summaries))
	for _, s := range summaries {
		summaryRows = append(summaryRows, map[string]any{
			"run_id":     s.RunID,
			"turn_index": s.TurnIndex,
			"summary":    s.Summary,
		})
	}
	manifestRows := make([]map[string]any, 0, len(manifest))
	for _, e := range manifest {
		manifestRows = append(manifestRows, map[string]any{
			"path":   e.Path,
			"is_dir": e.IsDir,
		})
	}
	artifactRows := make([]map[string]any, 0, len(artifacts))
	for _, a := range artifacts {
		artifactRows = append(artifactRows, map[string]any{
			"id":             a.ID,
			"kind":           a.Kind,
			"mime":           a.MIME,
			"path":           a.Path,
			"workspace_path": relativeWorkspacePath(a.Path, a.Workspace),
		})
	}
	scratchpadRows := make([]map[string]any, 0, len(scratchpad))
	for _, s := range scratchpad {
		scratchpadRows = append(scratchpadRows, map[string]any{
			"key":        s.Key,
			"note":       s.Note,
			"value_len":  len(s.Value),
			"updated_at": s.UpdatedAt,
		})
	}
	packSummary := map[string]any{
		"session_id":         sessionID,
		"turn_index":         turnIndex,
		"summary_count":      len(summaries),
		"workspace_entries":  len(manifest),
		"session_artifacts":  len(artifacts),
		"scratchpad_count":   len(scratchpad),
		"prior_exchange_len": len(prior),
		"primer_chars":       len(primer),
		"primer":             primer,
		"summaries":          summaryRows,
		"manifest":           manifestRows,
		"artifacts":          artifactRows,
		"scratchpad":         scratchpadRows,
		"planning_mode":      planningMode,
		"sandbox":            capabilities.summaryMap(),
	}
	if plan != nil {
		packSummary["plan_version"] = plan.Version
		packSummary["plan_step_count"] = len(plan.Steps)
		packSummary["plan_completed_count"] = plan.CompletedCount()
		if inflight := plan.InProgressTitle(); inflight != "" {
			packSummary["plan_in_progress_title"] = inflight
		}
		packSummary["plan_completed"] = plan.CompletedAt != ""
	}
	return chatSessionContext{
		SessionID:   sessionID,
		TurnIndex:   turnIndex,
		Messages:    msgs,
		PackSummary: packSummary,
	}, true
}

type sessionPrimerInput struct {
	SessionTitle string
	TurnIndex    int
	Summaries    []chatTurnSummary
	Manifest     []workspaceEntry
	Artifacts    []sessionArtifact
	Scratchpad   []scratchpadEntry
	Plan         *sessionPlan
	PlanningMode string
	Capabilities *SandboxCapabilities
}

func buildSessionPrimer(in sessionPrimerInput) string {
	var b strings.Builder
	b.WriteString("# Chat Session Primer\n")
	if title := strings.TrimSpace(in.SessionTitle); title != "" {
		fmt.Fprintf(&b, "Session: %s\n", title)
	}
	if in.TurnIndex > 0 {
		fmt.Fprintf(&b, "Current turn: %d\n", in.TurnIndex)
	}

	// Plan first — it's the most valuable recall artifact for long-running
	// sessions and handoffs. If a plan exists, we render it before summaries so
	// the model reads intent before tactics.
	if section := renderPlanSection(in.Plan); section != "" {
		b.WriteString(section)
	}
	if nudge := renderPlanningNudge(in.PlanningMode, in.Plan); nudge != "" {
		b.WriteString(nudge)
	}

	if len(in.Summaries) > 0 {
		b.WriteString("\n## Prior turns\n")
		for _, s := range in.Summaries {
			fmt.Fprintf(&b, "- Turn %d: %s\n", s.TurnIndex, strings.TrimSpace(s.Summary))
		}
	}

	if len(in.Manifest) > 0 {
		b.WriteString("\n## Workspace files (top of tree)\n")
		for _, e := range in.Manifest {
			if e.IsDir {
				fmt.Fprintf(&b, "- %s/\n", e.Path)
			} else {
				fmt.Fprintf(&b, "- %s\n", e.Path)
			}
		}
	}

	if len(in.Artifacts) > 0 {
		b.WriteString("\n## Artifacts available via recall_artifact\n")
		for _, a := range in.Artifacts {
			fmt.Fprintf(&b, "- id=%s kind=%s mime=%s path=%s\n",
				a.ID, a.Kind, a.MIME, relativeWorkspacePath(a.Path, a.Workspace))
		}
	}

	if len(in.Scratchpad) > 0 {
		b.WriteString("\n## Scratchpad (session-scoped notes; use scratchpad.read to load full value)\n")
		for _, s := range in.Scratchpad {
			preview := previewScratchpadValue(s.Value, 160)
			if note := strings.TrimSpace(s.Note); note != "" {
				fmt.Fprintf(&b, "- %s (%s) — %s\n", s.Key, note, preview)
			} else {
				fmt.Fprintf(&b, "- %s — %s\n", s.Key, preview)
			}
		}
	}

	if section := in.Capabilities.primerSection(); section != "" {
		b.WriteString(section)
	}

	b.WriteString("\n## Conventions for this conversation\n")
	b.WriteString(strings.Join([]string{
		"- Treat this session as a continuous workspace. Earlier turns' files and artifacts persist in the workspace.",
		"- To view or re-attach an image/file from an earlier turn, call recall_artifact with either the artifact id or a workspace-relative path. It will inline the file into the conversation for the next step.",
		"- Prefer recall_artifact over re-generating or re-fetching content the session has already produced.",
		"- Use workspace file tools (file.list, file.read, path.glob) to inspect state rather than asking the user.",
		"- Keep final replies focused on the current turn; reference prior work only when the user's request depends on it.",
	}, "\n"))
	return strings.TrimSpace(b.String())
}

// lastChatExchange returns the most recent prior user message + assistant
// reply for the session (oldest-first). Other earlier turns are represented
// as summaries in the primer; we keep only the immediately prior exchange
// verbatim so the model has a fresh anchor for follow-ups without exploding
// token use.
func (m *Manager) lastChatExchange(ctx context.Context, sessionID, excludeRunID string) []providers.Message {
	var priorRunID string
	err := m.DB.QueryRowContext(ctx, `
		SELECT run_id FROM session_runs
		WHERE session_id=? AND run_id<>?
		ORDER BY turn_index DESC LIMIT 1
	`, sessionID, excludeRunID).Scan(&priorRunID)
	if err != nil || priorRunID == "" {
		return nil
	}
	var task string
	_ = m.DB.QueryRowContext(ctx, `SELECT COALESCE(task,'') FROM runs WHERE id=?`, priorRunID).Scan(&task)
	var finalText string
	_ = m.DB.QueryRowContext(ctx, `
		SELECT COALESCE(content,'') FROM chat_messages
		WHERE run_id=? AND role='assistant'
		ORDER BY created_at DESC LIMIT 1
	`, priorRunID).Scan(&finalText)
	out := make([]providers.Message, 0, 2)
	if t := strings.TrimSpace(task); t != "" {
		out = append(out, providers.Message{Role: "user", Content: t})
	}
	if ft := strings.TrimSpace(finalText); ft != "" {
		out = append(out, providers.Message{Role: "assistant", Content: ft})
	}
	return out
}

type workspaceEntry struct {
	Path  string
	IsDir bool
}

func scanWorkspaceManifest(workspace string, limit int) []workspaceEntry {
	workspace = strings.TrimSpace(workspace)
	if workspace == "" {
		return nil
	}
	if limit <= 0 {
		limit = 24
	}
	entries := make([]workspaceEntry, 0, limit)
	_ = filepath.WalkDir(workspace, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if p == workspace {
			return nil
		}
		rel, rerr := filepath.Rel(workspace, p)
		if rerr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		// Skip hidden directories like .git and typical noise to keep the manifest signal-dense.
		base := filepath.Base(rel)
		if strings.HasPrefix(base, ".") {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() && (base == "node_modules" || base == "__pycache__" || base == "dist" || base == "build") {
			return fs.SkipDir
		}
		entries = append(entries, workspaceEntry{Path: rel, IsDir: d.IsDir()})
		if len(entries) >= limit {
			return fs.SkipAll
		}
		return nil
	})
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir && !entries[j].IsDir
		}
		return entries[i].Path < entries[j].Path
	})
	return entries
}

type sessionArtifact struct {
	ID        string
	Kind      string
	MIME      string
	Path      string
	Workspace string
}

// sessionArtifactIndex lists artifacts produced across all runs of a chat
// session, excluding the current run. This is what the model consults when
// deciding whether to call recall_artifact to resurface a prior image.
func (m *Manager) sessionArtifactIndex(ctx context.Context, sessionID, excludeRunID string, limit int) []sessionArtifact {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	if limit <= 0 {
		limit = 16
	}
	rows, err := m.DB.QueryContext(ctx, `
		SELECT a.id, a.kind, a.mime_type, a.path, r.workspace_path
		FROM artifacts a
		JOIN session_runs sr ON sr.run_id=a.run_id
		JOIN runs r ON r.id=a.run_id
		WHERE sr.session_id=? AND sr.run_id<>?
		ORDER BY a.created_at DESC
		LIMIT ?
	`, sessionID, excludeRunID, limit)
	if err != nil && err != sql.ErrNoRows {
		return nil
	}
	if rows == nil {
		return nil
	}
	defer rows.Close()
	out := make([]sessionArtifact, 0, limit)
	for rows.Next() {
		var id, kind, mime, path, workspace string
		if err := rows.Scan(&id, &kind, &mime, &path, &workspace); err != nil {
			continue
		}
		out = append(out, sessionArtifact{
			ID: strings.TrimSpace(id), Kind: strings.TrimSpace(kind),
			MIME: strings.TrimSpace(mime), Path: strings.TrimSpace(path),
			Workspace: strings.TrimSpace(workspace),
		})
	}
	return out
}

type scratchpadEntry struct {
	Key       string
	Value     string
	Note      string
	UpdatedAt string
}

// sessionScratchpadIndex returns the most-recent scratchpad entries for the
// session. The primer surfaces keys + short previews so the model is reminded
// that these notes exist without flooding context; full values are fetched on
// demand via scratchpad.read.
func (m *Manager) sessionScratchpadIndex(ctx context.Context, sessionID string, limit int) []scratchpadEntry {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	if limit <= 0 {
		limit = 10
	}
	rows, err := m.DB.QueryContext(ctx, `
		SELECT key, value, COALESCE(note,''), updated_at
		FROM session_scratchpad
		WHERE session_id=?
		ORDER BY updated_at DESC
		LIMIT ?
	`, sessionID, limit)
	if err != nil && err != sql.ErrNoRows {
		return nil
	}
	if rows == nil {
		return nil
	}
	defer rows.Close()
	out := make([]scratchpadEntry, 0, limit)
	var budget int
	const maxBudget = 2048
	for rows.Next() {
		var e scratchpadEntry
		if err := rows.Scan(&e.Key, &e.Value, &e.Note, &e.UpdatedAt); err != nil {
			continue
		}
		budget += len(e.Key) + len(e.Value) + len(e.Note)
		if budget > maxBudget && len(out) > 0 {
			break
		}
		out = append(out, e)
	}
	return out
}

func previewScratchpadValue(value string, max int) string {
	v := strings.ReplaceAll(strings.TrimSpace(value), "\n", " ")
	if max <= 0 || len(v) <= max {
		return v
	}
	return v[:max] + "…"
}

func relativeWorkspacePath(path, workspace string) string {
	if path == "" {
		return ""
	}
	if workspace == "" {
		return path
	}
	rel, err := filepath.Rel(workspace, path)
	if err != nil {
		return path
	}
	rel = filepath.ToSlash(rel)
	if strings.HasPrefix(rel, "../") || rel == ".." {
		return path
	}
	return rel
}
