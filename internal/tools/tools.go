package tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
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
	Browser      *BrowserRuntime
}

type DockerExecutor interface {
	Exec(ctx context.Context, runID, workspace string, envVars map[string]string, command string, timeout time.Duration) (string, string, int, error)
}

type Context struct {
	RunID             string
	StepID            string
	Workspace         string
	EnvironmentID     string
	CredentialVaultID string
	EnvVars           map[string]string
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
		{Name: "file.read_range", Description: "Read a line range from file in workspace", Schema: rawSchema(`{"type":"object","properties":{"path":{"type":"string"},"start_line":{"type":"integer","minimum":1},"end_line":{"type":"integer","minimum":1}},"required":["path","start_line","end_line"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "file.write", Description: "Write text to file in workspace", Schema: rawSchema(`{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "file.search", Description: "Search file contents using regex pattern", Schema: rawSchema(`{"type":"object","properties":{"pattern":{"type":"string"},"glob":{"type":"string"}},"required":["pattern"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "file.exists", Description: "Check whether a file path exists in workspace", Schema: rawSchema(`{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "file.stat", Description: "Get file metadata for a path in workspace", Schema: rawSchema(`{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "file.list", Description: "List files and directories under a workspace path", Schema: rawSchema(`{"type":"object","properties":{"path":{"type":"string"},"recursive":{"type":"boolean"},"max_entries":{"type":"integer","minimum":1,"maximum":5000}}}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "path.glob", Description: "Find paths in workspace matching a glob pattern", Schema: rawSchema(`{"type":"object","properties":{"pattern":{"type":"string"}},"required":["pattern"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "apply.patch", Description: "Apply unified diff patch text in workspace", Schema: rawSchema(`{"type":"object","properties":{"patch":{"type":"string"}},"required":["patch"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "web.fetch", Description: "Fetch HTTP(S) content from a URL", Schema: rawSchema(`{"type":"object","properties":{"url":{"type":"string"},"timeout_seconds":{"type":"integer","minimum":1,"maximum":60},"max_bytes":{"type":"integer","minimum":1024,"maximum":1048576}},"required":["url"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "json.parse", Description: "Parse JSON string and return normalized object", Schema: rawSchema(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "json.query", Description: "Query JSON payload using a dot path expression", Schema: rawSchema(`{"type":"object","properties":{"input":{"description":"JSON object/array or stringified JSON"},"path":{"type":"string"}},"required":["input","path"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "browser.open", Description: "Open URL in browser session", Schema: rawSchema(`{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "browser.snapshot", Description: "Capture current page snapshot from browser session", Schema: rawSchema(`{"type":"object","properties":{"screenshot":{"type":"boolean"}}}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "browser.action", Description: "Perform browser action on current page", Schema: rawSchema(`{"type":"object","properties":{"action":{"type":"string","enum":["click","type","press","select","scroll"]},"selector":{"type":"string"},"text":{"type":"string"},"key":{"type":"string"},"value":{"type":"string"},"delta_y":{"type":"integer"}},"required":["action"]}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "browser.wait", Description: "Wait in browser session", Schema: rawSchema(`{"type":"object","properties":{"milliseconds":{"type":"integer","minimum":1,"maximum":30000}}}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
		{Name: "browser.close", Description: "Close browser session for current run", Schema: rawSchema(`{"type":"object","properties":{}}`), Kind: "builtin", Enabled: true, IsBuiltin: true},
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
	case "file.read_range":
		return e.fileReadRange(runCtx, input)
	case "file.write":
		return e.fileWrite(runCtx, input)
	case "file.search":
		return e.fileSearch(ctx, runCtx, input)
	case "file.exists":
		return e.fileExists(runCtx, input)
	case "file.stat":
		return e.fileStat(runCtx, input)
	case "file.list":
		return e.fileList(runCtx, input)
	case "path.glob":
		return e.pathGlob(runCtx, input)
	case "apply.patch":
		return e.applyPatch(ctx, runCtx, input)
	case "web.fetch":
		return e.webFetch(ctx, input)
	case "json.parse":
		return e.jsonParse(input)
	case "json.query":
		return e.jsonQuery(input)
	case "browser.open":
		return e.browserOpen(ctx, runCtx, input)
	case "browser.snapshot":
		return e.browserSnapshot(ctx, runCtx, input)
	case "browser.action":
		return e.browserAction(ctx, runCtx, input)
	case "browser.wait":
		return e.browserWait(ctx, runCtx, input)
	case "browser.close":
		return e.browserClose(ctx, runCtx)
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
		stdout, stderr, exitCode, err := e.Docker.Exec(ctx, runCtx.RunID, runCtx.Workspace, runCtx.EnvVars, req.Command, time.Duration(req.Timeout)*time.Second)
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
	cmd.Env = mergeEnv(sanitizedBaseEnv(), runCtx.EnvVars)
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

func (e *Executor) applyPatch(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
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

func (e *Executor) fileReadRange(runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Path      string `json:"path"`
		StartLine int    `json:"start_line"`
		EndLine   int    `json:"end_line"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if req.StartLine <= 0 || req.EndLine <= 0 || req.EndLine < req.StartLine {
		return Result{}, fmt.Errorf("invalid line range")
	}
	full, err := safePath(runCtx.Workspace, req.Path)
	if err != nil {
		return Result{}, err
	}
	b, err := os.ReadFile(full)
	if err != nil {
		return Result{}, err
	}
	lines := strings.Split(string(b), "\n")
	if req.StartLine > len(lines) {
		return Result{Output: map[string]any{"path": req.Path, "content": "", "start_line": req.StartLine, "end_line": req.EndLine}}, nil
	}
	end := req.EndLine
	if end > len(lines) {
		end = len(lines)
	}
	chunk := strings.Join(lines[req.StartLine-1:end], "\n")
	return Result{Output: map[string]any{
		"path":       req.Path,
		"start_line": req.StartLine,
		"end_line":   end,
		"content":    chunk,
	}}, nil
}

func (e *Executor) fileExists(runCtx Context, input json.RawMessage) (Result, error) {
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
	_, err = os.Stat(full)
	if err == nil {
		return Result{Output: map[string]any{"path": req.Path, "exists": true}}, nil
	}
	if os.IsNotExist(err) {
		return Result{Output: map[string]any{"path": req.Path, "exists": false}}, nil
	}
	return Result{}, err
}

func (e *Executor) fileStat(runCtx Context, input json.RawMessage) (Result, error) {
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
	info, err := os.Stat(full)
	if err != nil {
		return Result{}, err
	}
	return Result{Output: map[string]any{
		"path":      req.Path,
		"size":      info.Size(),
		"is_dir":    info.IsDir(),
		"mode":      info.Mode().String(),
		"modified":  info.ModTime().UTC().Format(time.RFC3339Nano),
		"basename":  info.Name(),
		"extension": filepath.Ext(info.Name()),
	}}, nil
}

func (e *Executor) fileList(runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Path       string `json:"path"`
		Recursive  bool   `json:"recursive"`
		MaxEntries int    `json:"max_entries"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if req.Path == "" {
		req.Path = "."
	}
	if req.MaxEntries <= 0 {
		req.MaxEntries = 200
	}
	root, err := safePath(runCtx.Workspace, req.Path)
	if err != nil {
		return Result{}, err
	}
	entries := make([]map[string]any, 0)
	if req.Recursive {
		err = filepath.WalkDir(root, func(p string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if len(entries) >= req.MaxEntries {
				return fs.SkipAll
			}
			rel, _ := filepath.Rel(runCtx.Workspace, p)
			entries = append(entries, map[string]any{"path": filepath.ToSlash(rel), "is_dir": d.IsDir()})
			return nil
		})
		if err != nil && err != fs.SkipAll {
			return Result{}, err
		}
	} else {
		dirEntries, err := os.ReadDir(root)
		if err != nil {
			return Result{}, err
		}
		for i, d := range dirEntries {
			if i >= req.MaxEntries {
				break
			}
			p := filepath.Join(root, d.Name())
			rel, _ := filepath.Rel(runCtx.Workspace, p)
			entries = append(entries, map[string]any{"path": filepath.ToSlash(rel), "is_dir": d.IsDir()})
		}
	}
	return Result{Output: map[string]any{"entries": entries, "count": len(entries)}}, nil
}

func (e *Executor) pathGlob(runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Pattern string `json:"pattern"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	pattern := strings.TrimSpace(req.Pattern)
	if pattern == "" {
		return Result{}, fmt.Errorf("pattern required")
	}
	matches := make([]string, 0)
	_ = filepath.WalkDir(runCtx.Workspace, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, rerr := filepath.Rel(runCtx.Workspace, p)
		if rerr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		ok, _ := path.Match(pattern, rel)
		if ok {
			matches = append(matches, rel)
		}
		return nil
	})
	return Result{Output: map[string]any{"pattern": pattern, "matches": matches, "count": len(matches)}}, nil
}

func (e *Executor) webFetch(ctx context.Context, input json.RawMessage) (Result, error) {
	var req struct {
		URL           string `json:"url"`
		TimeoutSecond int    `json:"timeout_seconds"`
		MaxBytes      int64  `json:"max_bytes"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if req.URL == "" {
		return Result{}, fmt.Errorf("url required")
	}
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		return Result{}, fmt.Errorf("only http/https urls are allowed")
	}
	if req.TimeoutSecond <= 0 {
		req.TimeoutSecond = 15
	}
	if req.MaxBytes <= 0 {
		req.MaxBytes = 256 * 1024
	}
	client := &http.Client{Timeout: time.Duration(req.TimeoutSecond) * time.Second}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, req.URL, nil)
	if err != nil {
		return Result{}, err
	}
	httpReq.Header.Set("User-Agent", "colosseum/1.0")
	resp, err := client.Do(httpReq)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	b, err := ioReadAllLimited(resp.Body, req.MaxBytes)
	if err != nil {
		return Result{}, err
	}
	content := string(b)
	return Result{Output: map[string]any{
		"url":          req.URL,
		"status":       resp.StatusCode,
		"content":      content,
		"content_len":  len(content),
		"content_type": resp.Header.Get("Content-Type"),
	}}, nil
}

func (e *Executor) jsonParse(input json.RawMessage) (Result, error) {
	var req struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	var parsed any
	if err := json.Unmarshal([]byte(req.Text), &parsed); err != nil {
		return Result{}, err
	}
	return Result{Output: map[string]any{"value": parsed}}, nil
}

func (e *Executor) jsonQuery(input json.RawMessage) (Result, error) {
	var req struct {
		Input any    `json:"input"`
		Path  string `json:"path"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	val := req.Input
	if s, ok := req.Input.(string); ok {
		var parsed any
		if err := json.Unmarshal([]byte(s), &parsed); err == nil {
			val = parsed
		}
	}
	pathExpr := strings.TrimSpace(req.Path)
	if pathExpr == "" || pathExpr == "." {
		return Result{Output: map[string]any{"value": val}}, nil
	}
	current := val
	parts := strings.Split(pathExpr, ".")
	for _, raw := range parts {
		part := strings.TrimSpace(raw)
		if part == "" {
			continue
		}
		switch node := current.(type) {
		case map[string]any:
			next, ok := node[part]
			if !ok {
				return Result{}, fmt.Errorf("path not found: %s", part)
			}
			current = next
		case []any:
			i, err := strconv.Atoi(part)
			if err != nil || i < 0 || i >= len(node) {
				return Result{}, fmt.Errorf("invalid array index: %s", part)
			}
			current = node[i]
		default:
			return Result{}, fmt.Errorf("cannot traverse into %T", current)
		}
	}
	return Result{Output: map[string]any{"value": current}}, nil
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
		stdout, stderr, exitCode, derr := e.Docker.Exec(ctx, runCtx.RunID, runCtx.Workspace, runCtx.EnvVars, req.Command, 20*time.Minute)
		err = derr
		if exitCode != 0 && err == nil {
			err = fmt.Errorf("exit code %d", exitCode)
		}
		out = []byte(truncateOutput(stdout+stderr, 1024*1024))
	} else {
		cmd := exec.CommandContext(ctx, "bash", "-lc", req.Command)
		cmd.Dir = runCtx.Workspace
		cmd.Env = mergeEnv(sanitizedBaseEnv(), runCtx.EnvVars)
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

func ioReadAllLimited(r io.Reader, limit int64) ([]byte, error) {
	if limit <= 0 {
		limit = 256 * 1024
	}
	lr := io.LimitReader(r, limit+1)
	b, err := io.ReadAll(lr)
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		b = b[:limit]
	}
	return b, nil
}

func mergeEnv(base []string, injected map[string]string) []string {
	if len(injected) == 0 {
		return base
	}
	out := append([]string{}, base...)
	for key, value := range injected {
		k := strings.TrimSpace(key)
		if k == "" || !isValidEnvName(k) {
			continue
		}
		out = append(out, k+"="+value)
	}
	return out
}

func sanitizedBaseEnv() []string {
	base := os.Environ()
	out := make([]string, 0, len(base))
	for _, entry := range base {
		key, _, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		if shouldFilterHostEnvKey(key) {
			continue
		}
		out = append(out, entry)
	}
	return out
}

func shouldFilterHostEnvKey(key string) bool {
	k := strings.ToUpper(strings.TrimSpace(key))
	if k == "" {
		return true
	}
	if strings.Contains(k, "SECRET") || strings.Contains(k, "TOKEN") || strings.Contains(k, "PASSWORD") || strings.HasSuffix(k, "_KEY") {
		return true
	}
	switch k {
	case "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN":
		return true
	default:
		return false
	}
}

func isValidEnvName(name string) bool {
	for i, r := range name {
		if i == 0 {
			if !((r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || r == '_') {
				return false
			}
			continue
		}
		if !((r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_') {
			return false
		}
	}
	return name != ""
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
