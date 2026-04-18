package tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
)

const processLogDirRel = ".colosseum/proc"

func (e *Executor) processRunBackground(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Command        string `json:"command"`
		Label          string `json:"label"`
		TimeoutSeconds int    `json:"timeout_seconds"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(req.Command) == "" {
		return Result{}, fmt.Errorf("command required")
	}
	if req.TimeoutSeconds <= 0 {
		req.TimeoutSeconds = 10
	}
	processID := uuid.NewString()
	logRel := filepath.ToSlash(filepath.Join(processLogDirRel, processID+".log"))

	// Host-side log dir ensures local fallback can tail the file via safePath.
	hostLogDir := filepath.Join(runCtx.Workspace, processLogDirRel)
	if err := os.MkdirAll(hostLogDir, 0o755); err != nil {
		return Result{}, fmt.Errorf("create process log dir: %w", err)
	}

	// Use `;` not `&&` so the backgrounded unit is the single nohup-bash
	// invocation (not a subshell wrapping `mkdir && nohup-bash`). A subshell
	// would keep the parent's stdout fd open until all its children finish,
	// which hangs `cmd.Output()` for the full duration of the user's command.
	wrappedCmd := fmt.Sprintf(
		`mkdir -p %q; nohup bash -lc %s > %q 2>&1 < /dev/null & echo $!`,
		processLogDirRel,
		shellSingleQuote(req.Command),
		logRel,
	)

	var stdout string
	if e.Docker != nil {
		out, stderr, code, err := e.Docker.Exec(ctx, runCtx.RunID, runCtx.Workspace, runCtx.EnvVars, wrappedCmd, time.Duration(req.TimeoutSeconds)*time.Second)
		if err != nil {
			return Result{}, fmt.Errorf("start background process: %w (stderr=%s)", err, stderr)
		}
		if code != 0 {
			return Result{}, fmt.Errorf("start background process: exit %d (stderr=%s)", code, stderr)
		}
		stdout = out
	} else {
		cctx, cancel := context.WithTimeout(ctx, time.Duration(req.TimeoutSeconds)*time.Second)
		defer cancel()
		cmd := exec.CommandContext(cctx, "bash", "-lc", wrappedCmd)
		cmd.Dir = runCtx.Workspace
		cmd.Env = mergeEnv(sanitizedBaseEnv(), runCtx.EnvVars)
		out, err := cmd.Output()
		if err != nil {
			return Result{}, fmt.Errorf("start background process: %w", err)
		}
		stdout = string(out)
	}

	pidStr := strings.TrimSpace(strings.Split(stdout, "\n")[0])
	pid, convErr := strconv.Atoi(pidStr)
	if convErr != nil {
		return Result{}, fmt.Errorf("failed to parse pid from output %q", stdout)
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if e.DB != nil {
		_, err := e.DB.ExecContext(ctx, `
			INSERT INTO run_processes(id, run_id, label, pid, command, log_path, status, started_at)
			VALUES(?, ?, ?, ?, ?, ?, 'running', ?)
		`, processID, runCtx.RunID, req.Label, pid, req.Command, logRel, now)
		if err != nil {
			return Result{}, err
		}
	}
	return Result{Output: map[string]any{
		"process_id": processID,
		"pid":        pid,
		"log_path":   logRel,
		"status":     "running",
	}}, nil
}

func (e *Executor) processLogs(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		ProcessID string `json:"process_id"`
		MaxBytes  int64  `json:"max_bytes"`
		TailLines int    `json:"tail_lines"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(req.ProcessID) == "" {
		return Result{}, fmt.Errorf("process_id required")
	}
	if req.MaxBytes <= 0 {
		req.MaxBytes = 256 * 1024
	}
	row, err := e.lookupProcess(ctx, runCtx.RunID, req.ProcessID)
	if err != nil {
		return Result{}, err
	}

	status, exitCode := e.refreshProcessStatus(ctx, runCtx, row)

	full, err := safePath(runCtx.Workspace, row.logPath)
	if err != nil {
		return Result{}, err
	}
	content := ""
	if b, readErr := os.ReadFile(full); readErr == nil {
		if int64(len(b)) > req.MaxBytes {
			b = b[int64(len(b))-req.MaxBytes:]
		}
		content = string(b)
		if req.TailLines > 0 {
			lines := strings.Split(content, "\n")
			if len(lines) > req.TailLines {
				lines = lines[len(lines)-req.TailLines:]
			}
			content = strings.Join(lines, "\n")
		}
	}
	out := map[string]any{
		"process_id": row.id,
		"pid":        row.pid,
		"status":     status,
		"log_path":   row.logPath,
		"log":        content,
	}
	if exitCode != nil {
		out["exit_code"] = *exitCode
	}
	return Result{Output: out}, nil
}

func (e *Executor) processKill(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		ProcessID string `json:"process_id"`
		Signal    string `json:"signal"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(req.ProcessID) == "" {
		return Result{}, fmt.Errorf("process_id required")
	}
	sig := strings.TrimSpace(req.Signal)
	if sig == "" {
		sig = "TERM"
	}
	sig = strings.TrimPrefix(strings.ToUpper(sig), "SIG")
	row, err := e.lookupProcess(ctx, runCtx.RunID, req.ProcessID)
	if err != nil {
		return Result{}, err
	}
	cmd := fmt.Sprintf("kill -%s %d", shellSingleQuote(sig), row.pid)
	if e.Docker != nil {
		_, stderr, code, execErr := e.Docker.Exec(ctx, runCtx.RunID, runCtx.Workspace, runCtx.EnvVars, cmd, 10*time.Second)
		if execErr != nil && code == 0 {
			return Result{}, fmt.Errorf("kill: %w (stderr=%s)", execErr, stderr)
		}
	} else {
		c := exec.CommandContext(ctx, "bash", "-lc", cmd)
		c.Dir = runCtx.Workspace
		_ = c.Run()
	}
	if e.DB != nil {
		_, _ = e.DB.ExecContext(ctx,
			`UPDATE run_processes SET status='killed', ended_at=? WHERE id=?`,
			time.Now().UTC().Format(time.RFC3339Nano), row.id)
	}
	return Result{Output: map[string]any{
		"ok":         true,
		"process_id": row.id,
		"pid":        row.pid,
		"signal":     sig,
	}}, nil
}

type processRow struct {
	id, runID, label, command, logPath, status string
	pid                                        int
	exitCode                                   sql.NullInt64
}

func (e *Executor) lookupProcess(ctx context.Context, runID, processID string) (*processRow, error) {
	if e.DB == nil {
		return nil, fmt.Errorf("database not configured")
	}
	row := &processRow{}
	err := e.DB.QueryRowContext(ctx, `
		SELECT id, run_id, label, pid, command, log_path, status, exit_code
		FROM run_processes WHERE id=? AND run_id=?
	`, processID, runID).Scan(&row.id, &row.runID, &row.label, &row.pid, &row.command, &row.logPath, &row.status, &row.exitCode)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("process not found for this run: %s", processID)
	}
	if err != nil {
		return nil, err
	}
	return row, nil
}

func (e *Executor) refreshProcessStatus(ctx context.Context, runCtx Context, row *processRow) (string, *int) {
	if row.status != "running" {
		if row.exitCode.Valid {
			code := int(row.exitCode.Int64)
			return row.status, &code
		}
		return row.status, nil
	}
	alive := e.processAlive(ctx, runCtx, row.pid)
	if alive {
		return "running", nil
	}
	// Mark exited; we can't recover the exit code without wait, so leave it NULL.
	if e.DB != nil {
		_, _ = e.DB.ExecContext(ctx,
			`UPDATE run_processes SET status='exited', ended_at=? WHERE id=?`,
			time.Now().UTC().Format(time.RFC3339Nano), row.id)
	}
	return "exited", nil
}

func (e *Executor) processAlive(ctx context.Context, runCtx Context, pid int) bool {
	cmd := fmt.Sprintf("kill -0 %d", pid)
	if e.Docker != nil {
		_, _, code, err := e.Docker.Exec(ctx, runCtx.RunID, runCtx.Workspace, runCtx.EnvVars, cmd, 5*time.Second)
		return err == nil && code == 0
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if err := proc.Signal(syscall.Signal(0)); err != nil {
		return false
	}
	return true
}

func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
