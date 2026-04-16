package api

import (
	"path/filepath"
	"testing"
)

func TestEnsurePathWithinRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "workspaces")
	inside := filepath.Join(root, "run-1")
	resolvedInside, err := ensurePathWithinRoot(root, inside)
	if err != nil {
		t.Fatalf("expected inside path to pass: %v", err)
	}
	if resolvedInside != inside {
		t.Fatalf("expected resolved path %q, got %q", inside, resolvedInside)
	}

	outside := filepath.Join(root+"-other", "run-2")
	if _, err := ensurePathWithinRoot(root, outside); err == nil {
		t.Fatalf("expected outside path to fail")
	}
}
