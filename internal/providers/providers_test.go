package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAIClientToolCallParsing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"","tool_calls":[{"id":"call_1","function":{"name":"shell_exec","arguments":"{\"command\":\"ls\"}"}}]}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}`))
	}))
	defer srv.Close()

	client := &OpenAIClient{APIKey: "x", BaseURL: srv.URL}
	res, err := client.Complete(context.Background(), CompletionRequest{Model: "gpt-4.1-mini", Messages: []Message{{Role: "user", Content: "list files"}}, Tools: []Tool{{Name: "shell.exec", Description: "exec", InputSchema: []byte(`{"type":"object"}`)}}})
	if err != nil {
		t.Fatalf("Complete failed: %v", err)
	}
	if len(res.ToolCalls) != 1 || res.ToolCalls[0].Name != "shell.exec" {
		t.Fatalf("unexpected tool calls: %+v", res.ToolCalls)
	}
	var args map[string]any
	if err := json.Unmarshal(res.ToolCalls[0].Arguments, &args); err != nil {
		t.Fatalf("tool args should be JSON object: %v", err)
	}
	if args["command"] != "ls" {
		t.Fatalf("unexpected arguments: %+v", args)
	}
}

func TestAnthropicClientToolUseParsing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"tool_use","id":"toolu_1","name":"file.read","input":{"path":"README.md"}}],"usage":{"input_tokens":8,"output_tokens":4}}`))
	}))
	defer srv.Close()

	client := &AnthropicClient{APIKey: "x", BaseURL: srv.URL}
	res, err := client.Complete(context.Background(), CompletionRequest{Model: "claude-sonnet-4-5", Messages: []Message{{Role: "user", Content: "read file"}}, Tools: []Tool{{Name: "file.read", Description: "read", InputSchema: []byte(`{"type":"object"}`)}}})
	if err != nil {
		t.Fatalf("Complete failed: %v", err)
	}
	if len(res.ToolCalls) != 1 || res.ToolCalls[0].Name != "file.read" {
		t.Fatalf("unexpected tool calls: %+v", res.ToolCalls)
	}
}
