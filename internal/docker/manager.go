package docker

import (
	"context"
	"database/sql"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Manager struct {
	DB    *sql.DB
	Image string
}

func NewManager(db *sql.DB, imageName string) (*Manager, error) {
	if imageName == "" {
		imageName = "golang:1.25-bookworm"
	}
	return &Manager{DB: db, Image: imageName}, nil
}

func (m *Manager) Ping(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "docker", "version", "--format", "{{.Server.Version}}")
	_, err := cmd.CombinedOutput()
	return err
}

func (m *Manager) EnsureRunContainer(ctx context.Context, runID, workspace string, cpuQuota int64, memoryMB int64, networkDisabled bool) (string, error) {
	var dockerID string
	err := m.DB.QueryRowContext(ctx, `SELECT docker_container_id FROM containers WHERE run_id=? AND status IN ('created','running') ORDER BY created_at DESC LIMIT 1`, runID).Scan(&dockerID)
	if err == nil && dockerID != "" {
		check := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Running}}", dockerID)
		b, cerr := check.CombinedOutput()
		if cerr == nil && strings.TrimSpace(string(b)) == "true" {
			return dockerID, nil
		}
		start := exec.CommandContext(ctx, "docker", "start", dockerID)
		if _, serr := start.CombinedOutput(); serr == nil {
			_, _ = m.DB.ExecContext(ctx, `UPDATE containers SET status='running', started_at=? WHERE docker_container_id=?`, now(), dockerID)
			return dockerID, nil
		}
	}

	pull := exec.CommandContext(ctx, "docker", "pull", m.Image)
	_, _ = pull.CombinedOutput()

	name := "colosseum-" + strings.ReplaceAll(runID, "-", "")
	args := []string{"run", "-d", "--name", name, "-w", "/workspace", "-v", workspace + ":/workspace"}
	if memoryMB > 0 {
		args = append(args, "--memory", fmt.Sprintf("%dm", memoryMB))
	}
	if cpuQuota > 0 {
		args = append(args, "--cpus", fmt.Sprintf("%.2f", float64(cpuQuota)/100000.0))
	}
	if networkDisabled {
		args = append(args, "--network", "none")
	}
	args = append(args, m.Image, "bash", "-lc", "while true; do sleep 3600; done")
	cmd := exec.CommandContext(ctx, "docker", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("docker run failed: %s", string(out))
	}
	dockerID = strings.TrimSpace(string(out))
	_, _ = m.DB.ExecContext(ctx, `INSERT INTO containers(id,run_id,docker_container_id,image,status,created_at,started_at) VALUES(?,?,?,?,?,?,?)`, uuid.NewString(), runID, dockerID, m.Image, "running", now(), now())
	return dockerID, nil
}

func (m *Manager) Exec(ctx context.Context, runID, workspace string, envVars map[string]string, command string, timeout time.Duration) (string, string, int, error) {
	containerID, err := m.EnsureRunContainer(ctx, runID, workspace, 200000, 2048, false)
	if err != nil {
		return "", "", 0, err
	}
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	args := []string{"exec"}
	for key, value := range envVars {
		k := strings.TrimSpace(key)
		if k == "" {
			continue
		}
		args = append(args, "-e", k+"="+value)
	}
	args = append(args, containerID, "bash", "-lc", command)
	cmd := exec.CommandContext(execCtx, "docker", args...)
	out, err := cmd.CombinedOutput()
	exitCode := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		} else {
			return "", "", 0, err
		}
	}
	if execCtx.Err() == context.DeadlineExceeded {
		return string(out), "command timed out", 124, nil
	}
	return string(out), "", exitCode, nil
}

func (m *Manager) CleanupRun(ctx context.Context, runID string) error {
	rows, err := m.DB.QueryContext(ctx, `SELECT docker_container_id FROM containers WHERE run_id=? AND status IN ('created','running')`, runID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			continue
		}
		_, _ = exec.CommandContext(ctx, "docker", "rm", "-f", id).CombinedOutput()
		_, _ = m.DB.ExecContext(ctx, `UPDATE containers SET status='stopped', ended_at=? WHERE docker_container_id=?`, now(), id)
	}
	return nil
}

func (m *Manager) CleanupOrphans(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "bash", "-lc", "docker ps -aq --filter name=colosseum-")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return err
	}
	ids := strings.Fields(strings.TrimSpace(string(out)))
	for _, id := range ids {
		if id == "" {
			continue
		}
		_, _ = exec.CommandContext(ctx, "docker", "rm", "-f", id).CombinedOutput()
		_, _ = m.DB.ExecContext(ctx, `UPDATE containers SET status='stopped', ended_at=? WHERE docker_container_id=?`, now(), id)
	}
	return nil
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
