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
	mgr := NewManager(db, map[string]providers.Client{"openai": p}, &tools.Executor{DB: db, ArtifactsDir: filepath.Join(tmp, "artifacts")})
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
