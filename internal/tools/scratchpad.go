package tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const scratchpadMaxKeyLen = 120
const scratchpadMaxValueLen = 32 * 1024
const scratchpadListCap = 200

func (e *Executor) resolveSessionID(ctx context.Context, runID string) (string, error) {
	if e.DB == nil {
		return "", fmt.Errorf("scratchpad requires a database")
	}
	var sessionID string
	err := e.DB.QueryRowContext(ctx,
		`SELECT session_id FROM session_runs WHERE run_id=? LIMIT 1`, runID).Scan(&sessionID)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("scratchpad: run %s is not attached to a chat session", runID)
		}
		return "", err
	}
	return sessionID, nil
}

func (e *Executor) scratchpadWrite(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
		Note  string `json:"note"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	key := strings.TrimSpace(req.Key)
	if key == "" {
		return Result{}, fmt.Errorf("key required")
	}
	if len(key) > scratchpadMaxKeyLen {
		return Result{}, fmt.Errorf("key too long (max %d chars)", scratchpadMaxKeyLen)
	}
	if len(req.Value) > scratchpadMaxValueLen {
		return Result{}, fmt.Errorf("value too long (max %d bytes)", scratchpadMaxValueLen)
	}
	sessionID, err := e.resolveSessionID(ctx, runCtx.RunID)
	if err != nil {
		return Result{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := uuid.NewString()
	_, err = e.DB.ExecContext(ctx, `
		INSERT INTO session_scratchpad(id, session_id, key, value, note, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(session_id, key) DO UPDATE SET
		  value=excluded.value,
		  note=excluded.note,
		  updated_at=excluded.updated_at
	`, id, sessionID, key, req.Value, req.Note, now, now)
	if err != nil {
		return Result{}, err
	}
	return Result{Output: map[string]any{
		"ok":         true,
		"key":        key,
		"bytes":      len(req.Value),
		"session_id": sessionID,
	}}, nil
}

func (e *Executor) scratchpadRead(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Key string `json:"key"`
	}
	if len(input) > 0 {
		_ = json.Unmarshal(input, &req)
	}
	sessionID, err := e.resolveSessionID(ctx, runCtx.RunID)
	if err != nil {
		return Result{}, err
	}
	key := strings.TrimSpace(req.Key)
	if key != "" {
		var value, note, updatedAt string
		err := e.DB.QueryRowContext(ctx,
			`SELECT value, note, updated_at FROM session_scratchpad WHERE session_id=? AND key=?`,
			sessionID, key).Scan(&value, &note, &updatedAt)
		if err == sql.ErrNoRows {
			return Result{Output: map[string]any{"found": false, "key": key}}, nil
		}
		if err != nil {
			return Result{}, err
		}
		return Result{Output: map[string]any{
			"found":      true,
			"key":        key,
			"value":      value,
			"note":       note,
			"updated_at": updatedAt,
		}}, nil
	}
	rows, err := e.DB.QueryContext(ctx, `
		SELECT key, value, note, updated_at FROM session_scratchpad
		WHERE session_id=?
		ORDER BY updated_at DESC
		LIMIT ?
	`, sessionID, scratchpadListCap)
	if err != nil {
		return Result{}, err
	}
	defer rows.Close()
	entries := make([]map[string]any, 0)
	for rows.Next() {
		var k, v, n, u string
		if err := rows.Scan(&k, &v, &n, &u); err != nil {
			return Result{}, err
		}
		entries = append(entries, map[string]any{
			"key":        k,
			"value":      v,
			"note":       n,
			"updated_at": u,
		})
	}
	return Result{Output: map[string]any{
		"entries": entries,
		"count":   len(entries),
	}}, nil
}

func (e *Executor) scratchpadDelete(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	key := strings.TrimSpace(req.Key)
	if key == "" {
		return Result{}, fmt.Errorf("key required")
	}
	sessionID, err := e.resolveSessionID(ctx, runCtx.RunID)
	if err != nil {
		return Result{}, err
	}
	res, err := e.DB.ExecContext(ctx,
		`DELETE FROM session_scratchpad WHERE session_id=? AND key=?`, sessionID, key)
	if err != nil {
		return Result{}, err
	}
	affected, _ := res.RowsAffected()
	return Result{Output: map[string]any{
		"ok":      true,
		"key":     key,
		"deleted": affected > 0,
	}}, nil
}
