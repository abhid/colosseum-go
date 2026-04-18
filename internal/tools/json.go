package tools

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

func (e *Executor) jsonParse(input json.RawMessage) (Result, error) {
	var req struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	var parsed any
	if err := json.Unmarshal([]byte(req.Text), &parsed); err != nil {
		return Result{}, err
	}
	return Result{Output: map[string]any{"value": parsed}}, nil
}

func (e *Executor) jsonQuery(input json.RawMessage) (Result, error) {
	var req struct {
		Input any    `json:"input"`
		Path  string `json:"path"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	val := req.Input
	if s, ok := req.Input.(string); ok {
		var parsed any
		if err := json.Unmarshal([]byte(s), &parsed); err == nil {
			val = parsed
		}
	}
	pathExpr := strings.TrimSpace(req.Path)
	if pathExpr == "" || pathExpr == "." {
		return Result{Output: map[string]any{"value": val}}, nil
	}
	current := val
	parts := strings.Split(pathExpr, ".")
	for _, raw := range parts {
		part := strings.TrimSpace(raw)
		if part == "" {
			continue
		}
		switch node := current.(type) {
		case map[string]any:
			next, ok := node[part]
			if !ok {
				return Result{}, fmt.Errorf("path not found: %s", part)
			}
			current = next
		case []any:
			i, err := strconv.Atoi(part)
			if err != nil || i < 0 || i >= len(node) {
				return Result{}, fmt.Errorf("invalid array index: %s", part)
			}
			current = node[i]
		default:
			return Result{}, fmt.Errorf("cannot traverse into %T", current)
		}
	}
	return Result{Output: map[string]any{"value": current}}, nil
}
