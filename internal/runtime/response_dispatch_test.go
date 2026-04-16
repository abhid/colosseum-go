package runtime

import (
	"strings"
	"testing"
)

func TestAppendAllowedArtifactLinks(t *testing.T) {
	artifacts := []complianceArtifact{
		{ID: "artifact-ok", MIME: "image/png"},
	}
	text := "Screenshot attached below."
	out := appendAllowedArtifactLinks(
		"run-123",
		text,
		[]string{
			"/api/runs/run-123/artifacts/artifact-ok/content",
			"/api/runs/run-123/artifacts/artifact-bad/content",
		},
		artifacts,
	)
	if out == text {
		t.Fatalf("expected output to include appended allowed link")
	}
	if !strings.Contains(out, "/api/runs/run-123/artifacts/artifact-ok/content") {
		t.Fatalf("expected allowed artifact link to be appended")
	}
	if strings.Contains(out, "artifact-bad") {
		t.Fatalf("unexpected disallowed artifact link")
	}
}

func TestParseDispatchEnvelope(t *testing.T) {
	raw := `{"user_response_markdown":"Done.","artifact_links":["/api/runs/r/artifacts/a/content"],"compliance_notes":"ok"}`
	parsed := parseDispatchEnvelope(raw)
	if parsed == nil {
		t.Fatalf("expected envelope to parse")
	}
	if parsed.UserResponseMarkdown != "Done." {
		t.Fatalf("unexpected user response markdown: %q", parsed.UserResponseMarkdown)
	}
	if len(parsed.ArtifactLinks) != 1 {
		t.Fatalf("expected one artifact link")
	}
}

func TestShouldDispatchAssistantResponse(t *testing.T) {
	tests := []struct {
		name string
		text string
		want bool
	}{
		{name: "clean answer", text: "The logo is blue and white.", want: false},
		{name: "uuid heavy", text: "artifact 123e4567-e89b-12d3-a456-426614174000 and 123e4567-e89b-12d3-a456-426614174001", want: true},
		{name: "artifact metadata dump", text: "artifact: abc123", want: true},
		{name: "telemetry dump", text: "input_tokens=123 output_tokens=45", want: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, _ := shouldDispatchAssistantResponse(tc.text)
			if got != tc.want {
				t.Fatalf("expected %v, got %v", tc.want, got)
			}
		})
	}
}
