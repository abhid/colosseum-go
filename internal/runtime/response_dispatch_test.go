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
