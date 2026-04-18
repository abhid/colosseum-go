package tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
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

type captureSink struct {
	runID, stepID, eventType string
	payload                  map[string]any
	count                    int
}

func (c *captureSink) AppendEvent(_ context.Context, runID, stepID, eventType string, payload map[string]any) error {
	c.runID = runID
	c.stepID = stepID
	c.eventType = eventType
	c.payload = payload
	c.count++
	return nil
}

func setupRecallDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file::memory:?cache=shared")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	stmts := []string{
		`CREATE TABLE runs(id TEXT PRIMARY KEY, task TEXT, workspace_path TEXT, created_at TEXT)`,
		`CREATE TABLE chat_sessions(id TEXT PRIMARY KEY, title TEXT, created_at TEXT)`,
		`CREATE TABLE session_runs(session_id TEXT, run_id TEXT, turn_index INTEGER, created_at TEXT, PRIMARY KEY(session_id,run_id))`,
		`CREATE TABLE artifacts(id TEXT PRIMARY KEY, run_id TEXT, step_id TEXT, kind TEXT, path TEXT, mime_type TEXT, size_bytes INTEGER, created_at TEXT)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("setup schema: %v", err)
		}
	}
	return db
}

func TestRecallArtifactAcrossSessionRuns(t *testing.T) {
	tmp := t.TempDir()
	screenshotPath := filepath.Join(tmp, "screenshot.png")
	if err := os.WriteFile(screenshotPath, []byte("\x89PNGfake"), 0o644); err != nil {
		t.Fatalf("write screenshot: %v", err)
	}
	db := setupRecallDB(t)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	sessionID := uuid.NewString()
	priorRun := uuid.NewString()
	currentRun := uuid.NewString()
	priorArtifact := uuid.NewString()
	if _, err := db.Exec(`INSERT INTO chat_sessions(id,title,created_at) VALUES(?,?,?)`, sessionID, "t", now); err != nil {
		t.Fatal(err)
	}
	for _, rid := range []string{priorRun, currentRun} {
		if _, err := db.Exec(`INSERT INTO runs(id,task,workspace_path,created_at) VALUES(?,?,?,?)`, rid, "t", tmp, now); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO session_runs(session_id,run_id,turn_index,created_at) VALUES(?,?,?,?),(?,?,?,?)`,
		sessionID, priorRun, 1, now, sessionID, currentRun, 2, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO artifacts(id,run_id,step_id,kind,path,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		priorArtifact, priorRun, "", "screenshot", screenshotPath, "image/png", int64(8), now); err != nil {
		t.Fatal(err)
	}

	sink := &captureSink{}
	exec := &Executor{DB: db, ArtifactsDir: tmp, EventSink: sink}
	res, err := exec.recallArtifact(context.Background(), Context{
		RunID: currentRun, Workspace: tmp,
	}, json.RawMessage(`{"artifact_id":"`+priorArtifact+`","note":"recall for OCR"}`))
	if err != nil {
		t.Fatalf("recallArtifact error: %v", err)
	}
	if ok, _ := res.Output["ok"].(bool); !ok {
		t.Fatalf("expected ok=true, got %v", res.Output)
	}
	newID, _ := res.Output["artifact_id"].(string)
	if strings.TrimSpace(newID) == "" {
		t.Fatalf("expected new artifact_id in output")
	}
	if newID == priorArtifact {
		t.Fatalf("expected a fresh artifact id bound to current run, got the prior id")
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(1) FROM artifacts WHERE run_id=? AND path=?`, currentRun, screenshotPath).Scan(&count); err != nil {
		t.Fatalf("count artifacts: %v", err)
	}
	if count == 0 {
		t.Fatalf("expected new artifact row under current run")
	}

	if sink.count != 1 || sink.eventType != "user.event" {
		t.Fatalf("expected one user.event appended, got count=%d type=%q", sink.count, sink.eventType)
	}
	atts, _ := sink.payload["attachments"].([]string)
	if len(atts) != 1 || atts[0] != newID {
		t.Fatalf("expected attachments=[%s], got %v", newID, sink.payload["attachments"])
	}
	if src, _ := sink.payload["source"].(string); src != "tool.recall_artifact" {
		t.Fatalf("expected source tool.recall_artifact, got %q", src)
	}
}

func TestRecallArtifactRequiresMatch(t *testing.T) {
	db := setupRecallDB(t)
	exec := &Executor{DB: db, EventSink: &captureSink{}}
	if _, err := exec.recallArtifact(context.Background(), Context{RunID: "missing", Workspace: t.TempDir()},
		json.RawMessage(`{"artifact_id":"does-not-exist"}`)); err == nil {
		t.Fatalf("expected error for unknown artifact")
	}
	if _, err := exec.recallArtifact(context.Background(), Context{RunID: "r", Workspace: t.TempDir()},
		json.RawMessage(`{}`)); err == nil {
		t.Fatalf("expected error when no identifier provided")
	}
}

func TestSafePathRejectsWorkspacePrefixCollision(t *testing.T) {
	base := filepath.Join(t.TempDir(), "workspace")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatal(err)
	}
	allowed, err := safePath(base, "nested/file.txt")
	if err != nil {
		t.Fatalf("expected valid path, got %v", err)
	}
	if !strings.HasPrefix(allowed, base) {
		t.Fatalf("expected path under workspace, got %q", allowed)
	}

	escaped := filepath.Join("..", "outside.txt")
	if _, err := safePath(base, escaped); err == nil {
		t.Fatalf("expected escaped path to be rejected")
	}
}
