package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

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

// recallArtifact resolves an artifact produced earlier in this chat session
// (by id or workspace-relative path), registers a row for it under the
// current run, and emits a user.event that the runtime's pending-user-event
// loop will inline as multimodal content on the next model step.
func (e *Executor) recallArtifact(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		ArtifactID string `json:"artifact_id"`
		Path       string `json:"path"`
		Note       string `json:"note"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	req.ArtifactID = strings.TrimSpace(req.ArtifactID)
	req.Path = strings.TrimSpace(req.Path)
	if req.ArtifactID == "" && req.Path == "" {
		return Result{}, fmt.Errorf("recall_artifact requires artifact_id or path")
	}
	if e.DB == nil {
		return Result{}, fmt.Errorf("recall_artifact requires a database")
	}

	var sessionID string
	_ = e.DB.QueryRowContext(ctx, `SELECT session_id FROM session_runs WHERE run_id=? LIMIT 1`, runCtx.RunID).Scan(&sessionID)

	var srcID, srcKind, srcPath, srcMIME string
	var srcSize int64
	var found bool

	if req.ArtifactID != "" {
		row := e.queryArtifactByID(ctx, sessionID, runCtx.RunID, req.ArtifactID)
		if row != nil {
			srcID, srcKind, srcPath, srcMIME, srcSize = row.id, row.kind, row.path, row.mime, row.size
			found = true
		}
	}
	if !found && req.Path != "" {
		resolvedPath, err := safePath(runCtx.Workspace, req.Path)
		if err != nil {
			return Result{}, err
		}
		row := e.queryArtifactByPath(ctx, sessionID, runCtx.RunID, resolvedPath)
		if row != nil {
			srcID, srcKind, srcPath, srcMIME, srcSize = row.id, row.kind, row.path, row.mime, row.size
			found = true
		} else if _, statErr := os.Stat(resolvedPath); statErr == nil {
			srcID = ""
			srcKind = guessArtifactKind(resolvedPath)
			srcPath = resolvedPath
			srcMIME = guessMIMEFromPath(resolvedPath)
			if info, err := os.Stat(resolvedPath); err == nil {
				srcSize = info.Size()
			}
			found = true
		}
	}
	if !found {
		return Result{}, fmt.Errorf("recall_artifact: no matching artifact in this chat session")
	}
	if _, err := os.Stat(srcPath); err != nil {
		return Result{}, fmt.Errorf("recall_artifact: source file missing on disk: %w", err)
	}

	newID := uuid.NewString()
	if err := e.insertArtifactRecord(runCtx, firstNonEmpty(srcKind, "recalled"), srcPath, srcMIME, srcSize); err != nil {
		return Result{}, err
	}
	var resolvedID string
	_ = e.DB.QueryRowContext(ctx, `
		SELECT id FROM artifacts WHERE run_id=? AND path=? ORDER BY created_at DESC LIMIT 1
	`, runCtx.RunID, srcPath).Scan(&resolvedID)
	if strings.TrimSpace(resolvedID) == "" {
		resolvedID = newID
	}

	payload := map[string]any{
		"source":      "tool.recall_artifact",
		"message":     buildRecallEventMessage(req.Note, resolvedID, srcPath, srcMIME, srcID),
		"attachments": []string{resolvedID},
	}
	if e.EventSink == nil {
		return Result{}, fmt.Errorf("recall_artifact: event sink not configured")
	}
	if err := e.EventSink.AppendEvent(ctx, runCtx.RunID, runCtx.StepID, "user.event", payload); err != nil {
		return Result{}, fmt.Errorf("recall_artifact: failed to queue attachment event: %w", err)
	}

	rel := srcPath
	if runCtx.Workspace != "" {
		if r, rerr := filepath.Rel(runCtx.Workspace, srcPath); rerr == nil {
			rel = filepath.ToSlash(r)
		}
	}
	return Result{Output: map[string]any{
		"ok":              true,
		"artifact_id":     resolvedID,
		"source_artifact": srcID,
		"kind":            srcKind,
		"mime_type":       srcMIME,
		"size_bytes":      srcSize,
		"path":            rel,
		"message":         "Attachment queued; it will be visible on the next model step.",
	}}, nil
}

type artifactRow struct {
	id, kind, path, mime string
	size                 int64
}

func (e *Executor) queryArtifactByID(ctx context.Context, sessionID, runID, artifactID string) *artifactRow {
	if strings.TrimSpace(artifactID) == "" {
		return nil
	}
	row := &artifactRow{}
	if sessionID != "" {
		err := e.DB.QueryRowContext(ctx, `
			SELECT a.id,a.kind,a.path,a.mime_type,a.size_bytes
			FROM artifacts a
			JOIN session_runs sr ON sr.run_id=a.run_id
			WHERE sr.session_id=? AND a.id=?
			ORDER BY a.created_at DESC LIMIT 1
		`, sessionID, artifactID).Scan(&row.id, &row.kind, &row.path, &row.mime, &row.size)
		if err == nil {
			return row
		}
	}
	err := e.DB.QueryRowContext(ctx, `
		SELECT id,kind,path,mime_type,size_bytes FROM artifacts
		WHERE run_id=? AND id=?
	`, runID, artifactID).Scan(&row.id, &row.kind, &row.path, &row.mime, &row.size)
	if err != nil {
		return nil
	}
	return row
}

func (e *Executor) queryArtifactByPath(ctx context.Context, sessionID, runID, absPath string) *artifactRow {
	row := &artifactRow{}
	if sessionID != "" {
		err := e.DB.QueryRowContext(ctx, `
			SELECT a.id,a.kind,a.path,a.mime_type,a.size_bytes
			FROM artifacts a
			JOIN session_runs sr ON sr.run_id=a.run_id
			WHERE sr.session_id=? AND a.path=?
			ORDER BY a.created_at DESC LIMIT 1
		`, sessionID, absPath).Scan(&row.id, &row.kind, &row.path, &row.mime, &row.size)
		if err == nil {
			return row
		}
	}
	err := e.DB.QueryRowContext(ctx, `
		SELECT id,kind,path,mime_type,size_bytes FROM artifacts
		WHERE run_id=? AND path=?
		ORDER BY created_at DESC LIMIT 1
	`, runID, absPath).Scan(&row.id, &row.kind, &row.path, &row.mime, &row.size)
	if err != nil {
		return nil
	}
	return row
}

func buildRecallEventMessage(note, artifactID, path, mime, sourceID string) string {
	clean := strings.TrimSpace(note)
	if clean == "" {
		clean = "Re-attached artifact from earlier in this chat session."
	}
	details := []string{clean,
		fmt.Sprintf("Attachment: id=%s mime=%s path=%s", artifactID, strings.TrimSpace(mime), strings.TrimSpace(path)),
	}
	if strings.TrimSpace(sourceID) != "" && sourceID != artifactID {
		details = append(details, "Originated from artifact "+sourceID+".")
	}
	return strings.Join(details, "\n")
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

func guessArtifactKind(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return "screenshot"
	case ".pdf":
		return "pdf"
	case ".svg":
		return "svg"
	case ".mp4", ".mov", ".webm":
		return "video"
	case ".mp3", ".wav", ".m4a":
		return "audio"
	case ".log", ".txt":
		return "log"
	default:
		return "file"
	}
}

func guessMIMEFromPath(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".pdf":
		return "application/pdf"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".txt", ".log":
		return "text/plain"
	default:
		return "application/octet-stream"
	}
}
