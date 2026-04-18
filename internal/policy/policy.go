package policy

import (
	"encoding/json"
	"regexp"
	"strings"
)

type Decision struct {
	Allow           bool   `json:"allow"`
	RequireApproval bool   `json:"require_approval"`
	Reason          string `json:"reason"`
}

var riskyPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bgit\s+push\b`),
	regexp.MustCompile(`(?i)\brm\s+-rf\s+/`),
	regexp.MustCompile(`(?i)\bcurl\s+https?://`),
	regexp.MustCompile(`(?i)\bwget\s+https?://`),
	regexp.MustCompile(`(?i)\bssh\s+`),
	regexp.MustCompile(`(?i)\bscp\s+`),
}

func EvaluateTool(toolName string, input json.RawMessage, allowed []string) Decision {
	if len(allowed) > 0 {
		ok := false
		for _, t := range allowed {
			if strings.TrimSpace(t) == toolName {
				ok = true
				break
			}
		}
		if !ok {
			return Decision{Allow: false, Reason: "tool denied by agent policy"}
		}
	}

	if toolName == "shell.exec" || toolName == "test.run" {
		var req struct {
			Command string `json:"command"`
		}
		_ = json.Unmarshal(input, &req)
		for _, pattern := range riskyPatterns {
			if pattern.MatchString(req.Command) {
				return Decision{Allow: true, RequireApproval: true, Reason: "risky command requires approval"}
			}
		}
	}

	if toolName == "web.fetch" || toolName == "http.request" {
		var req struct {
			URL string `json:"url"`
		}
		_ = json.Unmarshal(input, &req)
		if strings.Contains(req.URL, "169.254.169.254") || strings.HasPrefix(strings.ToLower(req.URL), "file://") {
			return Decision{Allow: false, Reason: "blocked url scheme/host"}
		}
		if strings.Contains(req.URL, "localhost") || strings.Contains(req.URL, "127.0.0.1") {
			return Decision{Allow: true, RequireApproval: true, Reason: "local network access requires approval"}
		}
	}

	if strings.HasPrefix(toolName, "browser.") {
		switch toolName {
		case "browser.open", "browser.action", "browser.snapshot", "browser.screenshot", "browser.wait", "browser.close":
		default:
			return Decision{Allow: false, Reason: "unsupported browser tool"}
		}
		if toolName == "browser.open" {
			var req struct {
				URL string `json:"url"`
			}
			_ = json.Unmarshal(input, &req)
			if strings.HasPrefix(strings.ToLower(req.URL), "file://") {
				return Decision{Allow: false, Reason: "file scheme blocked for browser"}
			}
			if strings.Contains(req.URL, "localhost") || strings.Contains(req.URL, "127.0.0.1") {
				return Decision{Allow: true, RequireApproval: true, Reason: "local browser target requires approval"}
			}
		}
	}

	return Decision{Allow: true}
}
