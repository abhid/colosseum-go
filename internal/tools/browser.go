package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

type BrowserRuntime struct {
	Mode     string
	Image    string
	Fallback bool

	mu       sync.Mutex
	sessions map[string]*browserSession
}

type browserSession struct {
	RunID      string
	CurrentURL string
	LastHTML   string
	LastTitle  string
	Backend    string
}

type browserActionResult struct {
	URL        string `json:"url"`
	Title      string `json:"title"`
	HTML       string `json:"html"`
	Screenshot string `json:"screenshot"`
	Error      string `json:"error"`
}

func (b *BrowserRuntime) getOrCreateSession(runID string) *browserSession {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.sessions == nil {
		b.sessions = map[string]*browserSession{}
	}
	s, ok := b.sessions[runID]
	if ok {
		return s
	}
	s = &browserSession{RunID: runID}
	b.sessions[runID] = s
	return s
}

func (b *BrowserRuntime) closeSession(runID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.sessions == nil {
		return
	}
	delete(b.sessions, runID)
}

func (e *Executor) browserOpen(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(req.URL) == "" {
		return Result{}, fmt.Errorf("url required")
	}
	rt := e.ensureBrowserRuntime()
	session := rt.getOrCreateSession(runCtx.RunID)
	out, backend, err := e.runBrowserScript(ctx, runCtx, browserScriptParams{
		URL:      req.URL,
		DoOpen:   true,
		DoWaitMS: 0,
	})
	if err != nil {
		return Result{}, err
	}
	session.CurrentURL = out.URL
	session.LastHTML = out.HTML
	session.LastTitle = out.Title
	session.Backend = backend
	return Result{Output: map[string]any{
		"ok":      true,
		"url":     out.URL,
		"title":   out.Title,
		"backend": backend,
	}}, nil
}

func (e *Executor) browserSnapshot(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Screenshot bool `json:"screenshot"`
	}
	_ = json.Unmarshal(input, &req)
	rt := e.ensureBrowserRuntime()
	session := rt.getOrCreateSession(runCtx.RunID)
	if strings.TrimSpace(session.CurrentURL) == "" {
		return Result{}, fmt.Errorf("browser session has no open page; call browser.open first")
	}
	out, backend, err := e.runBrowserScript(ctx, runCtx, browserScriptParams{
		URL:            session.CurrentURL,
		TakeScreenshot: req.Screenshot,
	})
	if err != nil {
		return Result{}, err
	}
	session.CurrentURL = out.URL
	session.LastHTML = out.HTML
	session.LastTitle = out.Title
	session.Backend = backend
	res := Result{Output: map[string]any{
		"ok":      true,
		"url":     out.URL,
		"title":   out.Title,
		"html":    out.HTML,
		"backend": backend,
	}}
	if out.Screenshot != "" {
		_ = e.insertArtifactRecord(runCtx, "browser_screenshot", out.Screenshot, "image/png", 0)
		res.Artifacts = []string{out.Screenshot}
	}
	return res, nil
}

func (e *Executor) browserAction(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Action   string `json:"action"`
		Selector string `json:"selector"`
		Text     string `json:"text"`
		Key      string `json:"key"`
		Value    string `json:"value"`
		DeltaY   int    `json:"delta_y"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	action := strings.TrimSpace(req.Action)
	if action == "" {
		return Result{}, fmt.Errorf("action required")
	}
	rt := e.ensureBrowserRuntime()
	session := rt.getOrCreateSession(runCtx.RunID)
	if strings.TrimSpace(session.CurrentURL) == "" {
		return Result{}, fmt.Errorf("browser session has no open page; call browser.open first")
	}
	out, backend, err := e.runBrowserScript(ctx, runCtx, browserScriptParams{
		URL:      session.CurrentURL,
		Action:   action,
		Selector: req.Selector,
		Text:     req.Text,
		Key:      req.Key,
		Value:    req.Value,
		DeltaY:   req.DeltaY,
	})
	if err != nil {
		return Result{}, err
	}
	session.CurrentURL = out.URL
	session.LastHTML = out.HTML
	session.LastTitle = out.Title
	session.Backend = backend
	return Result{Output: map[string]any{
		"ok":      true,
		"url":     out.URL,
		"title":   out.Title,
		"backend": backend,
	}}, nil
}

func (e *Executor) browserWait(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Milliseconds int `json:"milliseconds"`
	}
	_ = json.Unmarshal(input, &req)
	if req.Milliseconds <= 0 {
		req.Milliseconds = 1000
	}
	if req.Milliseconds > 30000 {
		req.Milliseconds = 30000
	}
	rt := e.ensureBrowserRuntime()
	session := rt.getOrCreateSession(runCtx.RunID)
	if strings.TrimSpace(session.CurrentURL) == "" {
		return Result{}, fmt.Errorf("browser session has no open page; call browser.open first")
	}
	out, backend, err := e.runBrowserScript(ctx, runCtx, browserScriptParams{
		URL:      session.CurrentURL,
		DoWaitMS: req.Milliseconds,
	})
	if err != nil {
		return Result{}, err
	}
	session.CurrentURL = out.URL
	session.LastHTML = out.HTML
	session.LastTitle = out.Title
	session.Backend = backend
	return Result{Output: map[string]any{
		"ok":      true,
		"url":     out.URL,
		"title":   out.Title,
		"wait_ms": req.Milliseconds,
		"backend": backend,
	}}, nil
}

func (e *Executor) browserScreenshot(ctx context.Context, runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		FullPage *bool `json:"full_page"`
	}
	_ = json.Unmarshal(input, &req)
	fullPage := true
	if req.FullPage != nil {
		fullPage = *req.FullPage
	}
	rt := e.ensureBrowserRuntime()
	session := rt.getOrCreateSession(runCtx.RunID)
	if strings.TrimSpace(session.CurrentURL) == "" {
		return Result{}, fmt.Errorf("browser session has no open page; call browser.open first")
	}
	out, backend, err := e.runBrowserScript(ctx, runCtx, browserScriptParams{
		URL:            session.CurrentURL,
		TakeScreenshot: true,
		FullPage:       fullPage,
	})
	if err != nil {
		return Result{}, err
	}
	session.CurrentURL = out.URL
	session.LastTitle = out.Title
	session.Backend = backend
	if out.Screenshot == "" {
		return Result{}, fmt.Errorf("screenshot capture returned no file")
	}
	var size int64
	if info, statErr := os.Stat(out.Screenshot); statErr == nil {
		size = info.Size()
	}
	_ = e.insertArtifactRecord(runCtx, "browser_screenshot", out.Screenshot, "image/png", size)
	var artifactID string
	if e.DB != nil {
		_ = e.DB.QueryRowContext(ctx,
			`SELECT id FROM artifacts WHERE run_id=? AND path=? ORDER BY created_at DESC LIMIT 1`,
			runCtx.RunID, out.Screenshot).Scan(&artifactID)
	}
	return Result{
		Output: map[string]any{
			"ok":              true,
			"url":             out.URL,
			"title":           out.Title,
			"screenshot_path": out.Screenshot,
			"artifact_id":     artifactID,
			"size_bytes":      size,
			"backend":         backend,
		},
		Artifacts: []string{out.Screenshot},
	}, nil
}

func (e *Executor) browserClose(ctx context.Context, runCtx Context) (Result, error) {
	_ = ctx
	rt := e.ensureBrowserRuntime()
	rt.closeSession(runCtx.RunID)
	return Result{Output: map[string]any{"ok": true, "closed": true}}, nil
}

func (e *Executor) ensureBrowserRuntime() *BrowserRuntime {
	if e.Browser == nil {
		e.Browser = &BrowserRuntime{
			Mode:     "docker",
			Image:    "mcr.microsoft.com/playwright:v1.59.1-jammy",
			Fallback: true,
		}
	}
	if e.Browser.Mode == "" {
		e.Browser.Mode = "docker"
	}
	if e.Browser.Image == "" {
		e.Browser.Image = "mcr.microsoft.com/playwright:v1.59.1-jammy"
	}
	return e.Browser
}

type browserScriptParams struct {
	URL            string `json:"url"`
	DoOpen         bool   `json:"do_open"`
	TakeScreenshot bool   `json:"take_screenshot"`
	FullPage       bool   `json:"full_page"`
	Action         string `json:"action"`
	Selector       string `json:"selector"`
	Text           string `json:"text"`
	Key            string `json:"key"`
	Value          string `json:"value"`
	DeltaY         int    `json:"delta_y"`
	DoWaitMS       int    `json:"wait_ms"`
}

func (e *Executor) runBrowserScript(ctx context.Context, runCtx Context, params browserScriptParams) (browserActionResult, string, error) {
	rt := e.ensureBrowserRuntime()
	if rt.Mode == "local" {
		res, err := e.runBrowserScriptLocal(ctx, runCtx, params)
		return res, "local", err
	}
	if err := validatePlaywrightVersionMatch(rt.Image, resolvePlaywrightVersion()); err != nil {
		return browserActionResult{}, "docker", err
	}
	res, err := e.runBrowserScriptDocker(ctx, runCtx, params)
	if err == nil {
		return res, "docker", nil
	}
	if !rt.Fallback {
		return browserActionResult{}, "docker", err
	}
	localRes, localErr := e.runBrowserScriptLocal(ctx, runCtx, params)
	if localErr != nil {
		return browserActionResult{}, "local", fmt.Errorf("docker failed: %v; local fallback failed: %v", err, localErr)
	}
	return localRes, "local", nil
}

func (e *Executor) runBrowserScriptDocker(ctx context.Context, runCtx Context, params browserScriptParams) (browserActionResult, error) {
	sessionDir := filepath.Join(e.ArtifactsDir, runCtx.RunID, "browser-session")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return browserActionResult{}, err
	}
	absWorkspace, err := filepath.Abs(runCtx.Workspace)
	if err != nil {
		return browserActionResult{}, err
	}
	absSessionDir, err := filepath.Abs(sessionDir)
	if err != nil {
		return browserActionResult{}, err
	}
	payload, _ := json.Marshal(params)
	script := browserNodeScript()
	args := []string{
		"run", "--rm",
		"-v", fmt.Sprintf("%s:/workspace", absWorkspace),
		"-v", fmt.Sprintf("%s:/session", absSessionDir),
		"-w", "/workspace",
		"-e", "BROWSER_TOOL_INPUT=" + string(payload),
	}
	for key, value := range runCtx.EnvVars {
		k := strings.TrimSpace(key)
		if !isValidEnvName(k) {
			continue
		}
		args = append(args, "-e", k+"="+value)
	}
	if nodePathHost := resolvePlaywrightNodePath(); nodePathHost != "" {
		if absNodePath, err := filepath.Abs(nodePathHost); err == nil {
			args = append(args,
				"-v", fmt.Sprintf("%s:/opt/colosseum-node-modules:ro", absNodePath),
				"-e", "NODE_PATH=/opt/colosseum-node-modules",
			)
		}
	}
	args = append(args,
		e.ensureBrowserRuntime().Image,
		"node", "-e", script,
	)
	cmd := exec.CommandContext(ctx, "docker", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return browserActionResult{}, fmt.Errorf("docker browser exec failed: %s", string(out))
	}
	res, err := parseBrowserScriptOutput(out)
	if err != nil {
		return browserActionResult{}, err
	}
	res.Screenshot = rewriteDockerSessionPath(res.Screenshot, absSessionDir)
	return res, nil
}

func (e *Executor) runBrowserScriptLocal(ctx context.Context, runCtx Context, params browserScriptParams) (browserActionResult, error) {
	sessionDir := filepath.Join(e.ArtifactsDir, runCtx.RunID, "browser-session")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return browserActionResult{}, err
	}
	payload, _ := json.Marshal(params)
	script := browserNodeScript()
	cmd := exec.CommandContext(ctx, "node", "-e", script)
	cmd.Dir = runCtx.Workspace
	env := mergeEnv(sanitizedBaseEnv(), runCtx.EnvVars)
	env = append(env, "BROWSER_TOOL_INPUT="+string(payload), "BROWSER_TOOL_SESSION_DIR="+sessionDir)
	if nodePath := resolvePlaywrightNodePath(); nodePath != "" {
		existing := os.Getenv("NODE_PATH")
		if existing != "" {
			nodePath = nodePath + string(os.PathListSeparator) + existing
		}
		env = append(env, "NODE_PATH="+nodePath)
	}
	cmd.Env = env
	out, err := cmd.CombinedOutput()
	if err != nil {
		return browserActionResult{}, fmt.Errorf("local browser exec failed: %s", string(out))
	}
	return parseBrowserScriptOutput(out)
}

func resolvePlaywrightNodePath() string {
	if v := strings.TrimSpace(os.Getenv("COLOSSEUM_PLAYWRIGHT_NODE_PATH")); v != "" {
		return v
	}
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	candidates := []string{
		filepath.Join(cwd, "ui", "node_modules"),
		filepath.Join(cwd, "node_modules"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(filepath.Join(candidate, "playwright")); err == nil {
			return candidate
		}
		if _, err := os.Stat(filepath.Join(candidate, "playwright-core")); err == nil {
			return candidate
		}
	}
	return ""
}

func resolvePlaywrightVersion() string {
	nodePath := resolvePlaywrightNodePath()
	if nodePath == "" {
		return ""
	}
	candidates := []string{
		filepath.Join(nodePath, "playwright", "package.json"),
		filepath.Join(nodePath, "playwright-core", "package.json"),
	}
	for _, pkgPath := range candidates {
		raw, err := os.ReadFile(pkgPath)
		if err != nil {
			continue
		}
		var payload struct {
			Version string `json:"version"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			continue
		}
		if v := strings.TrimSpace(payload.Version); v != "" {
			return v
		}
	}
	return ""
}

func validatePlaywrightVersionMatch(image, localVersion string) error {
	localVersion = strings.TrimSpace(localVersion)
	if localVersion == "" {
		return nil
	}
	imageVersion := parsePlaywrightImageVersion(image)
	if imageVersion == "" {
		return nil
	}
	if imageVersion == localVersion {
		return nil
	}
	return fmt.Errorf(
		"playwright version mismatch: docker image %q uses %s but local package is %s; set COLOSSEUM_BROWSER_IMAGE to mcr.microsoft.com/playwright:v%s-jammy (or -noble)",
		image,
		imageVersion,
		localVersion,
		localVersion,
	)
}

func parsePlaywrightImageVersion(image string) string {
	trimmed := strings.TrimSpace(image)
	if trimmed == "" {
		return ""
	}
	idx := strings.Index(trimmed, ":v")
	if idx == -1 {
		return ""
	}
	tag := trimmed[idx+2:]
	if cut := strings.Index(tag, "-"); cut >= 0 {
		tag = tag[:cut]
	}
	parts := strings.Split(tag, ".")
	if len(parts) != 3 {
		return ""
	}
	for _, part := range parts {
		if part == "" {
			return ""
		}
		for _, ch := range part {
			if ch < '0' || ch > '9' {
				return ""
			}
		}
	}
	return tag
}

func rewriteDockerSessionPath(pathValue, absSessionDir string) string {
	pathValue = strings.TrimSpace(pathValue)
	if pathValue == "" {
		return ""
	}
	const dockerSessionPrefix = "/session/"
	if !strings.HasPrefix(pathValue, dockerSessionPrefix) {
		return pathValue
	}
	rel := strings.TrimPrefix(pathValue, dockerSessionPrefix)
	rel = filepath.Clean(string(filepath.Separator) + rel)
	if rel == "." || rel == string(filepath.Separator) || rel == "" {
		return pathValue
	}
	rel = strings.TrimPrefix(rel, string(filepath.Separator))
	return filepath.Join(absSessionDir, rel)
}

func parseBrowserScriptOutput(out []byte) (browserActionResult, error) {
	content := strings.TrimSpace(string(out))
	if content == "" {
		return browserActionResult{}, fmt.Errorf("empty browser output")
	}
	lines := strings.Split(content, "\n")
	var lastErr error
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		var res browserActionResult
		if err := json.Unmarshal([]byte(line), &res); err != nil {
			lastErr = err
			continue
		}
		if strings.TrimSpace(res.Error) != "" {
			return browserActionResult{}, errors.New(res.Error)
		}
		return res, nil
	}
	if lastErr != nil {
		return browserActionResult{}, fmt.Errorf("invalid browser output: %w", lastErr)
	}
	return browserActionResult{}, fmt.Errorf("invalid browser output: %s", content)
}

func browserNodeScript() string {
	return `
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sessionDir = process.env.BROWSER_TOOL_SESSION_DIR || '/session';
const input = JSON.parse(process.env.BROWSER_TOOL_INPUT || '{}');
const storagePath = path.join(sessionDir, 'storage-state.json');
const run = async () => {
  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch {
    chromium = require('playwright-core').chromium;
  }
  const browser = await chromium.launch({ headless: true });
  const context = fs.existsSync(storagePath)
    ? await browser.newContext({ storageState: storagePath })
    : await browser.newContext();
  const page = await context.newPage();
  if (input.url) {
    await page.goto(input.url, { waitUntil: 'domcontentloaded' });
  }
  if (input.do_open) {
    await page.waitForLoadState('domcontentloaded');
  }
  if (input.action === 'click' && input.selector) await page.click(input.selector);
  if (input.action === 'type' && input.selector) await page.fill(input.selector, input.text || '');
  if (input.action === 'press' && input.key) await page.keyboard.press(input.key);
  if (input.action === 'select' && input.selector) await page.selectOption(input.selector, input.value || '');
  if (input.action === 'scroll') await page.mouse.wheel(0, Number(input.delta_y || 400));
  if (input.wait_ms && Number(input.wait_ms) > 0) await page.waitForTimeout(Number(input.wait_ms));
  const html = await page.content();
  const title = await page.title();
  const url = page.url();
  let screenshot = '';
  if (input.take_screenshot) {
    const screenshotName = 'screenshot-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.png';
    const screenshotPath = path.join(sessionDir, screenshotName);
    await page.screenshot({ path: screenshotPath, fullPage: input.full_page !== false });
    screenshot = screenshotPath;
  }
  await context.storageState({ path: storagePath });
  await browser.close();
  console.log(JSON.stringify({ url, title, html: html.slice(0, 250000), screenshot, error: '' }));
};
run().catch((err) => {
  console.log(JSON.stringify({ error: err && err.message ? err.message : String(err) }));
  process.exit(1);
});
`
}
