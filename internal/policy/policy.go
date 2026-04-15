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

	return Decision{Allow: true}
}
