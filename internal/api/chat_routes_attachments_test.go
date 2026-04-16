package api

import (
	"strings"
	"testing"
)

func TestBuildAttachmentUserEventMessage(t *testing.T) {
	msg := buildAttachmentUserEventMessage("run-123", []map[string]any{
		{
			"name":        "IMG_4143.jpg",
			"artifact_id": "artifact-abc",
		},
	})
	if !strings.Contains(msg, "User attached file(s) for this run:") {
		t.Fatalf("expected attachment heading in message")
	}
	if !strings.Contains(msg, "/api/runs/run-123/artifacts/artifact-abc/content") {
		t.Fatalf("expected artifact content link in message")
	}
}
