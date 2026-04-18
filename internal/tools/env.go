package tools

import (
	"encoding/json"
)

func (e *Executor) envInspect(runCtx Context, input json.RawMessage) (Result, error) {
	var req struct {
		Keys []string `json:"keys"`
	}
	if len(input) > 0 {
		_ = json.Unmarshal(input, &req)
	}
	out := make(map[string]string)
	if len(req.Keys) > 0 {
		for _, k := range req.Keys {
			if v, ok := runCtx.EnvVars[k]; ok {
				out[k] = v
			}
		}
	} else {
		for k, v := range runCtx.EnvVars {
			out[k] = v
		}
	}
	return Result{Output: map[string]any{
		"env":   out,
		"count": len(out),
	}}, nil
}
