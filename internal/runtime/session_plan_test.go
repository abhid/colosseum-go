package runtime

import (
	"strings"
	"testing"
)

func TestRenderPlanSectionElidesOldCompleted(t *testing.T) {
	p := &sessionPlan{
		ID: "plan1", Version: 3, Title: "Big plan",
		Steps: []sessionPlanStep{
			{Title: "one", Status: "completed"},
			{Title: "two", Status: "completed"},
			{Title: "three", Status: "completed"},
			{Title: "four", Status: "completed"},
			{Title: "five", Status: "completed"},
			{Title: "current", Status: "in_progress", Detail: "working on it", Owner: "run-abc123xyz"},
			{Title: "next", Status: "pending"},
		},
	}
	out := renderPlanSection(p)
	if !strings.Contains(out, "## Current plan (v3, \"Big plan\")") {
		t.Fatalf("missing header: %q", out)
	}
	// Tail 3 completed verbatim: three, four, five
	for _, want := range []string{"three", "four", "five"} {
		if !strings.Contains(out, "[done] "+want) {
			t.Fatalf("expected tailing completed %q in output: %q", want, out)
		}
	}
	// Older two should be elided.
	if strings.Contains(out, "[done] one") || strings.Contains(out, "[done] two") {
		t.Fatalf("older completed steps should have been elided: %q", out)
	}
	if !strings.Contains(out, "2 earlier steps completed") {
		t.Fatalf("expected elision summary line: %q", out)
	}
	if !strings.Contains(out, "in progress · run run-abc1") {
		t.Fatalf("expected in_progress line with short run id: %q", out)
	}
	if !strings.Contains(out, "detail: working on it") {
		t.Fatalf("expected in_progress detail: %q", out)
	}
	if !strings.Contains(out, "[pending] next") {
		t.Fatalf("expected pending step: %q", out)
	}
}

func TestRenderPlanSectionEmpty(t *testing.T) {
	if renderPlanSection(nil) != "" {
		t.Fatalf("expected empty string for nil plan")
	}
	if renderPlanSection(&sessionPlan{ID: "x"}) != "" {
		t.Fatalf("expected empty string for plan with no steps")
	}
}

func TestRenderPlanSectionHardTruncation(t *testing.T) {
	var steps []sessionPlanStep
	long := strings.Repeat("A", 300)
	for i := 0; i < 50; i++ {
		steps = append(steps, sessionPlanStep{Title: long, Status: "pending"})
	}
	out := renderPlanSection(&sessionPlan{ID: "p", Version: 1, Steps: steps})
	if len(out) > planSectionMaxLen+100 {
		t.Fatalf("expected hard truncation near %d bytes, got %d", planSectionMaxLen, len(out))
	}
	if !strings.Contains(out, "plan truncated") {
		t.Fatalf("expected 'plan truncated' marker, got %q", out[:200])
	}
}

func TestRenderPlanSectionCompletedFlag(t *testing.T) {
	p := &sessionPlan{
		ID: "p", Version: 1, CompletedAt: "2026-04-18T00:00:00Z",
		Steps: []sessionPlanStep{{Title: "only", Status: "completed"}},
	}
	out := renderPlanSection(p)
	if !strings.Contains(out, ", completed)") {
		t.Fatalf("expected 'completed' suffix in header: %q", out)
	}
}

func TestRenderPlanningNudgeModes(t *testing.T) {
	if renderPlanningNudge("off", nil) != "" {
		t.Fatalf("expected 'off' mode to produce empty nudge")
	}
	if !strings.Contains(renderPlanningNudge("suggest", nil), "If this task will take more than") {
		t.Fatalf("expected empty-plan suggest nudge")
	}
	if !strings.Contains(renderPlanningNudge("suggest", &sessionPlan{Steps: []sessionPlanStep{{}}}), "working contract") {
		t.Fatalf("expected plan-exists suggest nudge")
	}
	if !strings.Contains(renderPlanningNudge("required", nil), "Before your first non-read tool call") {
		t.Fatalf("expected empty-plan required nudge")
	}
	if !strings.Contains(renderPlanningNudge("required", &sessionPlan{Steps: []sessionPlanStep{{}}}), "Claim the next step") {
		t.Fatalf("expected plan-exists required nudge")
	}
}

func TestPendingDetailElidedWhenManyPending(t *testing.T) {
	var steps []sessionPlanStep
	for i := 0; i < pendingDetailCap+5; i++ {
		steps = append(steps, sessionPlanStep{Title: "p", Detail: "short detail", Status: "pending"})
	}
	out := renderPlanSection(&sessionPlan{ID: "p", Version: 1, Steps: steps})
	if strings.Contains(out, "— short detail") {
		t.Fatalf("expected pending detail elided when count > %d: %q", pendingDetailCap, out)
	}
}
