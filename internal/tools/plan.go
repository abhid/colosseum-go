package tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	planMaxTitleLen  = 200
	planMaxDetailLen = 2000
	planMaxNotesLen  = 2000
	planMaxSteps     = 100
)

// Valid step statuses. The enum is checked in code rather than via a CHECK
// constraint so that migrations can evolve it without an ALTER TABLE.
var planValidStatus = map[string]bool{
	"pending":     true,
	"in_progress": true,
	"completed":   true,
	"skipped":     true,
	"blocked":     true,
}

// planTerminalStatus returns true when the transition to `status` releases
// ownership of the step. Blocked is treated as terminal for ownership — any
// later run can pick it up again.
func planTerminalStatus(status string) bool {
	switch status {
	case "completed", "skipped", "blocked", "pending":
		return true
	}
	return false
}

type planStepInput struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

func (e *Executor) planSet(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Title string          `json:"title"`
		Steps []planStepInput `json:"steps"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if len(req.Steps) == 0 {
		return Result{}, fmt.Errorf("steps required")
	}
	if len(req.Steps) > planMaxSteps {
		return Result{}, fmt.Errorf("too many steps (max %d)", planMaxSteps)
	}
	for i, s := range req.Steps {
		if strings.TrimSpace(s.Title) == "" {
			return Result{}, fmt.Errorf("step %d: title required", i+1)
		}
		if len(s.Title) > planMaxTitleLen {
			return Result{}, fmt.Errorf("step %d: title too long (max %d)", i+1, planMaxTitleLen)
		}
		if len(s.Detail) > planMaxDetailLen {
			return Result{}, fmt.Errorf("step %d: detail too long (max %d)", i+1, planMaxDetailLen)
		}
	}
	sessionID, err := e.resolveSessionID(ctx, runCtx.RunID)
	if err != nil {
		return Result{}, err
	}

	tx, err := e.DB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = tx.Rollback() }()

	prior, priorVersion, priorSteps, err := e.snapshotPlanForArchive(ctx, tx, sessionID)
	if err != nil {
		return Result{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	newVersion := priorVersion + 1
	if priorVersion == 0 {
		newVersion = 1
	}

	var planID string
	if prior != "" {
		planID = prior
		if _, err := tx.ExecContext(ctx,
			`UPDATE session_plans SET title=?, version=?, updated_at=?, completed_at=NULL WHERE id=?`,
			strings.TrimSpace(req.Title), newVersion, now, planID); err != nil {
			return Result{}, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM session_plan_steps WHERE plan_id=?`, planID); err != nil {
			return Result{}, err
		}
	} else {
		planID = uuid.NewString()
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO session_plans(id, session_id, title, version, created_at, updated_at)
			VALUES(?, ?, ?, ?, ?, ?)
		`, planID, sessionID, strings.TrimSpace(req.Title), newVersion, now, now); err != nil {
			return Result{}, err
		}
	}

	stepIDs := make([]string, 0, len(req.Steps))
	for i, s := range req.Steps {
		stepID := uuid.NewString()
		stepIDs = append(stepIDs, stepID)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO session_plan_steps(id, plan_id, idx, title, detail, status)
			VALUES(?, ?, ?, ?, ?, 'pending')
		`, stepID, planID, i, strings.TrimSpace(s.Title), s.Detail); err != nil {
			return Result{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Result{}, err
	}

	if e.EventSink != nil {
		payload := map[string]any{
			"plan_id":        planID,
			"session_id":     sessionID,
			"version":        newVersion,
			"step_count":     len(req.Steps),
			"authored_by":    "model",
			"prior_version":  priorVersion,
			"prior_steps":    priorSteps,
		}
		_ = e.EventSink.AppendEvent(ctx, runCtx.RunID, runCtx.StepID, "plan.revised", payload)
	}

	return Result{Output: map[string]any{
		"ok":         true,
		"plan_id":    planID,
		"version":    newVersion,
		"step_count": len(req.Steps),
		"step_ids":   stepIDs,
	}}, nil
}

func (e *Executor) planAddStep(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Title        string `json:"title"`
		Detail       string `json:"detail"`
		AfterStepID  string `json:"after_step_id"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(req.Title) == "" {
		return Result{}, fmt.Errorf("title required")
	}
	if len(req.Title) > planMaxTitleLen {
		return Result{}, fmt.Errorf("title too long (max %d)", planMaxTitleLen)
	}
	if len(req.Detail) > planMaxDetailLen {
		return Result{}, fmt.Errorf("detail too long (max %d)", planMaxDetailLen)
	}
	sessionID, err := e.resolveSessionID(ctx, runCtx.RunID)
	if err != nil {
		return Result{}, err
	}
	tx, err := e.DB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var planID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM session_plans WHERE session_id=?`, sessionID).Scan(&planID)
	if err == sql.ErrNoRows {
		return Result{}, fmt.Errorf("no plan exists; call plan.set first")
	}
	if err != nil {
		return Result{}, err
	}

	var insertIdx int
	if after := strings.TrimSpace(req.AfterStepID); after != "" {
		var afterIdx int
		err := tx.QueryRowContext(ctx,
			`SELECT idx FROM session_plan_steps WHERE id=? AND plan_id=?`, after, planID).Scan(&afterIdx)
		if err == sql.ErrNoRows {
			return Result{}, fmt.Errorf("after_step_id not found in this plan")
		}
		if err != nil {
			return Result{}, err
		}
		insertIdx = afterIdx + 1
	} else {
		if err := tx.QueryRowContext(ctx,
			`SELECT COALESCE(MAX(idx), -1) + 1 FROM session_plan_steps WHERE plan_id=?`,
			planID).Scan(&insertIdx); err != nil {
			return Result{}, err
		}
	}

	var stepCount int
	_ = tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM session_plan_steps WHERE plan_id=?`, planID).Scan(&stepCount)
	if stepCount >= planMaxSteps {
		return Result{}, fmt.Errorf("plan already at max step count (%d)", planMaxSteps)
	}

	// Shift subsequent steps right to make room.
	if _, err := tx.ExecContext(ctx,
		`UPDATE session_plan_steps SET idx=idx+1 WHERE plan_id=? AND idx>=?`,
		planID, insertIdx); err != nil {
		return Result{}, err
	}
	newStepID := uuid.NewString()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO session_plan_steps(id, plan_id, idx, title, detail, status)
		VALUES(?, ?, ?, ?, ?, 'pending')
	`, newStepID, planID, insertIdx, strings.TrimSpace(req.Title), req.Detail); err != nil {
		return Result{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx,
		`UPDATE session_plans SET updated_at=? WHERE id=?`, now, planID); err != nil {
		return Result{}, err
	}
	if err := tx.Commit(); err != nil {
		return Result{}, err
	}
	if e.EventSink != nil {
		_ = e.EventSink.AppendEvent(ctx, runCtx.RunID, runCtx.StepID, "plan.step_added", map[string]any{
			"plan_id": planID, "step_id": newStepID, "idx": insertIdx, "title": strings.TrimSpace(req.Title),
		})
	}
	return Result{Output: map[string]any{
		"ok":      true,
		"step_id": newStepID,
		"idx":     insertIdx,
		"plan_id": planID,
	}}, nil
}

type planStepUpdate struct {
	StepID  string `json:"step_id"`
	Status  string `json:"status"`
	Notes   string `json:"notes"`
	Blocker string `json:"blocker"`
}

func (e *Executor) planUpdateStep(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req planStepUpdate
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	out, err := e.applyStepUpdates(ctx, runCtx, []planStepUpdate{req})
	if err != nil {
		return Result{}, err
	}
	out["ok"] = true
	return Result{Output: out}, nil
}

func (e *Executor) planUpdateSteps(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Updates []planStepUpdate `json:"updates"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if len(req.Updates) == 0 {
		return Result{}, fmt.Errorf("updates required")
	}
	out, err := e.applyStepUpdates(ctx, runCtx, req.Updates)
	if err != nil {
		return Result{}, err
	}
	out["ok"] = true
	return Result{Output: out}, nil
}

// applyStepUpdates performs all step mutations inside one transaction so a
// batch either fully succeeds or the plan is left untouched. Concurrent claim
// conflicts surface as errors — the caller can then re-read the plan.
func (e *Executor) applyStepUpdates(ctx context.Context, runCtx Context, updates []planStepUpdate) (map[string]any, error) {
	sessionID, err := e.resolveSessionID(ctx, runCtx.RunID)
	if err != nil {
		return nil, err
	}
	tx, err := e.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var planID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM session_plans WHERE session_id=?`, sessionID).Scan(&planID)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("no plan exists for this session")
	}
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	applied := make([]map[string]any, 0, len(updates))
	var planComplete = true

	for i, u := range updates {
		stepID := strings.TrimSpace(u.StepID)
		if stepID == "" {
			return nil, fmt.Errorf("update %d: step_id required", i+1)
		}
		status := strings.TrimSpace(u.Status)
		if status != "" && !planValidStatus[status] {
			return nil, fmt.Errorf("update %d: invalid status %q", i+1, status)
		}
		if len(u.Notes) > planMaxNotesLen {
			return nil, fmt.Errorf("update %d: notes too long", i+1)
		}

		var curStatus, curOwner string
		err := tx.QueryRowContext(ctx,
			`SELECT status, owner_run_id FROM session_plan_steps WHERE id=? AND plan_id=?`,
			stepID, planID).Scan(&curStatus, &curOwner)
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("update %d: step not found in this plan", i+1)
		}
		if err != nil {
			return nil, err
		}

		newStatus := curStatus
		if status != "" {
			newStatus = status
		}
		newOwner := curOwner

		// Ownership transitions. pending→in_progress claims for this run.
		// Terminal transitions release ownership so the next run can see the
		// step as "free" again (covers blocked-then-unblocked pickups).
		if status == "in_progress" {
			if curStatus == "in_progress" && curOwner != "" && curOwner != runCtx.RunID {
				return nil, fmt.Errorf("update %d: step is in_progress under another run (%s); pick a different step or wait", i+1, curOwner)
			}
			newOwner = runCtx.RunID
		} else if status != "" && planTerminalStatus(status) {
			newOwner = ""
		}

		sets := []string{"status=?", "owner_run_id=?"}
		args := []any{newStatus, newOwner}
		if u.Notes != "" {
			sets = append(sets, "notes=?")
			args = append(args, u.Notes)
		}
		if status == "blocked" {
			sets = append(sets, "blocker=?")
			args = append(args, strings.TrimSpace(u.Blocker))
		} else if status != "" && status != "blocked" {
			// Clear any prior blocker once the step moves off blocked.
			sets = append(sets, "blocker=''")
		}
		if status == "in_progress" && curStatus != "in_progress" {
			sets = append(sets, "started_at=COALESCE(started_at, ?)")
			args = append(args, now)
		}
		if status == "completed" {
			sets = append(sets, "completed_at=?")
			args = append(args, now)
		}
		args = append(args, stepID, planID)
		q := fmt.Sprintf(`UPDATE session_plan_steps SET %s WHERE id=? AND plan_id=?`, strings.Join(sets, ", "))
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return nil, err
		}
		applied = append(applied, map[string]any{
			"step_id":    stepID,
			"status":     newStatus,
			"prior":      curStatus,
			"owner":      newOwner,
		})
	}

	// After all updates, check whether plan is fully complete.
	var open int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM session_plan_steps WHERE plan_id=? AND status IN ('pending','in_progress','blocked')`,
		planID).Scan(&open); err != nil {
		return nil, err
	}
	if open > 0 {
		planComplete = false
	}
	if planComplete {
		if _, err := tx.ExecContext(ctx,
			`UPDATE session_plans SET updated_at=?, completed_at=? WHERE id=?`, now, now, planID); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.ExecContext(ctx,
			`UPDATE session_plans SET updated_at=?, completed_at=NULL WHERE id=?`, now, planID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	if e.EventSink != nil {
		_ = e.EventSink.AppendEvent(ctx, runCtx.RunID, runCtx.StepID, "plan.step_updated", map[string]any{
			"plan_id":       planID,
			"updates":       applied,
			"plan_complete": planComplete,
		})
	}
	return map[string]any{
		"plan_id":       planID,
		"updates":       applied,
		"plan_complete": planComplete,
	}, nil
}

func (e *Executor) planRead(ctx context.Context, runCtx Context, _ json.RawMessage) (Result, error) {
	sessionID, err := e.resolveSessionID(ctx, runCtx.RunID)
	if err != nil {
		return Result{}, err
	}
	var planID, title string
	var version int
	var completedAt sql.NullString
	var updatedAt string
	err = e.DB.QueryRowContext(ctx, `
		SELECT id, COALESCE(title,''), version, updated_at, completed_at
		FROM session_plans WHERE session_id=?
	`, sessionID).Scan(&planID, &title, &version, &updatedAt, &completedAt)
	if err == sql.ErrNoRows {
		return Result{Output: map[string]any{
			"exists": false,
		}}, nil
	}
	if err != nil {
		return Result{}, err
	}
	rows, err := e.DB.QueryContext(ctx, `
		SELECT id, idx, title, COALESCE(detail,''), status, COALESCE(blocker,''), COALESCE(owner_run_id,''),
		       COALESCE(notes,''), started_at, completed_at
		FROM session_plan_steps WHERE plan_id=? ORDER BY idx ASC
	`, planID)
	if err != nil {
		return Result{}, err
	}
	defer rows.Close()
	steps := make([]map[string]any, 0)
	counts := map[string]int{}
	for rows.Next() {
		var id, stitle, detail, status, blocker, owner, notes string
		var idx int
		var started, done sql.NullString
		if err := rows.Scan(&id, &idx, &stitle, &detail, &status, &blocker, &owner, &notes, &started, &done); err != nil {
			return Result{}, err
		}
		counts[status]++
		entry := map[string]any{
			"id": id, "idx": idx, "title": stitle, "detail": detail,
			"status": status, "blocker": blocker, "owner_run_id": owner, "notes": notes,
		}
		if started.Valid {
			entry["started_at"] = started.String
		}
		if done.Valid {
			entry["completed_at"] = done.String
		}
		steps = append(steps, entry)
	}
	out := map[string]any{
		"exists":     true,
		"plan_id":    planID,
		"title":      title,
		"version":    version,
		"step_count": len(steps),
		"steps":      steps,
		"counts":     counts,
		"updated_at": updatedAt,
	}
	if completedAt.Valid {
		out["completed_at"] = completedAt.String
		out["completed"] = true
	} else {
		out["completed"] = false
	}
	return Result{Output: out}, nil
}

// snapshotPlanForArchive returns the prior plan_id (empty if none), its version,
// and a JSON-marshalable slice of its step state at the time of the call, so
// plan.set can archive it as a plan.revised event.
func (e *Executor) snapshotPlanForArchive(ctx context.Context, tx *sql.Tx, sessionID string) (string, int, []map[string]any, error) {
	var id string
	var version int
	err := tx.QueryRowContext(ctx,
		`SELECT id, version FROM session_plans WHERE session_id=?`, sessionID).Scan(&id, &version)
	if err == sql.ErrNoRows {
		return "", 0, nil, nil
	}
	if err != nil {
		return "", 0, nil, err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id, idx, title, COALESCE(detail,''), status, COALESCE(notes,''), COALESCE(blocker,'')
		FROM session_plan_steps WHERE plan_id=? ORDER BY idx ASC
	`, id)
	if err != nil {
		return "", 0, nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var sid, title, detail, status, notes, blocker string
		var idx int
		if err := rows.Scan(&sid, &idx, &title, &detail, &status, &notes, &blocker); err != nil {
			return "", 0, nil, err
		}
		out = append(out, map[string]any{
			"id": sid, "idx": idx, "title": title, "detail": detail,
			"status": status, "notes": notes, "blocker": blocker,
		})
	}
	return id, version, out, nil
}
