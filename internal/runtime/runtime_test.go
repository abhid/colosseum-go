package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	dbpkg "github.com/adevireddy/colosseum/internal/db"
	"github.com/adevireddy/colosseum/internal/providers"
	"github.com/adevireddy/colosseum/internal/tools"
)

type fakeProvider struct {
	calls int
}

func (f *fakeProvider) ProviderName() string { return "fake" }

func (f *fakeProvider) Complete(ctx context.Context, req providers.CompletionRequest) (providers.CompletionResponse, error) {
	f.calls++
	if f.calls == 1 {
		return providers.CompletionResponse{ToolCalls: []providers.ToolCall{{ID: "tc1", Name: "file.write", Arguments: json.RawMessage(`{"path":"hello.txt","content":"hello"}`)}}}, nil
	}
	return providers.CompletionResponse{Text: "done"}, nil
}

func TestRuntimeCompletesRun(t *testing.T) {
	tmp := t.TempDir()
	dbPath := filepath.Join(tmp, "test.db")
	db, err := dbpkg.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := dbpkg.Migrate(db); err != nil {
		t.Fatal(err)
	}

	workspace := filepath.Join(tmp, "ws")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = db.Exec(`INSERT INTO agents(id,name,description,provider,model,system_prompt,allowed_tools,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, "a1", "agent", "", "openai", "gpt-4.1-mini", "", `[]`, now, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO runs(id,agent_id,status,task,workspace_path,provider,model,max_steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, "r1", "a1", "queued", "create file", workspace, "openai", "gpt-4.1-mini", 5, now, now)
	if err != nil {
		t.Fatal(err)
	}

	p := &fakeProvider{}
	mgr := NewManager(db, map[string]providers.Client{"openai": p}, &tools.Executor{DB: db, ArtifactsDir: filepath.Join(tmp, "artifacts")}, "", "")
	mgr.processOne(context.Background())

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status := runStatus(t, db, "r1")
		if status == "completed" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if got := runStatus(t, db, "r1"); got != "completed" {
		t.Fatalf("expected completed, got %s", got)
	}
	content, err := os.ReadFile(filepath.Join(workspace, "hello.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "hello" {
		t.Fatalf("unexpected file content: %s", string(content))
	}
}

func runStatus(t *testing.T, db *sql.DB, id string) string {
	t.Helper()
	var status string
	if err := db.QueryRow(`SELECT status FROM runs WHERE id=?`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

func TestProcessOneSerializesSessionTurns(t *testing.T) {
	tmp := t.TempDir()
	dbPath := filepath.Join(tmp, "test.db")
	db, err := dbpkg.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := dbpkg.Migrate(db); err != nil {
		t.Fatal(err)
	}

	workspace := filepath.Join(tmp, "ws")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)

	_, err = db.Exec(`INSERT INTO agents(id,name,description,provider,model,system_prompt,allowed_tools,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, "a1", "agent", "", "openai", "gpt-4.1-mini", "", `[]`, now, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO chat_sessions(id,agent_id,title,created_at,updated_at) VALUES(?,?,?,?,?)`, "sess-1", "a1", "t", now, now)
	if err != nil {
		t.Fatal(err)
	}

	// Turn 1 is already running; turn 2 is queued behind it.
	_, err = db.Exec(`INSERT INTO runs(id,agent_id,status,task,workspace_path,provider,model,max_steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, "r1", "a1", "running", "first", workspace, "openai", "gpt-4.1-mini", 5, now, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO runs(id,agent_id,status,task,workspace_path,provider,model,max_steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, "r2", "a1", "queued", "second", workspace, "openai", "gpt-4.1-mini", 5, now, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO session_runs(session_id,run_id,turn_index,created_at) VALUES(?,?,?,?)`, "sess-1", "r1", 1, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO session_runs(session_id,run_id,turn_index,created_at) VALUES(?,?,?,?)`, "sess-1", "r2", 2, now)
	if err != nil {
		t.Fatal(err)
	}

	p := &fakeProvider{}
	mgr := NewManager(db, map[string]providers.Client{"openai": p}, &tools.Executor{DB: db, ArtifactsDir: filepath.Join(tmp, "artifacts")}, "", "")

	// Turn 1 still running → processOne must NOT pick up turn 2.
	mgr.processOne(context.Background())
	time.Sleep(50 * time.Millisecond)
	if got := runStatus(t, db, "r2"); got != "queued" {
		t.Fatalf("expected r2 to stay queued while r1 running, got %s", got)
	}

	// Mark turn 1 completed. Next processOne should now claim turn 2.
	if _, err := db.Exec(`UPDATE runs SET status='completed', updated_at=? WHERE id=?`, now, "r1"); err != nil {
		t.Fatal(err)
	}
	mgr.processOne(context.Background())
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if runStatus(t, db, "r2") != "queued" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if got := runStatus(t, db, "r2"); got == "queued" {
		t.Fatalf("expected r2 to progress past queued after r1 completed, still queued")
	}
}
