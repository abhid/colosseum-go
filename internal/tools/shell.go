package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/google/uuid"
)

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
