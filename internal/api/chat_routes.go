package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type createChatSessionRequest struct {
	AgentID string `json:"agent_id"`
	Title   string `json:"title"`
}

type patchChatSessionRequest struct {
	Title    *string `json:"title"`
	Archived *bool   `json:"archived"`
	Pinned   *bool   `json:"pinned"`
}

type createChatSessionMessageRequest struct {
	Content string `json:"content"`
	Source  string `json:"source"`
}

var (
	errChatSessionArchived      = errors.New("session is archived")
	errChatMessageContentNeeded = errors.New("content required")
	errWorkspacePathOutsideRoot = errors.New("workspace_path must be inside workspace root")
	errNoFilesUploaded          = errors.New("no files uploaded")
	errRunClosedForUploads      = errors.New("run is closed; cannot upload files")
	errRunNotFound              = errors.New("run not found")
	errInvalidMultipartPayload  = errors.New("invalid multipart payload")
)

func listChatSessionsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.QueryContext(r.Context(), `
			SELECT s.id,s.title,s.agent_id,s.status,s.created_at,s.updated_at,s.archived_at,s.pinned_at,
				COALESCE(sr.run_id,''), COALESCE(rr.status,''), COALESCE(rr.created_at,''),
				COALESCE((SELECT COUNT(1) FROM session_runs x WHERE x.session_id=s.id),0)
			FROM chat_sessions s
			LEFT JOIN session_runs sr ON sr.session_id=s.id
				AND sr.turn_index=(SELECT MAX(turn_index) FROM session_runs z WHERE z.session_id=s.id)
			LEFT JOIN runs rr ON rr.id=sr.run_id
			ORDER BY CASE WHEN s.pinned_at IS NULL THEN 1 ELSE 0 END, s.pinned_at DESC, s.updated_at DESC
		`)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, title, agentID, status, createdAt, updatedAt string
			var archivedAt, pinnedAt sql.NullString
			var latestRunID, latestRunStatus, latestRunCreatedAt string
			var runCount int
			if err := rows.Scan(&id, &title, &agentID, &status, &createdAt, &updatedAt, &archivedAt, &pinnedAt, &latestRunID, &latestRunStatus, &latestRunCreatedAt, &runCount); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			out = append(out, map[string]any{
				"id": id, "title": title, "agent_id": agentID, "status": status, "created_at": createdAt, "updated_at": updatedAt,
				"archived_at": archivedAt.String, "pinned_at": pinnedAt.String,
				"latest_run_id": latestRunID, "latest_run_status": latestRunStatus, "latest_run_created_at": latestRunCreatedAt,
				"run_count": runCount,
			})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func createChatSessionHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createChatSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		req.AgentID = strings.TrimSpace(req.AgentID)
		if req.AgentID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agent_id required"})
			return
		}
		var exists int
		if err := db.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM agents WHERE id=?`, req.AgentID).Scan(&exists); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if exists == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		title := strings.TrimSpace(req.Title)
		if title == "" {
			title = "New chat session"
		}
		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := db.ExecContext(r.Context(), `
			INSERT INTO chat_sessions(id,title,agent_id,status,created_at,updated_at)
			VALUES(?,?,?,?,?,?)
		`, id, title, req.AgentID, "active", now, now); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"id": id, "title": title, "agent_id": req.AgentID, "status": "active"})
	}
}

func getChatSessionHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := chi.URLParam(r, "id")
		var id, title, agentID, status, createdAt, updatedAt string
		var archivedAt, pinnedAt sql.NullString
		err := db.QueryRowContext(r.Context(), `
			SELECT id,title,agent_id,status,created_at,updated_at,archived_at,pinned_at
			FROM chat_sessions WHERE id=?
		`, sessionID).Scan(&id, &title, &agentID, &status, &createdAt, &updatedAt, &archivedAt, &pinnedAt)
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat session not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		var latestRunID, latestRunStatus, latestRunCreatedAt sql.NullString
		var runCount int
		_ = db.QueryRowContext(r.Context(), `
			SELECT COALESCE((SELECT run_id FROM session_runs WHERE session_id=? ORDER BY turn_index DESC LIMIT 1), ''),
			       COALESCE((SELECT status FROM runs WHERE id=(SELECT run_id FROM session_runs WHERE session_id=? ORDER BY turn_index DESC LIMIT 1)), ''),
			       COALESCE((SELECT created_at FROM runs WHERE id=(SELECT run_id FROM session_runs WHERE session_id=? ORDER BY turn_index DESC LIMIT 1)), ''),
			       COALESCE((SELECT COUNT(1) FROM session_runs WHERE session_id=?),0)
		`, sessionID, sessionID, sessionID, sessionID).Scan(&latestRunID, &latestRunStatus, &latestRunCreatedAt, &runCount)
		writeJSON(w, http.StatusOK, map[string]any{
			"id": id, "title": title, "agent_id": agentID, "status": status, "created_at": createdAt, "updated_at": updatedAt,
			"archived_at": archivedAt.String, "pinned_at": pinnedAt.String, "latest_run_id": latestRunID.String,
			"latest_run_status": latestRunStatus.String, "latest_run_created_at": latestRunCreatedAt.String, "run_count": runCount,
		})
	}
}

func patchChatSessionHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := chi.URLParam(r, "id")
		var req patchChatSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		setParts := make([]string, 0, 4)
		args := make([]any, 0, 6)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if req.Title != nil {
			title := strings.TrimSpace(*req.Title)
			if title == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title cannot be empty"})
				return
			}
			setParts = append(setParts, "title=?")
			args = append(args, title)
		}
		if req.Archived != nil {
			if *req.Archived {
				setParts = append(setParts, "status='archived'", "archived_at=?")
				args = append(args, now)
			} else {
				setParts = append(setParts, "status='active'", "archived_at=NULL")
			}
		}
		if req.Pinned != nil {
			if *req.Pinned {
				setParts = append(setParts, "pinned_at=?")
				args = append(args, now)
			} else {
				setParts = append(setParts, "pinned_at=NULL")
			}
		}
		if len(setParts) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no updates requested"})
			return
		}
		setParts = append(setParts, "updated_at=?")
		args = append(args, now, sessionID)
		query := fmt.Sprintf("UPDATE chat_sessions SET %s WHERE id=?", strings.Join(setParts, ", "))
		res, err := db.ExecContext(r.Context(), query, args...)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat session not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": sessionID, "updated": true})
	}
}

func listChatSessionMessagesHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := chi.URLParam(r, "id")
		rows, err := db.QueryContext(r.Context(), `
			SELECT id,turn_index,role,content,source,run_id,created_at,updated_at
			FROM chat_messages WHERE session_id=? ORDER BY turn_index ASC, created_at ASC
		`, sessionID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, role, content, source, runID, createdAt, updatedAt string
			var turnIndex int
			if err := rows.Scan(&id, &turnIndex, &role, &content, &source, &runID, &createdAt, &updatedAt); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			out = append(out, map[string]any{
				"id": id, "turn_index": turnIndex, "role": role, "content": content, "source": source,
				"run_id": runID, "created_at": createdAt, "updated_at": updatedAt,
			})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func createChatSessionMessageHandler(db *sql.DB, workspaceRoot string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := chi.URLParam(r, "id")
		var req createChatSessionMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		req.Content = strings.TrimSpace(req.Content)
		if req.Content == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": errChatMessageContentNeeded.Error()})
			return
		}
		if strings.HasPrefix(req.Content, "/") {
			if handled, err := executeChatSlashCommand(r.Context(), db, sessionID, req.Content); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			} else if handled {
				writeJSON(w, http.StatusOK, map[string]any{"ok": true, "command": true})
				return
			}
		}

		runID, turnIndex, err := createRunForSessionMessage(r.Context(), db, workspaceRoot, sessionID, req.Content)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, sql.ErrNoRows) {
				status = http.StatusNotFound
			} else if errors.Is(err, errChatSessionArchived) || errors.Is(err, errChatMessageContentNeeded) || errors.Is(err, errWorkspacePathOutsideRoot) {
				status = http.StatusBadRequest
			}
			writeJSON(w, status, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"session_id": sessionID, "run_id": runID, "turn_index": turnIndex, "status": "queued",
		})
	}
}

func uploadChatSessionAttachmentsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := chi.URLParam(r, "id")
		var latestRunID string
		err := db.QueryRowContext(r.Context(), `
			SELECT run_id FROM session_runs WHERE session_id=? ORDER BY turn_index DESC LIMIT 1
		`, sessionID).Scan(&latestRunID)
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "session has no run yet; send a message first"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		uploaded, err := uploadFilesToRun(r.Context(), db, r, latestRunID)
		if err != nil {
			code := http.StatusInternalServerError
			if errors.Is(err, errInvalidMultipartPayload) || errors.Is(err, errNoFilesUploaded) {
				code = http.StatusBadRequest
			} else if errors.Is(err, errRunClosedForUploads) || errors.Is(err, errRunNotFound) {
				code = http.StatusConflict
			}
			writeJSON(w, code, map[string]string{"error": err.Error()})
			return
		}
		if len(uploaded) > 0 {
			fileNames := make([]string, 0, len(uploaded))
			for _, item := range uploaded {
				if name, ok := item["name"].(string); ok && strings.TrimSpace(name) != "" {
					fileNames = append(fileNames, name)
				}
			}
			sort.Strings(fileNames)
			msg := fmt.Sprintf("Attached %d file(s): %s", len(fileNames), strings.Join(fileNames, ", "))
			_, _ = db.ExecContext(r.Context(), `
				INSERT INTO chat_messages(id,session_id,turn_index,role,content,source,run_id,created_at,updated_at)
				VALUES(?,?,?,?,?,?,?,?,?)
			`, uuid.NewString(), sessionID, latestTurnIndexForSession(r.Context(), db, sessionID), "system", msg, "chat.attachments", latestRunID, time.Now().UTC().Format(time.RFC3339Nano), time.Now().UTC().Format(time.RFC3339Nano))
		}
		writeJSON(w, http.StatusOK, map[string]any{"uploaded": uploaded, "count": len(uploaded), "run_id": latestRunID})
	}
}

func executeChatSlashCommand(ctx context.Context, db *sql.DB, sessionID, raw string) (bool, error) {
	parts := strings.Fields(strings.TrimSpace(raw))
	if len(parts) == 0 {
		return false, nil
	}
	cmd := strings.ToLower(strings.TrimPrefix(parts[0], "/"))
	var latestRunID string
	err := db.QueryRowContext(ctx, `SELECT run_id FROM session_runs WHERE session_id=? ORDER BY turn_index DESC LIMIT 1`, sessionID).Scan(&latestRunID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return true, fmt.Errorf("resolve latest run: %w", err)
	}
	if latestRunID == "" {
		return true, errors.New("session has no run yet")
	}
	statusForCommand := map[string]string{
		"resume":    "queued",
		"interrupt": "interrupted",
		"cancel":    "cancelled",
	}
	switch cmd {
	case "approve":
		if _, err := db.ExecContext(ctx, `
			UPDATE approvals SET status='approved', decided_at=?, decided_by='operator'
			WHERE id=(SELECT id FROM approvals WHERE run_id=? AND status='pending' ORDER BY requested_at DESC LIMIT 1)
		`, time.Now().UTC().Format(time.RFC3339Nano), latestRunID); err != nil {
			return true, fmt.Errorf("approve failed: %w", err)
		}
		_, _ = db.ExecContext(ctx, `UPDATE runs SET status='queued', updated_at=? WHERE id=?`, time.Now().UTC().Format(time.RFC3339Nano), latestRunID)
		return true, nil
	case "open-run":
		return true, nil
	case "resume", "interrupt", "cancel":
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := db.ExecContext(ctx, `UPDATE runs SET status=?, updated_at=? WHERE id=?`, statusForCommand[cmd], now, latestRunID); err != nil {
			return true, fmt.Errorf("%s failed: %w", cmd, err)
		}
		return true, nil
	default:
		return false, nil
	}
}

func createRunForSessionMessage(ctx context.Context, db *sql.DB, workspaceRoot, sessionID, content string) (string, int, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", 0, err
	}
	rolledBack := false
	defer func() {
		if !rolledBack {
			_ = tx.Rollback()
		}
	}()

	var agentID, sessionStatus, sessionTitle string
	if err := tx.QueryRowContext(ctx, `SELECT agent_id,status,title FROM chat_sessions WHERE id=?`, sessionID).Scan(&agentID, &sessionStatus, &sessionTitle); err != nil {
		return "", 0, err
	}
	if sessionStatus == "archived" {
		return "", 0, errChatSessionArchived
	}

	var defaultProvider, defaultModel, defaultEnvironmentID, defaultVaultID, contractType, contractPayload string
	var defaultMaxSteps int
	if err := tx.QueryRowContext(ctx, `
		SELECT provider,model,default_max_steps,default_environment_id,default_credential_vault_id,output_contract_type,output_contract_payload
		FROM agents WHERE id=?
	`, agentID).Scan(&defaultProvider, &defaultModel, &defaultMaxSteps, &defaultEnvironmentID, &defaultVaultID, &contractType, &contractPayload); err != nil {
		return "", 0, err
	}

	var prevRunID string
	var prevWorkspace, prevProvider, prevModel, prevEnvironmentID, prevVaultID, prevContractType, prevContractPayload string
	var prevMaxSteps int
	_ = tx.QueryRowContext(ctx, `
		SELECT r.id,r.workspace_path,r.provider,r.model,r.max_steps,r.environment_id,r.credential_vault_id,r.output_contract_type,r.output_contract_payload
		FROM session_runs sr
		JOIN runs r ON r.id=sr.run_id
		WHERE sr.session_id=?
		ORDER BY sr.turn_index DESC
		LIMIT 1
	`, sessionID).Scan(&prevRunID, &prevWorkspace, &prevProvider, &prevModel, &prevMaxSteps, &prevEnvironmentID, &prevVaultID, &prevContractType, &prevContractPayload)

	var replayFromStep int
	if prevRunID != "" {
		_ = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(idx),0)+1 FROM run_steps WHERE run_id=?`, prevRunID).Scan(&replayFromStep)
	}
	if replayFromStep <= 0 {
		replayFromStep = 1
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	runID := uuid.NewString()
	workspacePath := strings.TrimSpace(prevWorkspace)
	if workspacePath == "" {
		workspacePath = filepath.Join(workspaceRoot, "chat-sessions", sessionID)
	}
	workspacePath, err = filepath.Abs(workspacePath)
	if err != nil {
		return "", 0, errors.New("invalid workspace_path")
	}
	workspacePath, err = ensurePathWithinRoot(workspaceRoot, workspacePath)
	if err != nil {
		return "", 0, errWorkspacePathOutsideRoot
	}
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		return "", 0, errors.New("failed to create workspace")
	}
	provider := defaultProvider
	model := defaultModel
	maxSteps := defaultMaxSteps
	environmentID := defaultEnvironmentID
	vaultID := defaultVaultID
	outputContractType := contractType
	outputContractPayload := contractPayload
	if prevRunID != "" {
		provider = prevProvider
		model = prevModel
		maxSteps = prevMaxSteps
		environmentID = prevEnvironmentID
		vaultID = prevVaultID
		outputContractType = prevContractType
		outputContractPayload = prevContractPayload
	}
	if maxSteps <= 0 {
		maxSteps = 30
	}
	if err := validateOutputContractDefinition(outputContractType, outputContractPayload); err != nil {
		return "", 0, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runs(id,agent_id,status,task,workspace_path,provider,model,max_steps,replay_source_run_id,replay_from_step,environment_id,credential_vault_id,output_contract_type,output_contract_payload,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
	`, runID, agentID, "queued", content, workspacePath, provider, model, maxSteps, prevRunID, replayFromStep, environmentID, vaultID, normalizeOutputContractType(outputContractType), strings.TrimSpace(outputContractPayload), now, now); err != nil {
		return "", 0, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO events(id,run_id,event_type,seq,payload_json,created_at) VALUES(?,?,?,?,?,?)`, uuid.NewString(), runID, "run.created", 1, `{"status":"queued"}`, now); err != nil {
		return "", 0, err
	}
	var nextTurn int
	const maxTurnInsertAttempts = 3
	insertedTurn := false
	for attempt := 1; attempt <= maxTurnInsertAttempts; attempt++ {
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(turn_index),0)+1 FROM session_runs WHERE session_id=?`, sessionID).Scan(&nextTurn); err != nil {
			return "", 0, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO session_runs(session_id,run_id,turn_index,created_at) VALUES(?,?,?,?)`, sessionID, runID, nextTurn, now); err != nil {
			if isUniqueConstraint(err) && attempt < maxTurnInsertAttempts {
				continue
			}
			return "", 0, err
		}
		insertedTurn = true
		break
	}
	if !insertedTurn {
		return "", 0, errors.New("unable to assign session turn index")
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO chat_messages(id,session_id,turn_index,role,content,source,run_id,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?)
	`, uuid.NewString(), sessionID, nextTurn, "user", content, "chat", runID, now, now); err != nil {
		return "", 0, err
	}
	if strings.TrimSpace(sessionTitle) == "" || sessionTitle == "New chat session" {
		_, _ = tx.ExecContext(ctx, `UPDATE chat_sessions SET title=?, updated_at=? WHERE id=?`, truncateChatTitle(content), now, sessionID)
	} else {
		_, _ = tx.ExecContext(ctx, `UPDATE chat_sessions SET updated_at=? WHERE id=?`, now, sessionID)
	}
	if err := tx.Commit(); err != nil {
		return "", 0, err
	}
	rolledBack = true
	return runID, nextTurn, nil
}

func uploadFilesToRun(ctx context.Context, db *sql.DB, r *http.Request, runID string) ([]map[string]any, error) {
	var workspacePath string
	var runStatus string
	err := db.QueryRowContext(ctx, `SELECT workspace_path,status FROM runs WHERE id=?`, runID).Scan(&workspacePath, &runStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errRunNotFound
	}
	if err != nil {
		return nil, err
	}
	switch runStatus {
	case "completed", "failed", "cancelled":
		return nil, errRunClosedForUploads
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		return nil, errInvalidMultipartPayload
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		return nil, errNoFilesUploaded
	}
	nowTs := time.Now().UTC().Format(time.RFC3339Nano)
	uploadRoot := filepath.Join(workspacePath, "uploads")
	if err := os.MkdirAll(uploadRoot, 0o755); err != nil {
		return nil, errors.New("failed to create upload directory")
	}
	uploaded := make([]map[string]any, 0, len(files))
	for _, fileHeader := range files {
		if fileHeader == nil {
			continue
		}
		src, err := fileHeader.Open()
		if err != nil {
			return nil, errors.New("failed to read uploaded file")
		}
		baseName := sanitizeUploadFilename(fileHeader.Filename)
		dstPath := uniqueFilePath(uploadRoot, baseName)
		dst, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			_ = src.Close()
			return nil, errors.New("failed to write uploaded file")
		}
		written, copyErr := io.Copy(dst, src)
		_ = dst.Close()
		_ = src.Close()
		if copyErr != nil {
			return nil, errors.New("failed to copy uploaded file")
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO artifacts(id,run_id,step_id,kind,path,mime_type,size_bytes,created_at)
			VALUES(?,?,?,?,?,?,?,?)
		`, uuid.NewString(), runID, "", "uploaded_file", dstPath, fileHeader.Header.Get("Content-Type"), written, nowTs); err != nil {
			return nil, errors.New("failed to register uploaded artifact")
		}
		relPath := strings.TrimPrefix(strings.ReplaceAll(dstPath, filepath.Clean(workspacePath), ""), string(filepath.Separator))
		uploaded = append(uploaded, map[string]any{
			"name":       baseName,
			"path":       relPath,
			"size_bytes": written,
		})
	}
	if len(uploaded) > 0 {
		if _, err := appendEventWithRetry(ctx, db, runID, "", "run.files_uploaded", map[string]any{"count": len(uploaded), "files": uploaded}); err != nil {
			return nil, fmt.Errorf("failed to append upload event: %w", err)
		}
	}
	return uploaded, nil
}

func truncateChatTitle(content string) string {
	clean := strings.TrimSpace(content)
	if clean == "" {
		return "New chat session"
	}
	if len(clean) > 120 {
		return clean[:120]
	}
	return clean
}

func isUniqueConstraint(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") || strings.Contains(msg, "constraint failed")
}

func latestTurnIndexForSession(ctx context.Context, db *sql.DB, sessionID string) int {
	var turn int
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(MAX(turn_index),1) FROM session_runs WHERE session_id=?`, sessionID).Scan(&turn); err != nil {
		return 1
	}
	if turn < 1 {
		return 1
	}
	return turn
}

func normalizeOutputContractType(raw string) string {
	normalized := strings.TrimSpace(strings.ToLower(raw))
	if normalized == "" {
		return "none"
	}
	return normalized
}

func validateOutputContractDefinition(contractType, contractPayload string) error {
	contractType = normalizeOutputContractType(contractType)
	contractPayload = strings.TrimSpace(contractPayload)
	switch contractType {
	case "none":
		return nil
	case "regex":
		if contractPayload == "" {
			return errors.New("output_contract_payload is required when output_contract_type=regex")
		}
		if _, err := regexp.Compile(contractPayload); err != nil {
			return fmt.Errorf("invalid regex output contract: %w", err)
		}
		return nil
	case "json_schema":
		if contractPayload == "" {
			return errors.New("output_contract_payload is required when output_contract_type=json_schema")
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(contractPayload), &parsed); err != nil {
			return fmt.Errorf("invalid json schema payload: %w", err)
		}
		if len(parsed) == 0 {
			return errors.New("json_schema payload must not be empty")
		}
		return nil
	default:
		return fmt.Errorf("unsupported output_contract_type: %s", contractType)
	}
}
