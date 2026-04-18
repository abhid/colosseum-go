package runtime

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// sessionPlan is the primer-side projection of a session plan. It's a flat,
// read-only view — writes go through the plan.* tools.
type sessionPlan struct {
	ID          string
	Title       string
	Version     int
	UpdatedAt   string
	CompletedAt string
	Steps       []sessionPlanStep
}

type sessionPlanStep struct {
	ID      string
	Idx     int
	Title   string
	Detail  string
	Status  string
	Blocker string
	Owner   string
	Notes   string
}

func (p *sessionPlan) CompletedCount() int {
	if p == nil {
		return 0
	}
	n := 0
	for _, s := range p.Steps {
		if s.Status == "completed" {
			n++
		}
	}
	return n
}

func (p *sessionPlan) InProgressTitle() string {
	if p == nil {
		return ""
	}
	for _, s := range p.Steps {
		if s.Status == "in_progress" {
			return s.Title
		}
	}
	return ""
}

func (m *Manager) sessionPlanSnapshot(ctx context.Context, sessionID string) *sessionPlan {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	var p sessionPlan
	var completed sql.NullString
	err := m.DB.QueryRowContext(ctx, `
		SELECT id, COALESCE(title,''), version, updated_at, completed_at
		FROM session_plans WHERE session_id=?
	`, sessionID).Scan(&p.ID, &p.Title, &p.Version, &p.UpdatedAt, &completed)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return nil
	}
	if completed.Valid {
		p.CompletedAt = completed.String
	}
	rows, err := m.DB.QueryContext(ctx, `
		SELECT id, idx, title, COALESCE(detail,''), status, COALESCE(blocker,''), COALESCE(owner_run_id,''), COALESCE(notes,'')
		FROM session_plan_steps WHERE plan_id=? ORDER BY idx ASC
	`, p.ID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	for rows.Next() {
		var s sessionPlanStep
		if err := rows.Scan(&s.ID, &s.Idx, &s.Title, &s.Detail, &s.Status, &s.Blocker, &s.Owner, &s.Notes); err != nil {
			continue
		}
		p.Steps = append(p.Steps, s)
	}
	return &p
}

func (m *Manager) agentPlanningMode(ctx context.Context, runID string) string {
	var mode string
	err := m.DB.QueryRowContext(ctx, `
		SELECT COALESCE(a.planning_mode,'off')
		FROM runs r
		JOIN agents a ON a.id=r.agent_id
		WHERE r.id=?
	`, runID).Scan(&mode)
	if err != nil {
		return "off"
	}
	mode = strings.TrimSpace(strings.ToLower(mode))
	switch mode {
	case "suggest", "required":
		return mode
	}
	return "off"
}

// renderPlanSection produces the primer's plan block. Elision strategy:
//   - always render every in_progress + blocked step verbatim
//   - always render every pending step (title; include detail if under a small budget)
//   - for completed steps, show the last `completedTailCap` verbatim and compress
//     older completions into a single "N earlier steps completed" line
const (
	completedTailCap   = 3
	pendingDetailCap   = 10
	planSectionMaxLen  = 2000
)

func renderPlanSection(p *sessionPlan) string {
	if p == nil || len(p.Steps) == 0 {
		return ""
	}
	var b strings.Builder
	header := fmt.Sprintf("\n## Current plan (v%d", p.Version)
	if t := strings.TrimSpace(p.Title); t != "" {
		header += fmt.Sprintf(", %q", t)
	}
	if p.CompletedAt != "" {
		header += ", completed"
	}
	header += ")\n"
	b.WriteString(header)

	// Count completed up-front so we know how many to elide.
	completedSeen := 0
	totalCompleted := 0
	for _, s := range p.Steps {
		if s.Status == "completed" {
			totalCompleted++
		}
	}
	completedToElide := totalCompleted - completedTailCap
	if completedToElide < 0 {
		completedToElide = 0
	}

	pendingCount := 0
	for _, s := range p.Steps {
		if s.Status == "pending" {
			pendingCount++
		}
	}
	includePendingDetail := pendingCount <= pendingDetailCap

	elisionEmitted := false
	for _, s := range p.Steps {
		switch s.Status {
		case "completed":
			if completedSeen < completedToElide {
				completedSeen++
				if !elisionEmitted {
					fmt.Fprintf(&b, "- [done] … %d earlier steps completed …\n", completedToElide)
					elisionEmitted = true
				}
				continue
			}
			fmt.Fprintf(&b, "- [done] %s\n", strings.TrimSpace(s.Title))
		case "in_progress":
			tag := "in progress"
			owner := strings.TrimSpace(s.Owner)
			if owner != "" {
				tag = fmt.Sprintf("in progress · run %s", shortID(owner))
			}
			fmt.Fprintf(&b, "- [%s] %s\n", tag, strings.TrimSpace(s.Title))
			if d := strings.TrimSpace(s.Detail); d != "" {
				fmt.Fprintf(&b, "    detail: %s\n", truncateOneLine(d, 240))
			}
			if n := strings.TrimSpace(s.Notes); n != "" {
				fmt.Fprintf(&b, "    notes: %s\n", truncateOneLine(n, 240))
			}
		case "blocked":
			fmt.Fprintf(&b, "- [blocked] %s\n", strings.TrimSpace(s.Title))
			if blk := strings.TrimSpace(s.Blocker); blk != "" {
				fmt.Fprintf(&b, "    blocker: %s\n", truncateOneLine(blk, 240))
			}
		case "skipped":
			fmt.Fprintf(&b, "- [skipped] %s\n", strings.TrimSpace(s.Title))
		case "pending":
			if includePendingDetail && strings.TrimSpace(s.Detail) != "" {
				fmt.Fprintf(&b, "- [pending] %s — %s\n",
					strings.TrimSpace(s.Title), truncateOneLine(s.Detail, 160))
			} else {
				fmt.Fprintf(&b, "- [pending] %s\n", strings.TrimSpace(s.Title))
			}
		default:
			fmt.Fprintf(&b, "- [%s] %s\n", s.Status, strings.TrimSpace(s.Title))
		}
	}

	out := b.String()
	if len(out) > planSectionMaxLen {
		// Hard budget cap — truncate mid-section. Better than blowing the primer
		// budget; the model can still call plan.read for the authoritative view.
		out = out[:planSectionMaxLen] + "…\n(plan truncated; call plan.read for full details)\n"
	}
	return out
}

// renderPlanningNudge returns mode-specific prompt guidance. Nudges are short
// and only emitted for suggest/required; `off` stays silent so agents not
// opted-in see no overhead.
func renderPlanningNudge(mode string, p *sessionPlan) string {
	switch mode {
	case "suggest":
		if p == nil {
			return "\n## Planning\nIf this task will take more than a few tool calls, call plan.set([...]) first so progress is visible across turns. Keep trivial one-shot tasks un-planned.\n"
		}
		return "\n## Planning\nThe plan above is your working contract. Update steps as you go (plan.update_step). Revise via plan.set when reality diverges from the plan.\n"
	case "required":
		if p == nil {
			return "\n## Planning (required)\nBefore your first non-read tool call, call plan.set([...]) with an ordered list of steps. Treat the plan as a living artifact: update step status as you complete work, and revise with plan.set when the approach changes.\n"
		}
		return "\n## Planning (required)\nClaim the next step with plan.update_step(status=\"in_progress\") before acting on it, and mark it completed/skipped/blocked when you're done. If the plan is wrong, revise with plan.set — don't silently drift.\n"
	}
	return ""
}

func truncateOneLine(s string, max int) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), "\n", " ")
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func shortID(id string) string {
	id = strings.TrimSpace(id)
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}
