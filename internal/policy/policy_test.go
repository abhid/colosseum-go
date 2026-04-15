package policy

import (
	"encoding/json"
	"testing"
)

func TestEvaluateToolBlocksFileSchemeForWebFetch(t *testing.T) {
	d := EvaluateTool("web.fetch", json.RawMessage(`{"url":"file:///etc/passwd"}`), []string{"web.fetch"})
	if d.Allow {
		t.Fatalf("expected web.fetch with file scheme to be denied")
	}
}

func TestEvaluateToolRequiresApprovalForLocalBrowserTarget(t *testing.T) {
	d := EvaluateTool("browser.open", json.RawMessage(`{"url":"http://localhost:8080"}`), []string{"browser.open"})
	if !d.Allow {
		t.Fatalf("expected browser.open local target to be allowed with approval")
	}
	if !d.RequireApproval {
		t.Fatalf("expected browser.open local target to require approval")
	}
}
