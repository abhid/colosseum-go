package tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Definition struct {
	ID          string          `json:"id,omitempty"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Schema      json.RawMessage `json:"input_schema"`
	Kind        string          `json:"kind"`
	Config      json.RawMessage `json:"config_json,omitempty"`
	Enabled     bool            `json:"enabled"`
	IsBuiltin   bool            `json:"is_builtin"`
	CreatedAt   string          `json:"created_at,omitempty"`
	UpdatedAt   string          `json:"updated_at,omitempty"`
}

type Executor struct {
	DB           *sql.DB
	ArtifactsDir string
	Docker       DockerExecutor
}

type DockerExecutor interface {
	Exec(ctx context.Context, runID, workspace, command string, timeout time.Duration) (string, string, int, error)
}

type Context struct {
	RunID     string
	StepID    string
	Workspace string
}

type Result struct {
	Output    map[string]any
	Log       string
	Artifacts []string
}

func Builtins() []Definition {
	return []Definition{
		{Name: "shell.exec", Description: "Execute shell command in workspace", Schema: rawSchema(`{"type":"object","properties":{"command":{"type":"string"},"timeout_seconds":{"type":"integer","minimum":1,"maximum":600}},"required":["command"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "file.read", Description: "Read a file from workspace", Schema: rawSchema(`{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "file.write", Description: "Write text to file in workspace", Schema: rawSchema(`{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "file.search", Description: "Search file contents using regex pattern", Schema: rawSchema(`{"type":"object","properties":{"pattern":{"type":"string"},"glob":{"type":"string"}},"required":["pattern"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "patch.apply", Description: "Apply unified diff patch text in workspace", Schema: rawSchema(`{"type":"object","properties":{"patch":{"type":"string"}},"required":["patch"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "test.run", Description: "Run test command in workspace", Schema: rawSchema(`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "artifact.list", Description: "List artifacts generated for run", Schema: rawSchema(`{"type":"object","properties":{}}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "artifact.get", Description: "Get artifact metadata by id", Schema: rawSchema(`{"type":"object","properties":{"artifact_id":{"type":"string"}},"required":["artifact_id"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
	}
}

func rawSchema(s string) json.RawMessage { return json.RawMessage(s) }

func (e *Executor) Execute(ctx context.Context, runCtx Context, name string, input json.RawMessage) (Result, error) {
	switch name {
	case "shell.exec":
		return e.shellExec(ctx, runCtx, input)
	case "file.read":
		return e.fileRead(runCtx, input)
	case "file.write":
		return e.fileWrite(runCtx, input)
	case "file.search":
		return e.fileSearch(ctx, runCtx, input)
	case "patch.apply":
		return e.patchApply(ctx, runCtx, input)
	case "test.run":
		return e.testRun(ctx, runCtx, input)
	case "artifact.list":
		return e.artifactList(ctx, runCtx)
	case "artifact.get":
		return e.artifactGet(ctx, runCtx, input)
	default:
		return e.customTool(ctx, runCtx, name, input)
	}
}

func EnsureBuiltinDefinitions(ctx context.Context, db *sql.DB) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, tool := range Builtins() {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO tool_defs(id,name,description,input_schema_json,kind,config_json,enabled,is_builtin,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?,?)
			ON CONFLICT(name) DO UPDATE SET
			  description=excluded.description,
			  input_schema_json=excluded.input_schema_json,
			  kind=excluded.kind,
			  enabled=excluded.enabled,
			  is_builtin=excluded.is_builtin,
			  updated_at=excluded.updated_at
		`, uuid.NewString(), tool.Name, tool.Description, string(tool.Schema), "builtin", "{}", 1, 1, now, now); err != nil {
			return err
		}
	}
	return nil
}

func ListDefinitions(ctx context.Context, db *sql.DB, includeDisabled bool) ([]Definition, error) {
	query := `SELECT id,name,description,input_schema_json,kind,config_json,enabled,is_builtin,created_at,updated_at FROM tool_defs`
	if !includeDisabled {
		query += ` WHERE enabled=1`
	}
	query += ` ORDER BY is_builtin DESC, name ASC`
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Definition, 0)
	for rows.Next() {
		var d Definition
		var enabledInt, builtinInt int
		var schema, cfg string
		if err := rows.Scan(&d.ID, &d.Name, &d.Description, &schema, &d.Kind, &cfg, &enabledInt, &builtinInt, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		d.Schema = json.RawMessage(schema)
		d.Config = json.RawMessage(cfg)
		d.Enabled = enabledInt == 1
		d.IsBuiltin = builtinInt == 1
		out = append(out, d)
	}
	return out, nil
}

func (e *Executor) shellExec(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Command string `json:"command"`
		Timeout int    `json:"timeout_seconds"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if req.Timeout <= 0 {
		req.Timeout = 120
	}
	if e.Docker != nil {
		stdout, stderr, exitCode, err := e.Docker.Exec(ctx, runCtx.RunID, runCtx.Workspace, req.Command, time.Duration(req.Timeout)*time.Second)
		output := truncateOutput(stdout+stderr, 512000)
		artifactPath, _ := e.writeRunArtifact(runCtx, "shell", "log", []byte(output))
		if artifactPath != "" {
			_ = e.insertArtifactRecord(runCtx, "shell_log", artifactPath, "text/plain", int64(len(output)))
		}
		if exitCode != 0 && err == nil {
			err = fmt.Errorf("exit code %d", exitCode)
		}
		res := Result{Output: map[string]any{
			"exit_ok":   err == nil,
			"command":   req.Command,
			"exit_code": exitCode,
			"output":    output,
		}, Log: output}
		if artifactPath != "" {
			res.Artifacts = []string{artifactPath}
		}
		return res, err
	}
	cctx, cancel := context.WithTimeout(ctx, time.Duration(req.Timeout)*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "bash", "-lc", req.Command)
	cmd.Dir = runCtx.Workspace
	out, err := cmd.CombinedOutput()
	output := truncateOutput(string(out), 512000)
	artifactPath, _ := e.writeRunArtifact(runCtx, "shell", "log", []byte(output))
	if artifactPath != "" {
		_ = e.insertArtifactRecord(runCtx, "shell_log", artifactPath, "text/plain", int64(len(output)))
	}
	res := Result{Output: map[string]any{
		"exit_ok": err == nil,
		"command": req.Command,
		"output":  output,
	}, Log: output}
	if artifactPath != "" {
		res.Artifacts = []string{artifactPath}
	}
	if cctx.Err() == context.DeadlineExceeded {
		return res, fmt.Errorf("command timed out")
	}
	return res, err
}

func (e *Executor) fileRead(runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	full, err := safePath(runCtx.Workspace, req.Path)
	if err != nil {
		return Result{}, err
	}
	b, err := os.ReadFile(full)
	if err != nil {
		return Result{}, err
	}
	return Result{Output: map[string]any{"path": req.Path, "content": string(b)}}, nil
}

func (e *Executor) fileWrite(runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	full, err := safePath(runCtx.Workspace, req.Path)
	if err != nil {
		return Result{}, err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return Result{}, err
	}
	if err := os.WriteFile(full, []byte(req.Content), 0o644); err != nil {
		return Result{}, err
	}
	return Result{Output: map[string]any{"path": req.Path, "bytes": len(req.Content)}}, nil
}

func (e *Executor) fileSearch(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Pattern string `json:"pattern"`
		Glob    string `json:"glob"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	args := []string{"-n", req.Pattern, "."}
	if req.Glob != "" {
		args = append([]string{"-n", "--glob", req.Glob, req.Pattern, "."})
	}
	cmd := exec.CommandContext(ctx, "rg", args...)
	cmd.Dir = runCtx.Workspace
	out, err := cmd.CombinedOutput()
	if err != nil && len(out) == 0 {
		return Result{}, err
	}
	return Result{Output: map[string]any{"matches": string(out)}}, nil
}

func (e *Executor) patchApply(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Patch string `json:"patch"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	patchFile := filepath.Join(e.ArtifactsDir, runCtx.RunID, "latest.patch")
	if err := os.MkdirAll(filepath.Dir(patchFile), 0o755); err != nil {
		return Result{}, err
	}
	if err := os.WriteFile(patchFile, []byte(req.Patch), 0o644); err != nil {
		return Result{}, err
	}
	cmd := exec.CommandContext(ctx, "bash", "-lc", "git apply --whitespace=nowarn \""+patchFile+"\"")
	cmd.Dir = runCtx.Workspace
	out, err := cmd.CombinedOutput()
	_ = e.insertArtifactRecord(runCtx, "patch", patchFile, "text/x-diff", int64(len(req.Patch)))
	return Result{Output: map[string]any{"applied": err == nil}, Log: string(out), Artifacts: []string{patchFile}}, err
}

func (e *Executor) testRun(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Command string `json:"command"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if req.Command == "" {
		req.Command = "go test ./..."
	}
	var out []byte
	var err error
	if e.Docker != nil {
		stdout, stderr, exitCode, derr := e.Docker.Exec(ctx, runCtx.RunID, runCtx.Workspace, req.Command, 20*time.Minute)
		err = derr
		if exitCode != 0 && err == nil {
			err = fmt.Errorf("exit code %d", exitCode)
		}
		out = []byte(truncateOutput(stdout+stderr, 1024*1024))
	} else {
		cmd := exec.CommandContext(ctx, "bash", "-lc", req.Command)
		cmd.Dir = runCtx.Workspace
		out, err = cmd.CombinedOutput()
		out = []byte(truncateOutput(string(out), 1024*1024))
	}
	resultPath := filepath.Join(e.ArtifactsDir, runCtx.RunID, fmt.Sprintf("test-%d.log", time.Now().UnixNano()))
	_ = os.MkdirAll(filepath.Dir(resultPath), 0o755)
	_ = os.WriteFile(resultPath, out, 0o644)
	_, _ = e.DB.Exec(`INSERT INTO artifacts(id,run_id,step_id,kind,path,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)`, uuid.NewString(), runCtx.RunID, runCtx.StepID, "test_log", resultPath, "text/plain", len(out), time.Now().UTC().Format(time.RFC3339Nano))
	return Result{Output: map[string]any{"ok": err == nil, "command": req.Command}, Log: string(out), Artifacts: []string{resultPath}}, err
}

func (e *Executor) artifactList(ctx context.Context, runCtx Context) (Result, error) {
	rows, err := e.DB.QueryContext(ctx, `SELECT id,kind,path,size_bytes,created_at FROM artifacts WHERE run_id=? ORDER BY created_at DESC`, runCtx.RunID)
	if err != nil {
		return Result{}, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var id, kind, path, created string
		var size int64
		if err := rows.Scan(&id, &kind, &path, &size, &created); err != nil {
			return Result{}, err
		}
		out = append(out, map[string]any{"id": id, "kind": kind, "path": path, "size_bytes": size, "created_at": created})
	}
	return Result{Output: map[string]any{"artifacts": out}}, nil
}

func (e *Executor) artifactGet(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		ArtifactID string `json:"artifact_id"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	var id, kind, path, mime, created string
	var size int64
	err := e.DB.QueryRowContext(ctx, `SELECT id,kind,path,mime_type,size_bytes,created_at FROM artifacts WHERE id=? AND run_id=?`, req.ArtifactID, runCtx.RunID).Scan(&id, &kind, &path, &mime, &size, &created)
	if err != nil {
		return Result{}, err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return Result{}, err
	}
	return Result{Output: map[string]any{"id": id, "kind": kind, "path": path, "mime_type": mime, "size_bytes": size, "content": string(content), "created_at": created}}, nil
}

func safePath(workspace, p string) (string, error) {
	joined := filepath.Join(workspace, p)
	clean := filepath.Clean(joined)
	workspaceClean := filepath.Clean(workspace)
	if !strings.HasPrefix(clean, workspaceClean) {
		return "", fmt.Errorf("path escapes workspace")
	}
	return clean, nil
}

func truncateOutput(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "\n...[output truncated]..."
}

func (e *Executor) writeRunArtifact(runCtx Context, prefix, ext string, content []byte) (string, error) {
	if e.ArtifactsDir == "" {
		return "", nil
	}
	runDir := filepath.Join(e.ArtifactsDir, runCtx.RunID)
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(runDir, fmt.Sprintf("%s-%d.%s", prefix, time.Now().UnixNano(), ext))
	if err := os.WriteFile(path, content, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func (e *Executor) insertArtifactRecord(runCtx Context, kind, path, mime string, size int64) error {
	if e.DB == nil {
		return nil
	}
	_, err := e.DB.Exec(`INSERT INTO artifacts(id,run_id,step_id,kind,path,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		uuid.NewString(), runCtx.RunID, runCtx.StepID, kind, path, mime, size, time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func (e *Executor) customTool(ctx context.Context, runCtx Context, name string, input json.RawMessage) (Result, error) {
	var kind, configJSON string
	err := e.DB.QueryRowContext(ctx, `SELECT kind, config_json FROM tool_defs WHERE name=? AND enabled=1`, name).Scan(&kind, &configJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return Result{}, fmt.Errorf("unknown tool: %s", name)
		}
		return Result{}, err
	}

	switch kind {
	case "shell_command":
		var cfg struct {
			CommandTemplate string `json:"command_template"`
			TimeoutSeconds  int    `json:"timeout_seconds"`
		}
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			return Result{}, err
		}
		if cfg.CommandTemplate == "" {
			return Result{}, fmt.Errorf("custom shell_command missing command_template")
		}
		if cfg.TimeoutSeconds <= 0 {
			cfg.TimeoutSeconds = 120
		}
		rendered := cfg.CommandTemplate
		var args map[string]any
		_ = json.Unmarshal(input, &args)
		re := regexp.MustCompile(`\{\{([a-zA-Z0-9_]+)\}\}`)
		rendered = re.ReplaceAllStringFunc(rendered, func(match string) string {
			key := strings.TrimSuffix(strings.TrimPrefix(match, "{{"), "}}")
			if v, ok := args[key]; ok {
				return fmt.Sprintf("%v", v)
			}
			return ""
		})
		return e.shellExec(ctx, runCtx, json.RawMessage(fmt.Sprintf(`{"command":%q,"timeout_seconds":%d}`, rendered, cfg.TimeoutSeconds)))
	default:
		return Result{}, fmt.Errorf("unsupported custom tool kind: %s", kind)
	}
}
