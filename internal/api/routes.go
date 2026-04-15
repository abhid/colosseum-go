package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/adevireddy/colosseum/internal/providers"
	"github.com/adevireddy/colosseum/internal/tools"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type createAgentRequest struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Provider     string   `json:"provider"`
	Model        string   `json:"model"`
	SystemPrompt string   `json:"system_prompt"`
	AllowedTools []string `json:"allowed_tools"`
}

type createRunRequest struct {
	AgentID             string `json:"agent_id"`
	Task                string `json:"task"`
	WorkspacePath       string `json:"workspace_path"`
	SourceWorkspacePath string `json:"source_workspace_path"`
	ReplaySourceRunID   string `json:"replay_source_run_id"`
	ReplayFromStep      int    `json:"replay_from_step"`
	Provider            string `json:"provider"`
	Model               string `json:"model"`
	MaxSteps            int    `json:"max_steps"`
}

type toolUpsertRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
	Kind        string          `json:"kind"`
	ConfigJSON  json.RawMessage `json:"config_json"`
	Enabled     bool            `json:"enabled"`
}

type enhancePromptRequest struct {
	Prompt   string `json:"prompt"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

func registerAPIRoutes(
	r chi.Router,
	db *sql.DB,
	workspaceRoot string,
	availableProviders map[string]bool,
	openAIKey string,
	providerMap map[string]providers.Client,
) {
	r.Route("/api", func(r chi.Router) {
		r.Post("/agents", createAgentHandler(db))
		r.Get("/agents", listAgentsHandler(db))
		r.Put("/agents/{id}", updateAgentHandler(db))
		r.Delete("/agents/{id}", deleteAgentHandler(db))
		r.Get("/tools", listToolsHandler(db))
		r.Post("/tools", createToolHandler(db))
		r.Put("/tools/{id}", updateToolHandler(db))
		r.Delete("/tools/{id}", deleteToolHandler(db))
		r.Post("/tools/{id}/test", testToolHandler(db))
		r.Post("/runs", createRunHandler(db, workspaceRoot))
		r.Get("/runs", listRunsHandler(db))
		r.Get("/runs/{id}", getRunHandler(db))
		r.Post("/runs/{id}/replay", replayRunHandler(db, workspaceRoot))
		r.Get("/runs/{id}/trace", getRunTraceHandler(db))
		r.Get("/runs/{id}/telemetry", getRunTelemetryHandler(db))
		r.Get("/runs/{id}/artifacts", getRunArtifactsHandler(db))
		r.Get("/runs/{id}/artifacts/{artifactID}/content", getRunArtifactContentHandler(db))
		r.Get("/runs/{id}/export", exportRunBundleHandler(db))
		r.Post("/runs/{id}/cancel", updateRunStatusHandler(db, "cancelled"))
		r.Post("/runs/{id}/approve", approveLatestHandler(db))
		r.Post("/runs/{id}/interrupt", updateRunStatusHandler(db, "interrupted"))
		r.Post("/runs/{id}/resume", updateRunStatusHandler(db, "queued"))
		r.Post("/runs/{id}/events", appendRunEventHandler(db))
		r.Get("/providers", providersHandler(availableProviders))
		r.Get("/providers/openai/models", openAIModelsHandler(openAIKey))
		r.Post("/prompts/enhance", enhancePromptHandler(providerMap))
		r.Get("/evals/suites", listEvalSuitesHandler(db))
		r.Post("/evals/suites", createEvalSuiteHandler(db))
		r.Get("/evals/suites/{id}", getEvalSuiteHandler(db))
		r.Put("/evals/suites/{id}", updateEvalSuiteHandler(db))
		r.Post("/evals/suites/{id}/runs", queueEvalRunHandler(db))
		r.Get("/evals/suites/{id}/regression", getEvalRegressionHandler(db))
		r.Get("/evals/runs", listEvalRunsHandler(db))
		r.Get("/evals/runs/{id}", getEvalRunHandler(db))
		r.Get("/workflows", listWorkflowsHandler(db))
		r.Post("/workflows", createWorkflowHandler(db))
		r.Put("/workflows/{id}", updateWorkflowHandler(db))
		r.Delete("/workflows/{id}", deleteWorkflowHandler(db))
		r.Get("/policies", listPoliciesHandler(db))
		r.Post("/policies", createPolicyHandler(db))
		r.Put("/policies/{id}", updatePolicyHandler(db))
		r.Delete("/policies/{id}", deletePolicyHandler(db))
		r.Get("/secrets", listSecretsHandler(db))
		r.Post("/secrets", createSecretHandler(db))
		r.Delete("/secrets/{name}", deleteSecretHandler(db))
		r.Get("/provider-configs", listProviderConfigsHandler(db))
		r.Post("/provider-configs", createProviderConfigHandler(db))
		r.Put("/provider-configs/{id}", updateProviderConfigHandler(db))
		r.Delete("/provider-configs/{id}", deleteProviderConfigHandler(db))
		r.Get("/stream/runs/{id}", streamRunEventsHandler(db))
	})
}

func enhancePromptHandler(providerMap map[string]providers.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req enhancePromptRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		selectedProvider, client := pickEnhancerProvider(providerMap, req.Provider)
		if client == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no AI provider configured for prompt enhancement"})
			return
		}
		model := strings.TrimSpace(req.Model)
		candidateModels := buildEnhancerModelCandidates(selectedProvider, model)
		basePrompt := strings.TrimSpace(req.Prompt)
		if basePrompt == "" {
			basePrompt = "General-purpose autonomous coding/system harness."
		}

		systemInstruction := strings.TrimSpace(`
You are a senior prompt engineer. Rewrite the user's system prompt into a robust production-grade harness prompt for autonomous agents.

Requirements:
- Preserve user intent but make it clearer and more complete.
- Add clear safety boundaries and guardrails.
- Define planning and execution behavior.
- Include explicit input assumptions, output expectations, and failure handling.
- Include decision rules for when to ask clarifying questions versus acting directly.
- Bias strongly toward one-shot execution: complete the requested task in one run when feasible.
- Avoid conversational follow-ups after completion (e.g. "want me to also...") unless the task is blocked or ambiguous.
- When outputs are requested (artifacts, files, screenshots, patches), require generating them directly and citing the produced output.
- Include a strong "tool-first for external/current facts" rule when tools are available.
- Forbid "I cannot access X" responses when an allowed tool can retrieve or verify X.
- Require concise evidence from tool outputs in final answers whenever tools are used.
- Include concise formatting guidelines for agent responses.
- Keep it practical and actionable for real software tasks.
- Return only the final system prompt text (no markdown fences, no commentary). Don't include any prefixes.
`)
		userInstruction := fmt.Sprintf("Original system prompt:\n%s\n\nRewrite it now.", basePrompt)
		var attemptErrors []string
		for _, attemptModel := range candidateModels {
			resp, err := client.Complete(r.Context(), providers.CompletionRequest{
				Model:    attemptModel,
				System:   systemInstruction,
				Messages: []providers.Message{{Role: "user", Content: userInstruction}},
				Tools:    []providers.Tool{},
				Timeout:  45 * time.Second,
			})
			if err != nil {
				attemptErrors = append(attemptErrors, fmt.Sprintf("%s: %s", attemptModel, err.Error()))
				continue
			}
			enhanced := strings.TrimSpace(resp.Text)
			if enhanced == "" {
				attemptErrors = append(attemptErrors, fmt.Sprintf("%s: empty response text", attemptModel))
				continue
			}
			writeJSON(w, http.StatusOK, map[string]string{
				"provider": selectedProvider,
				"model":    attemptModel,
				"prompt":   enhanced,
			})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error":            "provider enhancement request failed",
			"provider":         selectedProvider,
			"attempted_models": candidateModels,
			"details":          attemptErrors,
		})
	}
}

func pickEnhancerProvider(providerMap map[string]providers.Client, requested string) (string, providers.Client) {
	want := strings.TrimSpace(strings.ToLower(requested))
	if want != "" {
		if client, ok := providerMap[want]; ok {
			return want, client
		}
	}
	if client, ok := providerMap["openai"]; ok {
		return "openai", client
	}
	if client, ok := providerMap["anthropic"]; ok {
		return "anthropic", client
	}
	for name, client := range providerMap {
		return name, client
	}
	return "", nil
}

func defaultEnhancerModel(provider string) string {
	switch provider {
	case "openai":
		return "gpt-5.4"
	case "anthropic":
		return "claude-3-5-sonnet-latest"
	default:
		return "gpt-5.4"
	}
}

func buildEnhancerModelCandidates(provider, requested string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, 4)
	add := func(model string) {
		m := strings.TrimSpace(model)
		if m == "" || seen[m] {
			return
		}
		seen[m] = true
		out = append(out, m)
	}
	add(requested)
	add(defaultEnhancerModel(provider))
	switch provider {
	case "openai":
		add("gpt-5.4")
		add("gpt-4.1-mini")
		add("gpt-4o-mini")
		add("gpt-4.1")
	case "anthropic":
		add("claude-3-5-sonnet-latest")
		add("claude-3-5-haiku-latest")
	}
	return out
}

func createAgentHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createAgentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.Name == "" || req.Provider == "" || req.Model == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name, provider, model required"})
			return
		}
		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		toolsJSON, _ := json.Marshal(req.AllowedTools)
		_, err := db.ExecContext(r.Context(), `
			INSERT INTO agents(id,name,description,provider,model,system_prompt,allowed_tools,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?)
		`, id, req.Name, req.Description, req.Provider, req.Model, req.SystemPrompt, string(toolsJSON), now, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"id": id})
	}
}

func listAgentsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.QueryContext(r.Context(), `SELECT id,name,description,provider,model,system_prompt,allowed_tools,created_at,updated_at FROM agents ORDER BY created_at DESC`)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, name, desc, provider, model, prompt, tools, createdAt, updatedAt string
			if err := rows.Scan(&id, &name, &desc, &provider, &model, &prompt, &tools, &createdAt, &updatedAt); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			out = append(out, map[string]any{
				"id": id, "name": name, "description": desc, "provider": provider, "model": model,
				"system_prompt": prompt, "allowed_tools": json.RawMessage(tools), "created_at": createdAt, "updated_at": updatedAt,
			})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func updateAgentHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agentID := chi.URLParam(r, "id")
		var req createAgentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.Name == "" || req.Provider == "" || req.Model == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name, provider, model required"})
			return
		}
		toolsJSON, _ := json.Marshal(req.AllowedTools)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		res, err := db.ExecContext(r.Context(), `
			UPDATE agents
			SET name=?, description=?, provider=?, model=?, system_prompt=?, allowed_tools=?, updated_at=?
			WHERE id=?
		`, req.Name, req.Description, req.Provider, req.Model, req.SystemPrompt, string(toolsJSON), now, agentID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": agentID})
	}
}

func deleteAgentHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		agentID := chi.URLParam(r, "id")
		forceDelete := parseTruthy(r.URL.Query().Get("force"))
		var deletedRuns int64
		var runCount int
		if err := db.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM runs WHERE agent_id=?`, agentID).Scan(&runCount); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if runCount > 0 && !forceDelete {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "agent has runs; cannot delete"})
			return
		}
		if runCount > 0 && forceDelete {
			n, err := deleteRunsForAgent(r.Context(), db, agentID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			deletedRuns = n
		}
		var suiteCount int
		if err := db.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM eval_suites WHERE agent_id=?`, agentID).Scan(&suiteCount); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if suiteCount > 0 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "agent is used by eval suites; cannot delete"})
			return
		}
		res, err := db.ExecContext(r.Context(), `DELETE FROM agents WHERE id=?`, agentID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "deleted_runs": deletedRuns})
	}
}

func deleteRunsForAgent(ctx context.Context, db *sql.DB, agentID string) (int64, error) {
	rows, err := db.QueryContext(ctx, `SELECT DISTINCT path FROM artifacts WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`, agentID)
	if err != nil {
		return 0, fmt.Errorf("query artifact paths: %w", err)
	}
	artifactPaths := make([]string, 0)
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			_ = rows.Close()
			return 0, fmt.Errorf("scan artifact path: %w", err)
		}
		if path != "" {
			artifactPaths = append(artifactPaths, path)
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, fmt.Errorf("iterate artifact paths: %w", err)
	}
	_ = rows.Close()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	rollBack := true
	defer func() {
		if rollBack {
			_ = tx.Rollback()
		}
	}()

	deleteStatements := []string{
		`DELETE FROM workflow_runs WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`,
		`DELETE FROM evaluations WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`,
		`DELETE FROM approvals WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`,
		`DELETE FROM containers WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`,
		`DELETE FROM artifacts WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`,
		`DELETE FROM events WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`,
		`DELETE FROM trace_spans WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`,
		`DELETE FROM tool_calls WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`,
		`DELETE FROM run_steps WHERE run_id IN (SELECT id FROM runs WHERE agent_id=?)`,
	}
	for _, stmt := range deleteStatements {
		if _, err := tx.ExecContext(ctx, stmt, agentID); err != nil {
			return 0, fmt.Errorf("delete run dependencies: %w", err)
		}
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM runs WHERE agent_id=?`, agentID)
	if err != nil {
		return 0, fmt.Errorf("delete runs: %w", err)
	}
	deletedRuns, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit tx: %w", err)
	}
	rollBack = false

	for _, artifactPath := range artifactPaths {
		cleanPath := filepath.Clean(artifactPath)
		if strings.HasPrefix(cleanPath, "inline://") {
			continue
		}
		_ = os.Remove(cleanPath)
	}
	return deletedRuns, nil
}

func listToolsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defs, err := tools.ListDefinitions(r.Context(), db, true)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, defs)
	}
}

func createToolHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req toolUpsertRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.Name == "" || req.Description == "" || len(req.InputSchema) == 0 || req.Kind == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name, description, kind, input_schema required"})
			return
		}
		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if len(req.ConfigJSON) == 0 {
			req.ConfigJSON = json.RawMessage(`{}`)
		}
		enabled := 0
		if req.Enabled {
			enabled = 1
		}
		_, err := db.ExecContext(r.Context(), `INSERT INTO tool_defs(id,name,description,input_schema_json,kind,config_json,enabled,is_builtin,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
			id, req.Name, req.Description, string(req.InputSchema), req.Kind, string(req.ConfigJSON), enabled, 0, now, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updateToolHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var req toolUpsertRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		enabled := 0
		if req.Enabled {
			enabled = 1
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if len(req.ConfigJSON) == 0 {
			req.ConfigJSON = json.RawMessage(`{}`)
		}
		res, err := db.ExecContext(r.Context(), `
			UPDATE tool_defs SET
			 name=?, description=?, input_schema_json=?, kind=?, config_json=?, enabled=?, updated_at=?
			WHERE id=? AND is_builtin=0
		`, req.Name, req.Description, string(req.InputSchema), req.Kind, string(req.ConfigJSON), enabled, now, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "tool not found or immutable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": id})
	}
}

func deleteToolHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		res, err := db.ExecContext(r.Context(), `DELETE FROM tool_defs WHERE id=? AND is_builtin=0`, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "tool not found or immutable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

func testToolHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var req struct {
			WorkspacePath string          `json:"workspace_path"`
			Input         json.RawMessage `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.WorkspacePath == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "workspace_path required"})
			return
		}
		var name string
		if err := db.QueryRowContext(r.Context(), `SELECT name FROM tool_defs WHERE id=?`, id).Scan(&name); err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "tool not found"})
			return
		}
		exec := &tools.Executor{DB: db, ArtifactsDir: "./artifacts"}
		res, err := exec.Execute(r.Context(), tools.Context{RunID: "tool-test", StepID: "tool-test", Workspace: req.WorkspacePath}, name, req.Input)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "output": res.Output, "log": res.Log})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": res.Output, "log": res.Log})
	}
}

func createRunHandler(db *sql.DB, workspaceRoot string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createRunRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.AgentID == "" || req.Task == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agent_id and task required"})
			return
		}
		if req.MaxSteps <= 0 {
			req.MaxSteps = 30
		}
		if req.ReplayFromStep <= 0 {
			req.ReplayFromStep = 1
		}
		var defaultProvider, defaultModel string
		err := db.QueryRowContext(r.Context(), `SELECT provider, model FROM agents WHERE id=?`, req.AgentID).Scan(&defaultProvider, &defaultModel)
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if req.Provider == "" {
			req.Provider = defaultProvider
		}
		if req.Model == "" {
			req.Model = defaultModel
		}
		if req.ReplaySourceRunID != "" {
			var replayCount int
			if err := db.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM runs WHERE id=?`, req.ReplaySourceRunID).Scan(&replayCount); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			if replayCount == 0 {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "replay source run not found"})
				return
			}
		}
		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		workspacePath := req.WorkspacePath
		if workspacePath == "" {
			workspacePath = filepath.Join(workspaceRoot, id)
		}
		workspacePath, err = filepath.Abs(workspacePath)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workspace_path"})
			return
		}
		if err := os.MkdirAll(workspacePath, 0o755); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create workspace"})
			return
		}
		if req.SourceWorkspacePath != "" {
			sourcePath, err := filepath.Abs(req.SourceWorkspacePath)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid source_workspace_path"})
				return
			}
			if err := copyDirectory(sourcePath, workspacePath); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to seed workspace: " + err.Error()})
				return
			}
		}
		_, err = db.ExecContext(r.Context(), `
			INSERT INTO runs(id,agent_id,status,task,workspace_path,provider,model,max_steps,replay_source_run_id,replay_from_step,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
		`, id, req.AgentID, "queued", req.Task, workspacePath, req.Provider, req.Model, req.MaxSteps, req.ReplaySourceRunID, req.ReplayFromStep, now, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		_, _ = db.ExecContext(r.Context(), `INSERT INTO events(id,run_id,event_type,seq,payload_json,created_at) VALUES(?,?,?,?,?,?)`, uuid.NewString(), id, "run.created", 1, `{"status":"queued"}`, now)
		writeJSON(w, http.StatusCreated, map[string]any{"id": id, "status": "queued", "workspace_path": workspacePath})
	}
}

func replayRunHandler(db *sql.DB, workspaceRoot string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sourceRunID := chi.URLParam(r, "id")
		var req struct {
			ResumeFromStep int    `json:"resume_from_step"`
			Provider       string `json:"provider"`
			Model          string `json:"model"`
			MaxSteps       int    `json:"max_steps"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.ResumeFromStep <= 0 {
			req.ResumeFromStep = 1
		}
		var src struct {
			AgentID       string
			Task          string
			WorkspacePath string
			Provider      string
			Model         string
			MaxSteps      int
		}
		err := db.QueryRowContext(r.Context(), `SELECT agent_id,task,workspace_path,provider,model,max_steps FROM runs WHERE id=?`, sourceRunID).
			Scan(&src.AgentID, &src.Task, &src.WorkspacePath, &src.Provider, &src.Model, &src.MaxSteps)
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "source run not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if req.Provider == "" {
			req.Provider = src.Provider
		}
		if req.Model == "" {
			req.Model = src.Model
		}
		if req.MaxSteps <= 0 {
			req.MaxSteps = src.MaxSteps
		}
		if req.MaxSteps <= 0 {
			req.MaxSteps = 30
		}

		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		workspacePath := filepath.Join(workspaceRoot, id)
		workspacePath, err = filepath.Abs(workspacePath)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workspace_path"})
			return
		}
		if err := os.MkdirAll(workspacePath, 0o755); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create workspace"})
			return
		}
		if src.WorkspacePath != "" {
			if err := copyDirectory(src.WorkspacePath, workspacePath); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to copy source workspace: " + err.Error()})
				return
			}
		}
		_, err = db.ExecContext(r.Context(), `
			INSERT INTO runs(id,agent_id,status,task,workspace_path,provider,model,max_steps,replay_source_run_id,replay_from_step,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
		`, id, src.AgentID, "queued", src.Task, workspacePath, req.Provider, req.Model, req.MaxSteps, sourceRunID, req.ResumeFromStep, now, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		_, _ = db.ExecContext(r.Context(), `INSERT INTO events(id,run_id,event_type,seq,payload_json,created_at) VALUES(?,?,?,?,?,?)`,
			uuid.NewString(), id, "run.created", 1, fmt.Sprintf(`{"status":"queued","replay_source_run_id":"%s","resume_from_step":%d}`, sourceRunID, req.ResumeFromStep), now)
		writeJSON(w, http.StatusCreated, map[string]any{"id": id, "status": "queued", "workspace_path": workspacePath})
	}
}

func listRunsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.QueryContext(r.Context(), `SELECT id,agent_id,status,task,workspace_path,provider,model,max_steps,replay_source_run_id,replay_from_step,created_at,updated_at,started_at,completed_at,error FROM runs ORDER BY created_at DESC`)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, agentID, status, task, ws, provider, model, createdAt, updatedAt, runErr, replaySource string
			var startedAt, completedAt sql.NullString
			var maxSteps, replayFromStep int
			if err := rows.Scan(&id, &agentID, &status, &task, &ws, &provider, &model, &maxSteps, &replaySource, &replayFromStep, &createdAt, &updatedAt, &startedAt, &completedAt, &runErr); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			out = append(out, map[string]any{
				"id": id, "agent_id": agentID, "status": status, "task": task, "workspace_path": ws,
				"provider": provider, "model": model, "max_steps": maxSteps,
				"replay_source_run_id": replaySource, "replay_from_step": replayFromStep,
				"created_at": createdAt, "updated_at": updatedAt, "started_at": startedAt.String, "completed_at": completedAt.String, "error": runErr,
			})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func getRunHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		var id, agentID, status, task, ws, provider, model, createdAt, updatedAt, runErr, replaySource string
		var startedAt, completedAt sql.NullString
		var maxSteps, replayFromStep int
		err := db.QueryRowContext(r.Context(), `SELECT id,agent_id,status,task,workspace_path,provider,model,max_steps,replay_source_run_id,replay_from_step,created_at,updated_at,started_at,completed_at,error FROM runs WHERE id=?`, runID).
			Scan(&id, &agentID, &status, &task, &ws, &provider, &model, &maxSteps, &replaySource, &replayFromStep, &createdAt, &updatedAt, &startedAt, &completedAt, &runErr)
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "run not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id": id, "agent_id": agentID, "status": status, "task": task, "workspace_path": ws,
			"provider": provider, "model": model, "max_steps": maxSteps,
			"replay_source_run_id": replaySource, "replay_from_step": replayFromStep,
			"created_at": createdAt, "updated_at": updatedAt, "started_at": startedAt, "completed_at": completedAt, "error": runErr,
		})
	}
}

func getRunTraceHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		rows, err := db.QueryContext(r.Context(), `SELECT id,step_id,event_type,seq,payload_json,created_at FROM events WHERE run_id=? ORDER BY seq ASC`, runID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, stepID, typ, payload, createdAt string
			var seq int
			if err := rows.Scan(&id, &stepID, &typ, &seq, &payload, &createdAt); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			out = append(out, map[string]any{"id": id, "step_id": stepID, "event_type": typ, "seq": seq, "payload": json.RawMessage(payload), "created_at": createdAt})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func getRunTelemetryHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		var runCount int
		if err := db.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM runs WHERE id=?`, runID).Scan(&runCount); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if runCount == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "run not found"})
			return
		}

		payload := map[string]any{
			"steps":      fetchRows(r.Context(), db, `SELECT id,idx,step_type,status,input_json,output_json,error,created_at,started_at,ended_at FROM run_steps WHERE run_id=? ORDER BY idx ASC`, runID),
			"tool_calls": fetchRows(r.Context(), db, `SELECT id,step_id,tool_name,tool_version,input_json,output_json,status,started_at,ended_at,error_class,error_message FROM tool_calls WHERE run_id=? ORDER BY started_at ASC`, runID),
			"spans":      fetchRows(r.Context(), db, `SELECT id,parent_id,name,kind,status,started_at,ended_at,attrs_json FROM trace_spans WHERE run_id=? ORDER BY started_at ASC`, runID),
			"events":     fetchRows(r.Context(), db, `SELECT id,step_id,event_type,seq,payload_json,created_at FROM events WHERE run_id=? ORDER BY seq ASC`, runID),
		}
		writeJSON(w, http.StatusOK, payload)
	}
}

func getRunArtifactsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		rows, err := db.QueryContext(r.Context(), `SELECT id,step_id,kind,path,mime_type,size_bytes,created_at FROM artifacts WHERE run_id=? ORDER BY created_at DESC`, runID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, stepID, kind, path, mime, createdAt string
			var size int64
			if err := rows.Scan(&id, &stepID, &kind, &path, &mime, &size, &createdAt); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			out = append(out, map[string]any{"id": id, "step_id": stepID, "kind": kind, "path": path, "mime_type": mime, "size_bytes": size, "created_at": createdAt})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func getRunArtifactContentHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		artifactID := chi.URLParam(r, "artifactID")
		var path, mime string
		err := db.QueryRowContext(r.Context(), `SELECT path,mime_type FROM artifacts WHERE run_id=? AND id=?`, runID, artifactID).Scan(&path, &mime)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "artifact not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if strings.HasPrefix(path, "inline://") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "inline artifacts do not have file content"})
			return
		}
		cleanPath := filepath.Clean(path)
		info, err := os.Stat(cleanPath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "artifact file not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if info.IsDir() {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "artifact path is a directory"})
			return
		}
		content, err := os.ReadFile(cleanPath)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if strings.TrimSpace(mime) == "" {
			mime = http.DetectContentType(content)
		}
		if mime != "" {
			w.Header().Set("Content-Type", mime)
		}
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(content)
	}
}

func updateRunStatusHandler(db *sql.DB, status string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		now := time.Now().UTC().Format(time.RFC3339Nano)
		res, err := db.ExecContext(r.Context(), `UPDATE runs SET status=?, updated_at=? WHERE id=?`, status, now, runID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "run not found"})
			return
		}
		seq := nextEventSeq(db, runID)
		_, _ = db.ExecContext(r.Context(), `INSERT INTO events(id,run_id,event_type,seq,payload_json,created_at) VALUES(?,?,?,?,?,?)`, uuid.NewString(), runID, "run.status", seq, `{"status":"`+status+`"}`, now)
		writeJSON(w, http.StatusOK, map[string]string{"status": status})
	}
}

func approveLatestHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_, _ = db.ExecContext(r.Context(), `UPDATE approvals SET status='approved', decided_at=?, decided_by='operator' WHERE run_id=? AND status='pending'`, now, runID)
		_, _ = db.ExecContext(r.Context(), `UPDATE runs SET status='queued', updated_at=? WHERE id=? AND status='interrupted'`, now, runID)
		seq := nextEventSeq(db, runID)
		_, _ = db.ExecContext(r.Context(), `INSERT INTO events(id,run_id,event_type,seq,payload_json,created_at) VALUES(?,?,?,?,?,?)`, uuid.NewString(), runID, "approval.approved", seq, `{"by":"operator"}`, now)
		writeJSON(w, http.StatusOK, map[string]string{"status": "approved"})
	}
}

func appendRunEventHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		body, _ := json.Marshal(payload)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		seq := nextEventSeq(db, runID)
		_, err := db.ExecContext(r.Context(), `INSERT INTO events(id,run_id,event_type,seq,payload_json,created_at) VALUES(?,?,?,?,?,?)`, uuid.NewString(), runID, "user.event", seq, string(body), now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		_, _ = db.ExecContext(
			r.Context(),
			`UPDATE runs SET status='queued', completed_at=NULL, error='', updated_at=? WHERE id=? AND status IN ('interrupted','completed','failed','cancelled')`,
			now,
			runID,
		)
		var status string
		_ = db.QueryRowContext(r.Context(), `SELECT status FROM runs WHERE id=?`, runID).Scan(&status)
		writeJSON(w, http.StatusCreated, map[string]any{"seq": seq, "status": status})
	}
}

func providersHandler(availableProviders map[string]bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out := make([]map[string]any, 0, 2)
		if availableProviders["anthropic"] {
			out = append(out, map[string]any{
				"provider":           "anthropic",
				"supports_tools":     true,
				"supports_streaming": true,
			})
		}
		if availableProviders["openai"] {
			out = append(out, map[string]any{
				"provider":           "openai",
				"supports_tools":     true,
				"supports_streaming": true,
			})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func openAIModelsHandler(openAIKey string) http.HandlerFunc {
	type model struct {
		ID string `json:"id"`
	}
	type modelListResponse struct {
		Data []model `json:"data"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimSpace(openAIKey) == "" {
			writeJSON(w, http.StatusOK, []string{})
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://api.openai.com/v1/models", nil)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to build openai models request"})
			return
		}
		req.Header.Set("Authorization", "Bearer "+openAIKey)
		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "openai models request failed"})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 300 {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("openai models request failed with status %d", resp.StatusCode)})
			return
		}
		var parsed modelListResponse
		if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to parse openai models response"})
			return
		}
		seen := map[string]bool{}
		models := make([]string, 0, len(parsed.Data))
		for _, row := range parsed.Data {
			id := strings.TrimSpace(row.ID)
			if id == "" || !isUsableOpenAIModel(id) || seen[id] {
				continue
			}
			seen[id] = true
			models = append(models, id)
		}
		sort.Strings(models)
		writeJSON(w, http.StatusOK, models)
	}
}

func isUsableOpenAIModel(id string) bool {
	lower := strings.ToLower(id)
	if strings.Contains(lower, "audio") ||
		strings.Contains(lower, "tts") ||
		strings.Contains(lower, "transcribe") ||
		strings.Contains(lower, "whisper") ||
		strings.Contains(lower, "embedding") ||
		strings.Contains(lower, "moderation") ||
		strings.Contains(lower, "image") ||
		strings.Contains(lower, "realtime") {
		return false
	}
	return strings.HasPrefix(lower, "gpt-") ||
		strings.HasPrefix(lower, "o1") ||
		strings.HasPrefix(lower, "o3") ||
		strings.HasPrefix(lower, "o4")
}

func listWorkflowsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.QueryContext(r.Context(), `SELECT id,name,definition_json,created_at,updated_at FROM workflow_defs ORDER BY created_at DESC`)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, name, definition, createdAt, updatedAt string
			if err := rows.Scan(&id, &name, &definition, &createdAt, &updatedAt); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			out = append(out, map[string]any{"id": id, "name": name, "definition": json.RawMessage(definition), "created_at": createdAt, "updated_at": updatedAt})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func createWorkflowHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name       string         `json:"name"`
			Definition map[string]any `json:"definition"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"})
			return
		}
		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		body, _ := json.Marshal(req.Definition)
		_, err := db.ExecContext(r.Context(), `INSERT INTO workflow_defs(id,name,definition_json,created_at,updated_at) VALUES(?,?,?,?,?)`, id, req.Name, string(body), now, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updateWorkflowHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var req struct {
			Name       string         `json:"name"`
			Definition map[string]any `json:"definition"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"})
			return
		}
		body, _ := json.Marshal(req.Definition)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		res, err := db.ExecContext(r.Context(), `UPDATE workflow_defs SET name=?, definition_json=?, updated_at=? WHERE id=?`, req.Name, string(body), now, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workflow not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": id})
	}
}

func deleteWorkflowHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		res, err := db.ExecContext(r.Context(), `DELETE FROM workflow_defs WHERE id=?`, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workflow not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

func listPoliciesHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, fetchRows(r.Context(), db, `SELECT id,name,definition_json,enabled,created_at,updated_at FROM policies ORDER BY created_at DESC`))
	}
}

func createPolicyHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name       string          `json:"name"`
			Definition json.RawMessage `json:"definition"`
			Enabled    bool            `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.Name == "" || len(req.Definition) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and definition required"})
			return
		}
		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		enabled := 0
		if req.Enabled {
			enabled = 1
		}
		_, err := db.ExecContext(r.Context(), `INSERT INTO policies(id,name,definition_json,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?)`, id, req.Name, string(req.Definition), enabled, now, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updatePolicyHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var req struct {
			Name       string          `json:"name"`
			Definition json.RawMessage `json:"definition"`
			Enabled    bool            `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		enabled := 0
		if req.Enabled {
			enabled = 1
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		res, err := db.ExecContext(r.Context(), `UPDATE policies SET name=?, definition_json=?, enabled=?, updated_at=? WHERE id=?`, req.Name, string(req.Definition), enabled, now, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "policy not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": id})
	}
}

func deletePolicyHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		res, err := db.ExecContext(r.Context(), `DELETE FROM policies WHERE id=?`, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "policy not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

func listSecretsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, fetchRows(r.Context(), db, `SELECT name,created_at,updated_at FROM secrets ORDER BY updated_at DESC`))
	}
}

func deleteSecretHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		res, err := db.ExecContext(r.Context(), `DELETE FROM secrets WHERE name=?`, name)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "secret not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

func listProviderConfigsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, fetchRows(r.Context(), db, `SELECT id,provider,name,config_json,created_at,updated_at FROM provider_configs ORDER BY updated_at DESC`))
	}
}

func createProviderConfigHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Provider string          `json:"provider"`
			Name     string          `json:"name"`
			Config   json.RawMessage `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.Provider == "" || req.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "provider and name required"})
			return
		}
		if len(req.Config) == 0 {
			req.Config = json.RawMessage(`{}`)
		}
		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_, err := db.ExecContext(r.Context(), `INSERT INTO provider_configs(id,provider,name,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?)`, id, req.Provider, req.Name, string(req.Config), now, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updateProviderConfigHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var req struct {
			Provider string          `json:"provider"`
			Name     string          `json:"name"`
			Config   json.RawMessage `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if len(req.Config) == 0 {
			req.Config = json.RawMessage(`{}`)
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		res, err := db.ExecContext(r.Context(), `UPDATE provider_configs SET provider=?, name=?, config_json=?, updated_at=? WHERE id=?`, req.Provider, req.Name, string(req.Config), now, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "provider config not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": id})
	}
}

func deleteProviderConfigHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		res, err := db.ExecContext(r.Context(), `DELETE FROM provider_configs WHERE id=?`, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "provider config not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

func createSecretHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.Name == "" || req.Value == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and value required"})
			return
		}
		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		cipher := redactedEncrypt(req.Value)
		_, err := db.ExecContext(r.Context(), `INSERT INTO secrets(id,name,cipher_text,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET cipher_text=excluded.cipher_text, updated_at=excluded.updated_at`, id, req.Name, cipher, now, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"name": req.Name})
	}
}

func redactedEncrypt(value string) string {
	// V1 local secret obfuscation for at-rest storage; execution paths still scope secrets explicitly.
	encoded := make([]byte, len(value))
	key := byte(0x5A)
	for i := range value {
		encoded[i] = value[i] ^ key
	}
	return fmt.Sprintf("%x", encoded)
}

func streamRunEventsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "stream unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		lastSeq := 0
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		send := func(ctx context.Context) error {
			rows, err := db.QueryContext(ctx, `SELECT id,step_id,event_type,seq,payload_json,created_at FROM events WHERE run_id=? AND seq>? ORDER BY seq ASC LIMIT 200`, runID, lastSeq)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var id, stepID, typ, payload, createdAt string
				var seq int
				if err := rows.Scan(&id, &stepID, &typ, &seq, &payload, &createdAt); err != nil {
					return err
				}
				lastSeq = seq
				evt := map[string]any{"id": id, "step_id": stepID, "event_type": typ, "seq": seq, "payload": json.RawMessage(payload), "created_at": createdAt}
				b, _ := json.Marshal(evt)
				if _, err := fmt.Fprintf(w, "event: run_event\ndata: %s\n\n", string(b)); err != nil {
					return err
				}
				flusher.Flush()
			}
			return nil
		}

		if err := send(r.Context()); err != nil {
			return
		}
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				if err := send(r.Context()); err != nil {
					return
				}
				_, _ = fmt.Fprint(w, ": ping\n\n")
				flusher.Flush()
			}
		}
	}
}

func exportRunBundleHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runID := chi.URLParam(r, "id")
		var id, agentID, status, task, workspace, provider, model, createdAt, updatedAt, runErr string
		var startedAt, completedAt sql.NullString
		var maxSteps int
		err := db.QueryRowContext(r.Context(), `SELECT id,agent_id,status,task,workspace_path,provider,model,max_steps,created_at,updated_at,started_at,completed_at,error FROM runs WHERE id=?`, runID).
			Scan(&id, &agentID, &status, &task, &workspace, &provider, &model, &maxSteps, &createdAt, &updatedAt, &startedAt, &completedAt, &runErr)
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "run not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		bundle := map[string]any{
			"run": map[string]any{
				"id": id, "agent_id": agentID, "status": status, "task": task,
				"workspace_path": workspace, "provider": provider, "model": model,
				"max_steps": maxSteps, "created_at": createdAt, "updated_at": updatedAt,
				"started_at": startedAt.String, "completed_at": completedAt.String, "error": runErr,
			},
			"events":      fetchRows(r.Context(), db, `SELECT id,step_id,event_type,seq,payload_json,created_at FROM events WHERE run_id=? ORDER BY seq ASC`, runID),
			"steps":       fetchRows(r.Context(), db, `SELECT id,idx,step_type,status,input_json,output_json,error,created_at,started_at,ended_at FROM run_steps WHERE run_id=? ORDER BY idx ASC`, runID),
			"tool_calls":  fetchRows(r.Context(), db, `SELECT id,step_id,tool_name,input_json,output_json,status,started_at,ended_at,error_class,error_message FROM tool_calls WHERE run_id=? ORDER BY started_at ASC`, runID),
			"trace_spans": fetchRows(r.Context(), db, `SELECT id,parent_id,name,kind,status,started_at,ended_at,attrs_json FROM trace_spans WHERE run_id=? ORDER BY started_at ASC`, runID),
			"artifacts":   fetchRows(r.Context(), db, `SELECT id,step_id,kind,path,mime_type,size_bytes,created_at FROM artifacts WHERE run_id=? ORDER BY created_at ASC`, runID),
		}
		w.Header().Set("Content-Disposition", "attachment; filename=run-"+runID+".json")
		writeJSON(w, http.StatusOK, bundle)
	}
}

func listEvalSuitesHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, fetchRows(r.Context(), db, `
			SELECT s.id,s.name,s.description,s.agent_id,s.created_at,s.updated_at,
			       (SELECT COUNT(1) FROM eval_cases c WHERE c.suite_id=s.id) AS case_count,
			       (SELECT status FROM eval_runs er WHERE er.suite_id=s.id ORDER BY er.created_at DESC LIMIT 1) AS latest_status,
			       (SELECT created_at FROM eval_runs er WHERE er.suite_id=s.id ORDER BY er.created_at DESC LIMIT 1) AS latest_run_at
			FROM eval_suites s ORDER BY s.updated_at DESC
		`))
	}
}

func getEvalSuiteHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		suiteID := chi.URLParam(r, "id")
		var count int
		if err := db.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM eval_suites WHERE id=?`, suiteID).Scan(&count); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if count == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "suite not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"suite": dbRow(r.Context(), db, `SELECT id,name,description,agent_id,created_at,updated_at FROM eval_suites WHERE id=?`, suiteID),
			"cases": fetchRows(r.Context(), db, `SELECT id,name,task,assertion_json,position,created_at,updated_at FROM eval_cases WHERE suite_id=? ORDER BY position ASC, created_at ASC`, suiteID),
			"runs":  fetchRows(r.Context(), db, `SELECT id,status,provider,model,max_steps,total_cases,passed_cases,failed_cases,created_at,started_at,completed_at,summary_json,error FROM eval_runs WHERE suite_id=? ORDER BY created_at DESC LIMIT 20`, suiteID),
		})
	}
}

func createEvalSuiteHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			AgentID     string `json:"agent_id"`
			Cases       []struct {
				Name      string          `json:"name"`
				Task      string          `json:"task"`
				Assertion json.RawMessage `json:"assertion"`
			} `json:"cases"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.Name == "" || req.AgentID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and agent_id required"})
			return
		}
		var agentCount int
		if err := db.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM agents WHERE id=?`, req.AgentID).Scan(&agentCount); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if agentCount == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		tx, err := db.BeginTx(r.Context(), nil)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		suiteID := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO eval_suites(id,name,description,agent_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`, suiteID, req.Name, req.Description, req.AgentID, now, now); err != nil {
			_ = tx.Rollback()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		for idx, c := range req.Cases {
			if strings.TrimSpace(c.Name) == "" || strings.TrimSpace(c.Task) == "" {
				continue
			}
			assertion := c.Assertion
			if len(assertion) == 0 {
				assertion = json.RawMessage(`{}`)
			}
			if _, err := tx.ExecContext(r.Context(), `
				INSERT INTO eval_cases(id,suite_id,name,task,assertion_json,position,created_at,updated_at)
				VALUES(?,?,?,?,?,?,?,?)
			`, uuid.NewString(), suiteID, c.Name, c.Task, string(assertion), idx, now, now); err != nil {
				_ = tx.Rollback()
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
		}
		if err := tx.Commit(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": suiteID})
	}
}

func updateEvalSuiteHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		suiteID := chi.URLParam(r, "id")
		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			AgentID     string `json:"agent_id"`
			Cases       []struct {
				ID        string          `json:"id"`
				Name      string          `json:"name"`
				Task      string          `json:"task"`
				Assertion json.RawMessage `json:"assertion"`
			} `json:"cases"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		tx, err := db.BeginTx(r.Context(), nil)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		res, err := tx.ExecContext(r.Context(), `UPDATE eval_suites SET name=?, description=?, agent_id=?, updated_at=? WHERE id=?`, req.Name, req.Description, req.AgentID, now, suiteID)
		if err != nil {
			_ = tx.Rollback()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			_ = tx.Rollback()
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "suite not found"})
			return
		}
		_, _ = tx.ExecContext(r.Context(), `DELETE FROM eval_cases WHERE suite_id=?`, suiteID)
		for idx, c := range req.Cases {
			if strings.TrimSpace(c.Name) == "" || strings.TrimSpace(c.Task) == "" {
				continue
			}
			assertion := c.Assertion
			if len(assertion) == 0 {
				assertion = json.RawMessage(`{}`)
			}
			caseID := c.ID
			if caseID == "" {
				caseID = uuid.NewString()
			}
			if _, err := tx.ExecContext(r.Context(), `
				INSERT INTO eval_cases(id,suite_id,name,task,assertion_json,position,created_at,updated_at)
				VALUES(?,?,?,?,?,?,?,?)
			`, caseID, suiteID, c.Name, c.Task, string(assertion), idx, now, now); err != nil {
				_ = tx.Rollback()
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
		}
		if err := tx.Commit(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": suiteID})
	}
}

func queueEvalRunHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		suiteID := chi.URLParam(r, "id")
		var req struct {
			Provider string `json:"provider"`
			Model    string `json:"model"`
			MaxSteps int    `json:"max_steps"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if req.MaxSteps <= 0 {
			req.MaxSteps = 30
		}
		var suiteCount int
		if err := db.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM eval_suites WHERE id=?`, suiteID).Scan(&suiteCount); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if suiteCount == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "suite not found"})
			return
		}
		evalRunID := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_, err := db.ExecContext(r.Context(), `
			INSERT INTO eval_runs(id,suite_id,status,provider,model,max_steps,created_at,summary_json,error)
			VALUES(?,?,?,?,?,?,?,?,?)
		`, evalRunID, suiteID, "queued", req.Provider, req.Model, req.MaxSteps, now, "{}", "")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": evalRunID, "status": "queued"})
	}
}

func listEvalRunsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, fetchRows(r.Context(), db, `
			SELECT er.id,er.suite_id,s.name AS suite_name,er.status,er.provider,er.model,er.max_steps,er.total_cases,er.passed_cases,er.failed_cases,er.created_at,er.started_at,er.completed_at,er.summary_json,er.error
			FROM eval_runs er
			JOIN eval_suites s ON s.id=er.suite_id
			ORDER BY er.created_at DESC
		`))
	}
}

func getEvalRunHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		evalRunID := chi.URLParam(r, "id")
		var count int
		if err := db.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM eval_runs WHERE id=?`, evalRunID).Scan(&count); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if count == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "eval run not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"run":   dbRow(r.Context(), db, `SELECT id,suite_id,status,provider,model,max_steps,total_cases,passed_cases,failed_cases,created_at,started_at,completed_at,summary_json,error FROM eval_runs WHERE id=?`, evalRunID),
			"cases": fetchRows(r.Context(), db, `SELECT id,case_id,run_id,status,score,latency_ms,input_tokens,output_tokens,result_excerpt,checks_json,error,created_at,completed_at FROM eval_case_runs WHERE eval_run_id=? ORDER BY created_at ASC`, evalRunID),
		})
	}
}

func getEvalRegressionHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		suiteID := chi.URLParam(r, "id")
		rows := fetchRows(r.Context(), db, `SELECT id,created_at,summary_json FROM eval_runs WHERE suite_id=? AND status='completed' ORDER BY created_at DESC LIMIT 2`, suiteID)
		if len(rows) < 2 {
			writeJSON(w, http.StatusOK, map[string]any{"ready": false, "message": "need at least two completed eval runs"})
			return
		}
		latestID, _ := rows[0]["id"].(string)
		prevID, _ := rows[1]["id"].(string)
		latestCases := fetchRows(r.Context(), db, `SELECT case_id,status,score,latency_ms,input_tokens,output_tokens FROM eval_case_runs WHERE eval_run_id=?`, latestID)
		prevCases := fetchRows(r.Context(), db, `SELECT case_id,status,score,latency_ms,input_tokens,output_tokens FROM eval_case_runs WHERE eval_run_id=?`, prevID)
		prevByCase := map[string]map[string]any{}
		for _, c := range prevCases {
			if id, ok := c["case_id"].(string); ok {
				prevByCase[id] = c
			}
		}
		deltas := make([]map[string]any, 0, len(latestCases))
		for _, curr := range latestCases {
			caseID, _ := curr["case_id"].(string)
			prev := prevByCase[caseID]
			deltas = append(deltas, map[string]any{
				"case_id":            caseID,
				"latest_status":      curr["status"],
				"previous_status":    prev["status"],
				"score_delta":        numberValue(curr["score"]) - numberValue(prev["score"]),
				"latency_delta_ms":   int(numberValue(curr["latency_ms"]) - numberValue(prev["latency_ms"])),
				"input_token_delta":  int(numberValue(curr["input_tokens"]) - numberValue(prev["input_tokens"])),
				"output_token_delta": int(numberValue(curr["output_tokens"]) - numberValue(prev["output_tokens"])),
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ready":                true,
			"latest_eval_run_id":   latestID,
			"previous_eval_run_id": prevID,
			"deltas":               deltas,
		})
	}
}

func dbRow(ctx context.Context, db *sql.DB, query string, args ...any) map[string]any {
	rows := fetchRows(ctx, db, query, args...)
	if len(rows) == 0 {
		return map[string]any{}
	}
	return rows[0]
}

func numberValue(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int64:
		return float64(n)
	case int:
		return float64(n)
	case string:
		var out float64
		_, _ = fmt.Sscanf(n, "%f", &out)
		return out
	default:
		return 0
	}
}

func fetchRows(ctx context.Context, db *sql.DB, query string, args ...any) []map[string]any {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return []map[string]any{{"error": err.Error()}}
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	out := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			continue
		}
		row := map[string]any{}
		for i, c := range cols {
			switch v := values[i].(type) {
			case []byte:
				row[c] = string(v)
			default:
				row[c] = v
			}
		}
		out = append(out, row)
	}
	return out
}

func nextEventSeq(db *sql.DB, runID string) int {
	var max sql.NullInt64
	_ = db.QueryRow(`SELECT COALESCE(MAX(seq),0) FROM events WHERE run_id=?`, runID).Scan(&max)
	return int(max.Int64) + 1
}

func parseTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func copyDirectory(source, target string) error {
	return filepath.WalkDir(source, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		dstPath := filepath.Join(target, rel)
		if d.IsDir() {
			return os.MkdirAll(dstPath, 0o755)
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		srcFile, err := os.Open(path)
		if err != nil {
			return err
		}
		defer srcFile.Close()
		if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
			return err
		}
		dstFile, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm())
		if err != nil {
			return err
		}
		defer dstFile.Close()
		_, err = io.Copy(dstFile, srcFile)
		return err
	})
}
