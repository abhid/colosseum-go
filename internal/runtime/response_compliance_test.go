package runtime

import (
	"strings"
	"testing"
)

func TestEnsureAttachmentReferences(t *testing.T) {
	text := "Screenshot attached below."
	artifacts := []complianceArtifact{
		{ID: "artifact-123", MIME: "image/png"},
	}
	out := ensureAttachmentReferences("run-123", text, text, artifacts)
	if out == text {
		t.Fatalf("expected attachment link to be appended")
	}
	if !strings.Contains(out, "/api/runs/run-123/artifacts/artifact-123/content") {
		t.Fatalf("expected artifact content link in output")
	}
}
