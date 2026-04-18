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
	approvalDefaultTimeoutSec = 900 // 15 minutes
	approvalMaxTimeoutSec     = 3600
	approvalPollInterval      = 500 * time.Millisecond
)

func (e *Executor) approvalRequest(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Reason         string `json:"reason"`
		Details        string `json:"details"`
		Risk           string `json:"risk"`
		PlanStepID     string `json:"plan_step_id"`
		TimeoutSeconds int    `json:"timeout_seconds"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		return Result{}, fmt.Errorf("reason required")
	}
	if e.DB == nil {
		return Result{}, fmt.Errorf("approval.request requires a database")
	}
	timeout := req.TimeoutSeconds
	if timeout <= 0 {
		timeout = approvalDefaultTimeoutSec
	}
	if timeout > approvalMaxTimeoutSec {
		timeout = approvalMaxTimeoutSec
	}

	if decided, ok, err := e.checkExistingApproval(ctx, runCtx.RunID, runCtx.StepID, reason); err != nil {
		return Result{}, err
	} else if ok {
		return Result{Output: decided}, nil
	}

	planStepID := strings.TrimSpace(req.PlanStepID)
	if planStepID != "" {
		if err := e.validatePlanStepForRun(ctx, runCtx.RunID, planStepID); err != nil {
			return Result{}, err
		}
	}

	approvalID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := e.DB.ExecContext(ctx, `
		INSERT INTO approvals(id, run_id, step_id, reason, status, source, details, risk, plan_step_id, requested_at)
		VALUES(?, ?, ?, ?, 'pending', 'model', ?, ?, ?, ?)
	`, approvalID, runCtx.RunID, runCtx.StepID, reason, req.Details, req.Risk, planStepID, now)
	if err != nil {
		return Result{}, err
	}
	if e.EventSink != nil {
		payload := map[string]any{
			"approval_id": approvalID,
			"reason":      reason,
			"details":     req.Details,
			"risk":        req.Risk,
			"source":      "model",
		}
		if planStepID != "" {
			payload["plan_step_id"] = planStepID
		}
		_ = e.EventSink.AppendEvent(ctx, runCtx.RunID, runCtx.StepID, "approval.requested", payload)
	}

	deadline := time.Now().Add(time.Duration(timeout) * time.Second)
	for {
		status, note, decidedBy, err := e.pollApproval(ctx, approvalID)
		if err != nil {
			return Result{}, err
		}
		if status != "pending" {
			approved := status == "approved"
			return Result{Output: map[string]any{
				"approval_id": approvalID,
				"approved":    approved,
				"status":      status,
				"note":        note,
				"decided_by":  decidedBy,
				"reason":      reason,
			}}, nil
		}
		if time.Now().After(deadline) {
			_, _ = e.DB.ExecContext(ctx,
				`UPDATE approvals SET status='timed_out', decided_at=?, decided_by='system' WHERE id=? AND status='pending'`,
				time.Now().UTC().Format(time.RFC3339Nano), approvalID)
			return Result{Output: map[string]any{
				"approval_id": approvalID,
				"approved":    false,
				"status":      "timed_out",
				"timed_out":   true,
				"reason":      reason,
			}}, nil
		}
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case <-time.After(approvalPollInterval):
		}
	}
}

func (e *Executor) checkExistingApproval(ctx context.Context, runID, stepID, reason string) (map[string]any, bool, error) {
	var id, status, note, decidedBy string
	err := e.DB.QueryRowContext(ctx, `
		SELECT id, status, COALESCE(decision_note,''), COALESCE(decided_by,'')
		FROM approvals
		WHERE run_id=? AND step_id=? AND source='model' AND reason=? AND status!='pending'
		ORDER BY requested_at DESC LIMIT 1
	`, runID, stepID, reason).Scan(&id, &status, &note, &decidedBy)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return map[string]any{
		"approval_id": id,
		"approved":    status == "approved",
		"status":      status,
		"note":        note,
		"decided_by":  decidedBy,
		"reason":      reason,
	}, true, nil
}

// validatePlanStepForRun ensures a plan_step_id actually belongs to the plan
// of the chat session that this run is attached to. Prevents a model from
// linking an approval to an unrelated plan step (another session's plan).
func (e *Executor) validatePlanStepForRun(ctx context.Context, runID, planStepID string) error {
	var sessionID string
	err := e.DB.QueryRowContext(ctx, `
		SELECT session_id FROM session_runs WHERE run_id=? LIMIT 1
	`, runID).Scan(&sessionID)
	if err == sql.ErrNoRows || strings.TrimSpace(sessionID) == "" {
		return fmt.Errorf("plan_step_id requires a chat session")
	}
	if err != nil {
		return err
	}
	var found int
	err = e.DB.QueryRowContext(ctx, `
		SELECT 1 FROM session_plan_steps s
		JOIN session_plans p ON p.id=s.plan_id
		WHERE s.id=? AND p.session_id=?
	`, planStepID, sessionID).Scan(&found)
	if err == sql.ErrNoRows {
		return fmt.Errorf("plan_step_id %q not found in this session's plan", planStepID)
	}
	if err != nil {
		return err
	}
	return nil
}

func (e *Executor) pollApproval(ctx context.Context, approvalID string) (status, note, decidedBy string, err error) {
	err = e.DB.QueryRowContext(ctx, `
		SELECT status, COALESCE(decision_note,''), COALESCE(decided_by,'')
		FROM approvals WHERE id=?
	`, approvalID).Scan(&status, &note, &decidedBy)
	return
}
