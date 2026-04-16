package runtime

import "testing"

func TestValidateOutputContract(t *testing.T) {
	tests := []struct {
		name    string
		typ     string
		payload string
		output  string
		wantOK  bool
	}{
		{name: "none passes", typ: "none", payload: "", output: "anything", wantOK: true},
		{name: "regex passes", typ: "regex", payload: "^hello", output: "hello world", wantOK: true},
		{name: "regex fails", typ: "regex", payload: "^hello$", output: "nope", wantOK: false},
		{name: "json schema passes", typ: "json_schema", payload: `{"type":"object","required":["answer"],"properties":{"answer":{"type":"string"}}}`, output: `{"answer":"ok"}`, wantOK: true},
		{name: "json schema fails required", typ: "json_schema", payload: `{"type":"object","required":["answer"]}`, output: `{"other":"x"}`, wantOK: false},
		{name: "json schema invalid output", typ: "json_schema", payload: `{"type":"object"}`, output: `not-json`, wantOK: false},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			ok, _ := validateOutputContract(tc.typ, tc.payload, tc.output)
			if ok != tc.wantOK {
				t.Fatalf("expected ok=%v, got %v", tc.wantOK, ok)
			}
		})
	}
}
