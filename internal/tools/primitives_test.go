package tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// setupPrimitivesDB sets up an in-memory sqlite with the tables the new
// primitives depend on. Foreign keys are intentionally disabled — tests insert
// minimal rows without fully hydrating parent tables.
func setupPrimitivesDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file::memory:?cache=shared&_pragma=foreign_keys(0)")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	stmts := []string{
		`CREATE TABLE session_runs(session_id TEXT, run_id TEXT, turn_index INTEGER, created_at TEXT, PRIMARY KEY(session_id,run_id))`,
		`CREATE TABLE session_scratchpad(
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE(session_id, key)
		)`,
		`CREATE TABLE approvals(
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			step_id TEXT NOT NULL DEFAULT '',
			reason TEXT NOT NULL,
			status TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'policy',
			details TEXT NOT NULL DEFAULT '',
			risk TEXT NOT NULL DEFAULT '',
			requested_at TEXT NOT NULL,
			decided_at TEXT,
			decided_by TEXT NOT NULL DEFAULT '',
			decision_note TEXT NOT NULL DEFAULT '',
			plan_step_id TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE session_plans(
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL DEFAULT '',
			version INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			completed_at TEXT
		)`,
		`CREATE TABLE session_plan_steps(
			id TEXT PRIMARY KEY,
			plan_id TEXT NOT NULL,
			idx INTEGER NOT NULL,
			title TEXT NOT NULL,
			detail TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL,
			blocker TEXT NOT NULL DEFAULT '',
			owner_run_id TEXT NOT NULL DEFAULT '',
			started_at TEXT,
			completed_at TEXT,
			notes TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE run_processes(
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			label TEXT NOT NULL DEFAULT '',
			pid INTEGER NOT NULL,
			command TEXT NOT NULL,
			log_path TEXT NOT NULL,
			status TEXT NOT NULL,
			exit_code INTEGER,
			started_at TEXT NOT NULL,
			ended_at TEXT
		)`,
		`CREATE TABLE runs(
			id TEXT PRIMARY KEY,
			agent_id TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'queued',
			task TEXT NOT NULL DEFAULT '',
			workspace_path TEXT NOT NULL DEFAULT '',
			provider TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL DEFAULT '',
			max_steps INTEGER NOT NULL DEFAULT 30,
			environment_id TEXT NOT NULL DEFAULT '',
			credential_vault_id TEXT NOT NULL DEFAULT '',
			output_contract_type TEXT NOT NULL DEFAULT 'none',
			output_contract_payload TEXT NOT NULL DEFAULT '',
			parent_run_id TEXT NOT NULL DEFAULT '',
			replay_source_run_id TEXT NOT NULL DEFAULT '',
			replay_from_step INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			started_at TEXT,
			completed_at TEXT,
			error TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE agents(
			id TEXT PRIMARY KEY,
			provider TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL DEFAULT '',
			default_max_steps INTEGER NOT NULL DEFAULT 30,
			default_workspace_path TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE events(
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			seq INTEGER NOT NULL,
			payload_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE run_steps(
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			idx INTEGER NOT NULL,
			step_type TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'ok',
			input_json TEXT NOT NULL DEFAULT '{}',
			output_json TEXT NOT NULL DEFAULT '{}',
			error TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("setup schema: %v", err)
		}
	}
	return db
}

func attachSession(t *testing.T, db *sql.DB, sessionID, runID string) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(
		`INSERT INTO session_runs(session_id, run_id, turn_index, created_at) VALUES(?,?,?,?)`,
		sessionID, runID, 1, now); err != nil {
		t.Fatalf("attach session: %v", err)
	}
}

// --- clock.now ---

func TestClockNowShape(t *testing.T) {
	exec := &Executor{}
	res, err := exec.clockNow(nil)
	if err != nil {
		t.Fatalf("clockNow: %v", err)
	}
	for _, k := range []string{"unix", "unix_ms", "iso_utc", "iso_local", "timezone", "date", "time", "weekday"} {
		if _, ok := res.Output[k]; !ok {
			t.Fatalf("missing %q in clock.now output: %v", k, res.Output)
		}
	}
	if _, err := time.Parse(time.RFC3339Nano, res.Output["iso_utc"].(string)); err != nil {
		t.Fatalf("iso_utc not RFC3339Nano: %v", err)
	}
}

// --- env.inspect ---

func TestEnvInspectReturnsOnlyInjected(t *testing.T) {
	exec := &Executor{}
	runCtx := Context{EnvVars: map[string]string{"API_KEY": "secret", "STAGE": "dev"}}
	res, err := exec.envInspect(runCtx, json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("envInspect: %v", err)
	}
	env := res.Output["env"].(map[string]string)
	if env["API_KEY"] != "secret" || env["STAGE"] != "dev" || len(env) != 2 {
		t.Fatalf("expected injected vars only, got %v", env)
	}
	// PATH from host must NOT appear.
	if _, leak := env["PATH"]; leak {
		t.Fatalf("env.inspect leaked host PATH")
	}
}

func TestEnvInspectFilterByKeys(t *testing.T) {
	exec := &Executor{}
	runCtx := Context{EnvVars: map[string]string{"A": "1", "B": "2", "C": "3"}}
	res, err := exec.envInspect(runCtx, json.RawMessage(`{"keys":["A","C","MISSING"]}`))
	if err != nil {
		t.Fatalf("envInspect: %v", err)
	}
	env := res.Output["env"].(map[string]string)
	if env["A"] != "1" || env["C"] != "3" || len(env) != 2 {
		t.Fatalf("expected {A,C} only, got %v", env)
	}
}

// --- http.request ---

func TestHTTPRequestPOSTJSON(t *testing.T) {
	var gotCT, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCT = r.Header.Get("Content-Type")
		buf := make([]byte, 512)
		n, _ := r.Body.Read(buf)
		gotBody = string(buf[:n])
		w.Header().Set("X-Echo", "ok")
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"echo":true}`))
	}))
	defer srv.Close()
	exec := &Executor{}
	in := fmt.Sprintf(`{"url":%q,"method":"POST","json":{"hello":"world"}}`, srv.URL)
	res, err := exec.httpRequest(context.Background(), json.RawMessage(in))
	if err != nil {
		t.Fatalf("httpRequest: %v", err)
	}
	if res.Output["status"].(int) != 201 {
		t.Fatalf("expected 201, got %v", res.Output["status"])
	}
	if gotCT != "application/json" {
		t.Fatalf("expected application/json content type, got %q", gotCT)
	}
	if !strings.Contains(gotBody, `"hello":"world"`) {
		t.Fatalf("unexpected body: %q", gotBody)
	}
	headers := res.Output["headers"].(map[string]string)
	if headers["X-Echo"] != "ok" {
		t.Fatalf("missing echoed header: %v", headers)
	}
}

func TestHTTPRequestRejectsFileScheme(t *testing.T) {
	exec := &Executor{}
	_, err := exec.httpRequest(context.Background(), json.RawMessage(`{"url":"file:///etc/passwd"}`))
	if err == nil {
		t.Fatalf("expected file:// rejection")
	}
}

func TestHTTPRequestMaxBytesTruncation(t *testing.T) {
	big := strings.Repeat("x", 4096)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(big))
	}))
	defer srv.Close()
	exec := &Executor{}
	in := fmt.Sprintf(`{"url":%q,"max_bytes":1024}`, srv.URL)
	res, err := exec.httpRequest(context.Background(), json.RawMessage(in))
	if err != nil {
		t.Fatalf("httpRequest: %v", err)
	}
	if res.Output["content_len"].(int) > 1024 {
		t.Fatalf("expected content truncated to <=1024, got %v", res.Output["content_len"])
	}
}

func TestHTTPRequestCustomHeaders(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()
	exec := &Executor{}
	in := fmt.Sprintf(`{"url":%q,"headers":{"Authorization":"Bearer tok"}}`, srv.URL)
	if _, err := exec.httpRequest(context.Background(), json.RawMessage(in)); err != nil {
		t.Fatalf("httpRequest: %v", err)
	}
	if gotAuth != "Bearer tok" {
		t.Fatalf("custom header not forwarded, got %q", gotAuth)
	}
}

// --- scratchpad.* ---

func TestScratchpadRoundTrip(t *testing.T) {
	db := setupPrimitivesDB(t)
	session := uuid.NewString()
	run := uuid.NewString()
	attachSession(t, db, session, run)
	exec := &Executor{DB: db}
	ctx := context.Background()
	runCtx := Context{RunID: run}

	if _, err := exec.scratchpadWrite(ctx, runCtx,
		json.RawMessage(`{"key":"plan","value":"step1->step2","note":"initial draft"}`)); err != nil {
		t.Fatalf("write: %v", err)
	}
	// Overwrite same key — uses UPSERT path.
	if _, err := exec.scratchpadWrite(ctx, runCtx,
		json.RawMessage(`{"key":"plan","value":"step1->step2->step3"}`)); err != nil {
		t.Fatalf("write upsert: %v", err)
	}

	res, err := exec.scratchpadRead(ctx, runCtx, json.RawMessage(`{"key":"plan"}`))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if res.Output["found"] != true {
		t.Fatalf("expected found=true, got %v", res.Output)
	}
	if res.Output["value"] != "step1->step2->step3" {
		t.Fatalf("expected upserted value, got %v", res.Output["value"])
	}

	// List returns the one entry.
	list, err := exec.scratchpadRead(ctx, runCtx, json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if list.Output["count"].(int) != 1 {
		t.Fatalf("expected 1 entry, got %v", list.Output["count"])
	}

	delRes, err := exec.scratchpadDelete(ctx, runCtx, json.RawMessage(`{"key":"plan"}`))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if delRes.Output["deleted"] != true {
		t.Fatalf("expected deleted=true")
	}
	after, _ := exec.scratchpadRead(ctx, runCtx, json.RawMessage(`{"key":"plan"}`))
	if after.Output["found"] != false {
		t.Fatalf("expected found=false after delete, got %v", after.Output)
	}
}

func TestScratchpadSessionIsolation(t *testing.T) {
	db := setupPrimitivesDB(t)
	sessA := uuid.NewString()
	sessB := uuid.NewString()
	runA := uuid.NewString()
	runB := uuid.NewString()
	attachSession(t, db, sessA, runA)
	attachSession(t, db, sessB, runB)
	exec := &Executor{DB: db}
	ctx := context.Background()

	if _, err := exec.scratchpadWrite(ctx, Context{RunID: runA},
		json.RawMessage(`{"key":"shared","value":"from-A"}`)); err != nil {
		t.Fatalf("write A: %v", err)
	}
	if _, err := exec.scratchpadWrite(ctx, Context{RunID: runB},
		json.RawMessage(`{"key":"shared","value":"from-B"}`)); err != nil {
		t.Fatalf("write B: %v", err)
	}

	resA, _ := exec.scratchpadRead(ctx, Context{RunID: runA}, json.RawMessage(`{"key":"shared"}`))
	resB, _ := exec.scratchpadRead(ctx, Context{RunID: runB}, json.RawMessage(`{"key":"shared"}`))
	if resA.Output["value"] != "from-A" || resB.Output["value"] != "from-B" {
		t.Fatalf("session leak: A=%v B=%v", resA.Output["value"], resB.Output["value"])
	}
}

func TestScratchpadRequiresSession(t *testing.T) {
	db := setupPrimitivesDB(t)
	exec := &Executor{DB: db}
	_, err := exec.scratchpadWrite(context.Background(), Context{RunID: "orphan"},
		json.RawMessage(`{"key":"k","value":"v"}`))
	if err == nil {
		t.Fatalf("expected error when run has no session_runs entry")
	}
}

// --- approval.request ---

func TestApprovalRequestReturnsDecidedOnRetry(t *testing.T) {
	db := setupPrimitivesDB(t)
	// Seed an already-decided model-sourced approval for (run, step, reason).
	now := time.Now().UTC().Format(time.RFC3339Nano)
	approvalID := uuid.NewString()
	if _, err := db.Exec(`
		INSERT INTO approvals(id, run_id, step_id, reason, status, source, details, risk, requested_at, decided_at, decided_by, decision_note)
		VALUES(?, ?, ?, ?, 'approved', 'model', '', '', ?, ?, 'operator', 'looks good')
	`, approvalID, "run1", "step1", "run migration on prod", now, now); err != nil {
		t.Fatalf("seed approval: %v", err)
	}
	exec := &Executor{DB: db}
	res, err := exec.approvalRequest(context.Background(),
		Context{RunID: "run1", StepID: "step1"},
		json.RawMessage(`{"reason":"run migration on prod"}`))
	if err != nil {
		t.Fatalf("approvalRequest: %v", err)
	}
	if res.Output["approved"] != true {
		t.Fatalf("expected approved=true, got %v", res.Output)
	}
	if res.Output["approval_id"] != approvalID {
		t.Fatalf("expected same approval_id returned, got %v", res.Output["approval_id"])
	}
	if res.Output["decided_by"] != "operator" {
		t.Fatalf("expected decided_by=operator, got %v", res.Output["decided_by"])
	}
}

func TestApprovalRequestTimeout(t *testing.T) {
	db := setupPrimitivesDB(t)
	sink := &captureSink{}
	exec := &Executor{DB: db, EventSink: sink}
	// 1s timeout (below default min); approval.request clamps to timeout anyway.
	in := `{"reason":"freeze caches","timeout_seconds":1}`
	start := time.Now()
	res, err := exec.approvalRequest(context.Background(),
		Context{RunID: "run2", StepID: "step2"},
		json.RawMessage(in))
	if err != nil {
		t.Fatalf("approvalRequest: %v", err)
	}
	if res.Output["status"] != "timed_out" || res.Output["approved"] != false {
		t.Fatalf("expected timed_out+approved=false, got %v", res.Output)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatalf("timeout took too long: %v", time.Since(start))
	}
	if sink.eventType != "approval.requested" {
		t.Fatalf("expected approval.requested event emitted, got %q", sink.eventType)
	}

	var status string
	_ = db.QueryRow(`SELECT status FROM approvals WHERE run_id=? LIMIT 1`, "run2").Scan(&status)
	if status != "timed_out" {
		t.Fatalf("expected DB row status=timed_out, got %q", status)
	}
}

func TestApprovalRequestConcurrentDecision(t *testing.T) {
	db := setupPrimitivesDB(t)
	exec := &Executor{DB: db}
	done := make(chan struct{})
	go func() {
		// Give the tool a moment to INSERT the pending row, then approve it.
		time.Sleep(300 * time.Millisecond)
		_, _ = db.Exec(`UPDATE approvals SET status='approved', decided_at=?, decided_by='op', decision_note='ok' WHERE run_id=? AND status='pending'`,
			time.Now().UTC().Format(time.RFC3339Nano), "run3")
		close(done)
	}()
	res, err := exec.approvalRequest(context.Background(),
		Context{RunID: "run3", StepID: "step3"},
		json.RawMessage(`{"reason":"ship","timeout_seconds":5}`))
	if err != nil {
		t.Fatalf("approvalRequest: %v", err)
	}
	<-done
	if res.Output["approved"] != true || res.Output["status"] != "approved" {
		t.Fatalf("expected approved, got %v", res.Output)
	}
}

// --- subagent.* ---

func TestSubagentSpawnCreatesChildRun(t *testing.T) {
	db := setupPrimitivesDB(t)
	// Parent run + target agent rows.
	parent := uuid.NewString()
	agent := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(`INSERT INTO runs(id,agent_id,status,task,workspace_path,provider,model,max_steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		parent, agent, "running", "parent task", t.TempDir(), "openai", "o", 30, now, now); err != nil {
		t.Fatalf("seed parent: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO agents(id,provider,model,default_max_steps,default_workspace_path) VALUES(?,?,?,?,?)`,
		agent, "openai", "o", 20, ""); err != nil {
		t.Fatalf("seed agent: %v", err)
	}

	workspace := t.TempDir()
	exec := &Executor{DB: db}
	res, err := exec.subagentSpawn(context.Background(),
		Context{RunID: parent, Workspace: workspace},
		json.RawMessage(`{"agent_id":"`+agent+`","task":"do a thing"}`))
	if err != nil {
		t.Fatalf("subagentSpawn: %v", err)
	}
	childID := res.Output["run_id"].(string)
	if childID == "" {
		t.Fatalf("missing child run_id")
	}
	var parentRunID, status string
	if err := db.QueryRow(`SELECT parent_run_id, status FROM runs WHERE id=?`, childID).Scan(&parentRunID, &status); err != nil {
		t.Fatalf("load child: %v", err)
	}
	if parentRunID != parent {
		t.Fatalf("expected parent_run_id=%s, got %s", parent, parentRunID)
	}
	if status != "queued" {
		t.Fatalf("expected queued, got %s", status)
	}
	// Child workspace directory should exist on disk.
	childWs := res.Output["workspace_path"].(string)
	if _, err := os.Stat(childWs); err != nil {
		t.Fatalf("child workspace missing: %v", err)
	}
	if !strings.HasPrefix(childWs, workspace) {
		t.Fatalf("child workspace not nested under parent: %s", childWs)
	}
}

func TestSubagentStatusRejectsForeignChild(t *testing.T) {
	db := setupPrimitivesDB(t)
	// Insert a run that has a different parent; subagent.status should refuse.
	now := time.Now().UTC().Format(time.RFC3339Nano)
	childID := uuid.NewString()
	if _, err := db.Exec(`INSERT INTO runs(id,agent_id,status,task,workspace_path,provider,model,max_steps,parent_run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		childID, "a", "running", "t", "", "", "", 1, "OTHER_PARENT", now, now); err != nil {
		t.Fatalf("seed child: %v", err)
	}
	exec := &Executor{DB: db}
	_, err := exec.subagentStatus(context.Background(),
		Context{RunID: "NOT_THE_PARENT"},
		json.RawMessage(`{"run_id":"`+childID+`"}`))
	if err == nil {
		t.Fatalf("expected refusal when run is not a child of requesting parent")
	}
}

func TestSubagentMaxActiveCap(t *testing.T) {
	db := setupPrimitivesDB(t)
	parent := uuid.NewString()
	agent := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(`INSERT INTO agents(id,provider,model,default_max_steps,default_workspace_path) VALUES(?,?,?,?,?)`,
		agent, "openai", "o", 20, ""); err != nil {
		t.Fatalf("seed agent: %v", err)
	}
	// Seed 5 active children already.
	for i := 0; i < subagentMaxActive; i++ {
		if _, err := db.Exec(`INSERT INTO runs(id,agent_id,status,task,workspace_path,parent_run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
			uuid.NewString(), agent, "running", "t", "", parent, now, now); err != nil {
			t.Fatalf("seed sibling %d: %v", i, err)
		}
	}
	exec := &Executor{DB: db}
	_, err := exec.subagentSpawn(context.Background(),
		Context{RunID: parent, Workspace: t.TempDir()},
		json.RawMessage(`{"agent_id":"`+agent+`","task":"one more"}`))
	if err == nil || !strings.Contains(err.Error(), "cap") {
		t.Fatalf("expected subagent cap error, got %v", err)
	}
}

// --- process.* ---

func TestProcessLifecycleLocal(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("no POSIX shell available")
	}
	db := setupPrimitivesDB(t)
	exec := &Executor{DB: db}
	workspace := t.TempDir()
	ctx := context.Background()
	runCtx := Context{RunID: "run-proc", Workspace: workspace}

	// Launch a sleeper that prints a marker then sleeps.
	launch, err := exec.processRunBackground(ctx, runCtx,
		json.RawMessage(`{"command":"echo MARKER; sleep 30","label":"sleeper","timeout_seconds":5}`))
	if err != nil {
		t.Fatalf("processRunBackground: %v", err)
	}
	pid := launch.Output["pid"].(int)
	processID := launch.Output["process_id"].(string)
	if pid <= 0 || processID == "" {
		t.Fatalf("bad launch output: %+v", launch.Output)
	}
	t.Cleanup(func() {
		// Belt-and-suspenders: ensure the sleeper dies if a later assertion fails.
		_, _ = exec.processKill(ctx, runCtx, json.RawMessage(`{"process_id":"`+processID+`","signal":"KILL"}`))
	})

	// Wait briefly for the echo to flush to the log file.
	logPath := filepath.Join(workspace, launch.Output["log_path"].(string))
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		b, readErr := os.ReadFile(logPath)
		if readErr == nil && strings.Contains(string(b), "MARKER") {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	logs, err := exec.processLogs(ctx, runCtx, json.RawMessage(`{"process_id":"`+processID+`"}`))
	if err != nil {
		t.Fatalf("processLogs: %v", err)
	}
	if !strings.Contains(logs.Output["log"].(string), "MARKER") {
		t.Fatalf("expected MARKER in log, got %q", logs.Output["log"])
	}
	if logs.Output["status"] != "running" {
		t.Fatalf("expected running, got %v", logs.Output["status"])
	}

	kill, err := exec.processKill(ctx, runCtx, json.RawMessage(`{"process_id":"`+processID+`","signal":"TERM"}`))
	if err != nil {
		t.Fatalf("processKill: %v", err)
	}
	if kill.Output["ok"] != true {
		t.Fatalf("kill not acknowledged: %v", kill.Output)
	}
	// Row status should be 'killed'.
	var status string
	_ = db.QueryRow(`SELECT status FROM run_processes WHERE id=?`, processID).Scan(&status)
	if status != "killed" {
		t.Fatalf("expected status=killed in DB, got %q", status)
	}
}

func TestProcessLookupScopedToRun(t *testing.T) {
	db := setupPrimitivesDB(t)
	exec := &Executor{DB: db}
	// Insert a process row owned by a DIFFERENT run.
	now := time.Now().UTC().Format(time.RFC3339Nano)
	otherID := uuid.NewString()
	if _, err := db.Exec(
		`INSERT INTO run_processes(id,run_id,label,pid,command,log_path,status,started_at) VALUES(?,?,?,?,?,?,?,?)`,
		otherID, "OTHER_RUN", "x", 1, "sleep 1", "log", "running", now); err != nil {
		t.Fatalf("seed other process: %v", err)
	}
	_, err := exec.processLogs(context.Background(),
		Context{RunID: "ME", Workspace: t.TempDir()},
		json.RawMessage(`{"process_id":"`+otherID+`"}`))
	if err == nil {
		t.Fatalf("expected lookup refusal for process owned by another run")
	}
}
