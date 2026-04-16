package api

import "testing"

func TestValidateOutputContractDefinition(t *testing.T) {
	tests := []struct {
		name    string
		typ     string
		payload string
		wantErr bool
	}{
		{name: "none", typ: "none", payload: "", wantErr: false},
		{name: "regex valid", typ: "regex", payload: "^ok$", wantErr: false},
		{name: "regex invalid", typ: "regex", payload: "(", wantErr: true},
		{name: "schema valid", typ: "json_schema", payload: `{"type":"object","required":["answer"]}`, wantErr: false},
		{name: "schema invalid json", typ: "json_schema", payload: `{`, wantErr: true},
		{name: "unsupported", typ: "xml", payload: "", wantErr: true},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			err := validateOutputContractDefinition(tc.typ, tc.payload)
			if tc.wantErr && err == nil {
				t.Fatalf("expected error")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
