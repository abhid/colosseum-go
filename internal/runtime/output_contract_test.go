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

func TestValidateProvenanceOutputContract(t *testing.T) {
	tests := []struct {
		name   string
		output string
		media  mediaEvidence
		wantOK bool
	}{
		{
			name:   "screenshot claim fails without image artifact",
			output: "Here's a screenshot of Yahoo.",
			media:  mediaEvidence{Images: 0},
			wantOK: false,
		},
		{
			name:   "screenshot claim still fails without link even with image artifact",
			output: "Here's a screenshot of Yahoo.",
			media:  mediaEvidence{Images: 1},
			wantOK: false,
		},
		{
			name:   "screenshot claim passes with image artifact and link",
			output: "Screenshot attached below.\n\n[Screenshot](/api/runs/run-id/artifacts/artifact-id/content)",
			media:  mediaEvidence{Images: 1},
			wantOK: true,
		},
		{
			name:   "non-media response passes without artifacts",
			output: "Completed the task.",
			media:  mediaEvidence{},
			wantOK: true,
		},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			ok, _ := validateProvenanceOutputContract(tc.output, tc.media)
			if ok != tc.wantOK {
				t.Fatalf("expected ok=%v, got %v", tc.wantOK, ok)
			}
		})
	}
}
