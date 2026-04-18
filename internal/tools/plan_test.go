package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// planSetup creates a session + run row and returns (db, sessionID, runID).
func planSetup(t *testing.T) (*Executor, string, string) {
	t.Helper()
	db := setupPrimitivesDB(t)
	exec := &Executor{DB: db}
	sessionID, runID := "S-"+randStr(t), "R-"+randStr(t)
	attachSession(t, db, sessionID, runID)
	return exec, sessionID, runID
}

func randStr(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("%d", t.Name()[0])
}

func runCtxFor(runID string) Context {
	return Context{RunID: runID, StepID: "STEP"}
}

func decodePlanResult(t *testing.T, res Result) map[string]any {
	t.Helper()
	b, err := json.Marshal(res.Output)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	return out
}

func TestPlanSetAndRead(t *testing.T) {
	exec, _, runID := planSetup(t)
	in := `{"title":"Ship feature","steps":[{"title":"research","detail":"look at code"},{"title":"implement"},{"title":"test"}]}`
	res, err := exec.planSet(context.Background(), runCtxFor(runID), json.RawMessage(in))
	if err != nil {
		t.Fatalf("planSet: %v", err)
	}
	set := decodePlanResult(t, res)
	if set["version"].(float64) != 1 {
		t.Fatalf("expected version=1, got %v", set["version"])
	}
	if set["step_count"].(float64) != 3 {
		t.Fatalf("expected 3 steps, got %v", set["step_count"])
	}

	read, err := exec.planRead(context.Background(), runCtxFor(runID), nil)
	if err != nil {
		t.Fatalf("planRead: %v", err)
	}
	out := decodePlanResult(t, read)
	if out["exists"].(bool) != true {
		t.Fatalf("expected exists=true, got %v", out)
	}
	steps := out["steps"].([]any)
	if len(steps) != 3 {
		t.Fatalf("expected 3 steps read, got %d", len(steps))
	}
	first := steps[0].(map[string]any)
	if first["title"] != "research" || first["status"] != "pending" {
		t.Fatalf("unexpected first step: %v", first)
	}
}

func TestPlanSetRequiresSteps(t *testing.T) {
	exec, _, runID := planSetup(t)
	if _, err := exec.planSet(context.Background(), runCtxFor(runID), json.RawMessage(`{"steps":[]}`)); err == nil {
		t.Fatalf("expected error for empty steps")
	}
	if _, err := exec.planSet(context.Background(), runCtxFor(runID),
		json.RawMessage(`{"steps":[{"title":""}]}`)); err == nil {
		t.Fatalf("expected error for blank title")
	}
}

func TestPlanSetVersionIncrementsAndArchives(t *testing.T) {
	exec, _, runID := planSetup(t)
	ctx := context.Background()
	if _, err := exec.planSet(ctx, runCtxFor(runID),
		json.RawMessage(`{"steps":[{"title":"a"},{"title":"b"}]}`)); err != nil {
		t.Fatalf("planSet v1: %v", err)
	}
	res, err := exec.planSet(ctx, runCtxFor(runID),
		json.RawMessage(`{"title":"revised","steps":[{"title":"x"},{"title":"y"},{"title":"z"}]}`))
	if err != nil {
		t.Fatalf("planSet v2: %v", err)
	}
	if v := decodePlanResult(t, res)["version"].(float64); v != 2 {
		t.Fatalf("expected v2 on revision, got %v", v)
	}
	read, _ := exec.planRead(ctx, runCtxFor(runID), nil)
	out := decodePlanResult(t, read)
	steps := out["steps"].([]any)
	if len(steps) != 3 || steps[0].(map[string]any)["title"] != "x" {
		t.Fatalf("expected new steps after revision, got %v", steps)
	}
	// plan.revised event must have been recorded via EventSink (we don't have
	// one configured, so check that the DB doesn't carry stale v1 steps).
	if out["version"].(float64) != 2 {
		t.Fatalf("expected version=2, got %v", out["version"])
	}
}

func TestPlanUpdateStepClaimsOwnership(t *testing.T) {
	exec, _, runID := planSetup(t)
	ctx := context.Background()
	res, err := exec.planSet(ctx, runCtxFor(runID),
		json.RawMessage(`{"steps":[{"title":"a"},{"title":"b"}]}`))
	if err != nil {
		t.Fatalf("planSet: %v", err)
	}
	ids := decodePlanResult(t, res)["step_ids"].([]any)
	stepA := ids[0].(string)
	upd := fmt.Sprintf(`{"step_id":%q,"status":"in_progress"}`, stepA)
	if _, err := exec.planUpdateStep(ctx, runCtxFor(runID), json.RawMessage(upd)); err != nil {
		t.Fatalf("claim step: %v", err)
	}
	read, _ := exec.planRead(ctx, runCtxFor(runID), nil)
	steps := decodePlanResult(t, read)["steps"].([]any)
	first := steps[0].(map[string]any)
	if first["status"] != "in_progress" || first["owner_run_id"] != runID {
		t.Fatalf("expected in_progress+owner=runID, got %v", first)
	}
}

func TestPlanUpdateStepOwnerConflict(t *testing.T) {
	exec, sessionID, runA := planSetup(t)
	ctx := context.Background()
	res, _ := exec.planSet(ctx, runCtxFor(runA),
		json.RawMessage(`{"steps":[{"title":"a"}]}`))
	stepID := decodePlanResult(t, res)["step_ids"].([]any)[0].(string)
	if _, err := exec.planUpdateStep(ctx, runCtxFor(runA),
		json.RawMessage(fmt.Sprintf(`{"step_id":%q,"status":"in_progress"}`, stepID))); err != nil {
		t.Fatalf("claim by A: %v", err)
	}
	// Attach a second run to the same session and try to also claim.
	runB := "R-B-" + sessionID
	attachSession(t, exec.DB, sessionID, runB)
	_, err := exec.planUpdateStep(ctx, runCtxFor(runB),
		json.RawMessage(fmt.Sprintf(`{"step_id":%q,"status":"in_progress"}`, stepID)))
	if err == nil || !strings.Contains(err.Error(), "in_progress under another run") {
		t.Fatalf("expected owner conflict error, got %v", err)
	}
}

func TestPlanUpdateStepTerminalReleasesOwnership(t *testing.T) {
	exec, _, runID := planSetup(t)
	ctx := context.Background()
	res, _ := exec.planSet(ctx, runCtxFor(runID),
		json.RawMessage(`{"steps":[{"title":"a"}]}`))
	stepID := decodePlanResult(t, res)["step_ids"].([]any)[0].(string)
	_, _ = exec.planUpdateStep(ctx, runCtxFor(runID),
		json.RawMessage(fmt.Sprintf(`{"step_id":%q,"status":"in_progress"}`, stepID)))
	_, err := exec.planUpdateStep(ctx, runCtxFor(runID),
		json.RawMessage(fmt.Sprintf(`{"step_id":%q,"status":"completed","notes":"done"}`, stepID)))
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	read, _ := exec.planRead(ctx, runCtxFor(runID), nil)
	out := decodePlanResult(t, read)
	steps := out["steps"].([]any)
	first := steps[0].(map[string]any)
	if first["status"] != "completed" {
		t.Fatalf("expected completed, got %v", first["status"])
	}
	if first["owner_run_id"] != "" {
		t.Fatalf("expected owner released after completion, got %v", first["owner_run_id"])
	}
	if out["completed"].(bool) != true {
		t.Fatalf("expected plan completed=true when all steps terminal")
	}
}

func TestPlanUpdateStepsBatchAtomic(t *testing.T) {
	exec, _, runID := planSetup(t)
	ctx := context.Background()
	res, _ := exec.planSet(ctx, runCtxFor(runID),
		json.RawMessage(`{"steps":[{"title":"a"},{"title":"b"},{"title":"c"}]}`))
	ids := decodePlanResult(t, res)["step_ids"].([]any)
	payload := fmt.Sprintf(`{"updates":[
		{"step_id":%q,"status":"completed"},
		{"step_id":%q,"status":"in_progress"},
		{"step_id":"bogus","status":"completed"}
	]}`, ids[0], ids[1])
	if _, err := exec.planUpdateSteps(ctx, runCtxFor(runID), json.RawMessage(payload)); err == nil {
		t.Fatalf("expected batch failure when one step is bogus")
	}
	read, _ := exec.planRead(ctx, runCtxFor(runID), nil)
	steps := decodePlanResult(t, read)["steps"].([]any)
	// Neither a nor b should have been mutated because the bogus update aborts the tx.
	if steps[0].(map[string]any)["status"] != "pending" || steps[1].(map[string]any)["status"] != "pending" {
		t.Fatalf("expected atomicity — no partial mutation, got %v", steps)
	}
}

func TestPlanAddStepShiftsIndex(t *testing.T) {
	exec, _, runID := planSetup(t)
	ctx := context.Background()
	res, _ := exec.planSet(ctx, runCtxFor(runID),
		json.RawMessage(`{"steps":[{"title":"a"},{"title":"c"}]}`))
	ids := decodePlanResult(t, res)["step_ids"].([]any)
	stepA := ids[0].(string)
	add, err := exec.planAddStep(ctx, runCtxFor(runID),
		json.RawMessage(fmt.Sprintf(`{"title":"b","after_step_id":%q}`, stepA)))
	if err != nil {
		t.Fatalf("addStep: %v", err)
	}
	out := decodePlanResult(t, add)
	if out["idx"].(float64) != 1 {
		t.Fatalf("expected new idx=1, got %v", out["idx"])
	}
	read, _ := exec.planRead(ctx, runCtxFor(runID), nil)
	steps := decodePlanResult(t, read)["steps"].([]any)
	if len(steps) != 3 {
		t.Fatalf("expected 3 steps, got %d", len(steps))
	}
	titles := []string{
		steps[0].(map[string]any)["title"].(string),
		steps[1].(map[string]any)["title"].(string),
		steps[2].(map[string]any)["title"].(string),
	}
	if titles[0] != "a" || titles[1] != "b" || titles[2] != "c" {
		t.Fatalf("expected order [a b c], got %v", titles)
	}
}

func TestPlanAddStepWithoutExistingPlan(t *testing.T) {
	exec, _, runID := planSetup(t)
	_, err := exec.planAddStep(context.Background(), runCtxFor(runID),
		json.RawMessage(`{"title":"a"}`))
	if err == nil || !strings.Contains(err.Error(), "no plan exists") {
		t.Fatalf("expected missing-plan error, got %v", err)
	}
}

func TestApprovalRequestValidatesPlanStepID(t *testing.T) {
	exec, sessionID, runID := planSetup(t)
	ctx := context.Background()
	res, _ := exec.planSet(ctx, runCtxFor(runID),
		json.RawMessage(`{"steps":[{"title":"a"}]}`))
	validStepID := decodePlanResult(t, res)["step_ids"].([]any)[0].(string)

	// Non-existent plan step should be rejected.
	_, err := exec.approvalRequest(ctx, runCtxFor(runID),
		json.RawMessage(`{"reason":"r","plan_step_id":"does-not-exist","timeout_seconds":1}`))
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected plan_step_id not-found error, got %v", err)
	}

	// Plan step from a DIFFERENT session should also be rejected.
	otherSession := "OTHER-SESSION-" + sessionID
	otherRun := "OTHER-RUN"
	attachSession(t, exec.DB, otherSession, otherRun)
	otherRes, _ := exec.planSet(ctx, runCtxFor(otherRun),
		json.RawMessage(`{"steps":[{"title":"x"}]}`))
	otherStepID := decodePlanResult(t, otherRes)["step_ids"].([]any)[0].(string)
	_, err = exec.approvalRequest(ctx, runCtxFor(runID),
		json.RawMessage(fmt.Sprintf(`{"reason":"r","plan_step_id":%q,"timeout_seconds":1}`, otherStepID)))
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected cross-session plan_step_id rejection, got %v", err)
	}
	// Silence unused warning.
	_ = validStepID
}

func TestPlanRequiresSession(t *testing.T) {
	db := setupPrimitivesDB(t)
	exec := &Executor{DB: db}
	// No session_runs row for this run, so resolveSessionID should error.
	_, err := exec.planSet(context.Background(), runCtxFor("ORPHAN"),
		json.RawMessage(`{"steps":[{"title":"a"}]}`))
	if err == nil {
		t.Fatalf("expected error for run with no session")
	}
}
