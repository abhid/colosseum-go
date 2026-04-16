package runtime

import (
	"strings"
	"testing"

	"github.com/adevireddy/colosseum/internal/providers"
)

func TestDropPriorAttachmentContextMessages(t *testing.T) {
	in := []providers.Message{
		{Role: "user", Content: "describe this image"},
		{
			Role:    "user",
			Content: "User attached file(s) for this run:\n- [old](/api/runs/r/artifacts/old/content)",
			ContentParts: []providers.ContentPart{
				{Type: "text", Text: "User attached file(s) for this run:"},
				{Type: "image_url", URL: "data:image/jpeg;base64,abc"},
			},
		},
		{
			Role:    "assistant",
			Content: "processing...",
		},
	}
	out := dropPriorAttachmentContextMessages(in)
	if len(out) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(out))
	}
	if out[0].Content != "describe this image" {
		t.Fatalf("expected base user message to remain")
	}
	if out[1].Role != "assistant" {
		t.Fatalf("expected assistant message to remain")
	}
}

func TestSummarizeSVGContent(t *testing.T) {
	raw := []byte(`<svg><title>Hermes logo</title><desc>Winged symbol</desc></svg>`)
	out := summarizeSVGContent(raw)
	if !strings.Contains(strings.ToLower(out), "hermes logo") {
		t.Fatalf("expected svg title in summary, got %q", out)
	}
	if !strings.Contains(strings.ToLower(out), "winged symbol") {
		t.Fatalf("expected svg desc in summary, got %q", out)
	}
}
