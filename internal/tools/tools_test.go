package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestJSONQuery(t *testing.T) {
	exec := &Executor{}
	in := json.RawMessage(`{"input":{"outer":{"items":[{"name":"alpha"},{"name":"beta"}]}},"path":"outer.items.1.name"}`)
	res, err := exec.jsonQuery(in)
	if err != nil {
		t.Fatalf("jsonQuery error: %v", err)
	}
	val, ok := res.Output["value"]
	if !ok {
		t.Fatalf("missing value in output")
	}
	if got, _ := val.(string); got != "beta" {
		t.Fatalf("expected beta, got %v", val)
	}
}

func TestPathGlob(t *testing.T) {
	tmp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmp, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "nested", "one.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "nested", "two.md"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	exec := &Executor{}
	res, err := exec.pathGlob(Context{Workspace: tmp}, json.RawMessage(`{"pattern":"nested/*.txt"}`))
	if err != nil {
		t.Fatalf("pathGlob error: %v", err)
	}
	count, _ := res.Output["count"].(int)
	if count != 1 {
		t.Fatalf("expected 1 match, got %v", res.Output["count"])
	}
}

func TestFileReadRange(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "sample.txt")
	body := "line1\nline2\nline3\nline4\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	exec := &Executor{}
	res, err := exec.fileReadRange(Context{Workspace: tmp}, json.RawMessage(`{"path":"sample.txt","start_line":2,"end_line":3}`))
	if err != nil {
		t.Fatalf("fileReadRange error: %v", err)
	}
	content, _ := res.Output["content"].(string)
	if content != "line2\nline3" {
		t.Fatalf("unexpected range content: %q", content)
	}
}

func TestWebFetchRejectsFileScheme(t *testing.T) {
	exec := &Executor{}
	_, err := exec.webFetch(context.Background(), json.RawMessage(`{"url":"file:///etc/passwd"}`))
	if err == nil {
		t.Fatalf("expected file scheme rejection")
	}
}

func TestParsePlaywrightImageVersion(t *testing.T) {
	tests := []struct {
		image string
		want  string
	}{
		{image: "mcr.microsoft.com/playwright:v1.59.1-jammy", want: "1.59.1"},
		{image: "mcr.microsoft.com/playwright:v1.58.2-noble", want: "1.58.2"},
		{image: "mcr.microsoft.com/playwright:v1.58.2", want: "1.58.2"},
		{image: "mcr.microsoft.com/playwright:latest", want: ""},
		{image: "custom/image:dev", want: ""},
	}
	for _, tt := range tests {
		if got := parsePlaywrightImageVersion(tt.image); got != tt.want {
			t.Fatalf("parsePlaywrightImageVersion(%q) = %q, want %q", tt.image, got, tt.want)
		}
	}
}

func TestValidatePlaywrightVersionMatch(t *testing.T) {
	if err := validatePlaywrightVersionMatch("mcr.microsoft.com/playwright:v1.59.1-jammy", "1.59.1"); err != nil {
		t.Fatalf("expected matching versions to pass, got %v", err)
	}
	if err := validatePlaywrightVersionMatch("mcr.microsoft.com/playwright:v1.59.1-jammy", "1.58.2"); err == nil {
		t.Fatalf("expected mismatch error")
	}
	if err := validatePlaywrightVersionMatch("custom/image:dev", "1.59.1"); err != nil {
		t.Fatalf("expected non-standard tags to skip validation, got %v", err)
	}
}

func TestRewriteDockerSessionPath(t *testing.T) {
	base := filepath.Join(string(filepath.Separator), "tmp", "run", "browser-session")
	got := rewriteDockerSessionPath("/session/latest.png", base)
	want := filepath.Join(base, "latest.png")
	if got != want {
		t.Fatalf("rewriteDockerSessionPath() = %q, want %q", got, want)
	}
	unchanged := rewriteDockerSessionPath("/tmp/other.png", base)
	if unchanged != "/tmp/other.png" {
		t.Fatalf("expected non-session path unchanged, got %q", unchanged)
	}
	noEscape := rewriteDockerSessionPath("/session/../secrets.txt", base)
	if !strings.HasPrefix(noEscape, base) {
		t.Fatalf("expected rewritten path to stay under session dir, got %q", noEscape)
	}
}
