package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/adevireddy/colosseum/internal/providers"
)

var (
	uuidPattern       = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`)
	artifactLinkExpr  = regexp.MustCompile(`(?i)/api/runs/[^/\s]+/artifacts/[^/\s]+/content`)
	artifactMetaExpr  = regexp.MustCompile(`(?i)\b(artifact|evidence)\s*:`)
	telemetryDumpExpr = regexp.MustCompile(`(?i)\b(input_tokens|output_tokens|duration_ms|step_id|run_id)\b`)
)

type dispatchMeta struct {
	Applied bool
	Reason  string
	Error   string
}

type dispatchEnvelope struct {
	UserResponseMarkdown string   `json:"user_response_markdown"`
	ArtifactLinks        []string `json:"artifact_links"`
	ComplianceNotes      string   `json:"compliance_notes"`
}

func (m *Manager) prepareChatAssistantText(
	ctx context.Context,
	provider providers.Client,
	model, runID, task, raw, provenanceSummary string,
	artifacts []complianceArtifact,
) (string, dispatchMeta) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw, dispatchMeta{Reason: "empty response"}
	}
	shouldDispatch, reason := shouldDispatchAssistantResponse(raw)
	if !shouldDispatch {
		out := ensureAttachmentReferences(runID, raw, raw, artifacts)
		return out, dispatchMeta{Reason: reason}
	}
	if provider == nil {
		fallback := ensureAttachmentReferences(runID, compactInternalArtifactNoise(raw), raw, artifacts)
		return fallback, dispatchMeta{Reason: "dispatcher provider unavailable"}
	}
	envelope, err := dispatchAssistantEnvelope(ctx, provider, model, task, raw, provenanceSummary, runID, artifacts)
	if err == nil {
		refined := strings.TrimSpace(envelope.UserResponseMarkdown)
		if refined == "" {
			refined = raw
		}
		refined = appendAllowedArtifactLinks(runID, refined, envelope.ArtifactLinks, artifacts)
		refined = ensureAttachmentReferences(runID, refined, raw, artifacts)
		return refined, dispatchMeta{Applied: true, Reason: reason}
	}
	// Deterministic fallback if model dispatch fails.
	fallback := ensureAttachmentReferences(runID, compactInternalArtifactNoise(raw), raw, artifacts)
	return fallback, dispatchMeta{Applied: true, Reason: reason, Error: errorString(err)}
}

func shouldDispatchAssistantResponse(text string) (bool, string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return false, "empty"
	}
	if len(uuidPattern.FindAllString(text, -1)) >= 2 {
		return true, "uuid_heavy"
	}
	if artifactLinkExpr.MatchString(text) {
		return true, "artifact_link_rewrite"
	}
	if artifactMetaExpr.MatchString(text) {
		return true, "artifact_metadata_dump"
	}
	if telemetryDumpExpr.MatchString(text) {
		return true, "telemetry_dump"
	}
	return false, "already_user_facing"
}

func dispatchAssistantEnvelope(
	ctx context.Context,
	provider providers.Client,
	model, task, raw, provenanceSummary, runID string,
	artifacts []complianceArtifact,
) (*dispatchEnvelope, error) {
	artifactCatalog := buildArtifactCatalog(runID, artifacts)
	dispatchCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	resp, err := provider.Complete(dispatchCtx, providers.CompletionRequest{
		Model: model,
		System: strings.TrimSpace(`
You are a response-dispatcher for an autonomous run UI.
Rewrite the assistant output to be user-facing, concise, useful, and compliant.

Rules:
- Ensure the final response directly satisfies the user ask; if something could not be completed, clearly explain what blocked it.
- Preserve facts and outcomes.
- Remove raw UUIDs, internal artifact IDs, and internal endpoint paths unless the user explicitly asked for those identifiers.
- If artifacts were produced and you mention attachments, include artifact links from the provided allowed catalog.
- Only use artifact links from the allowed catalog. Never invent links.
- Keep markdown formatting when useful.
- Do not invent outputs that are not present in the original text.
- Return ONLY JSON:
{
  "user_response_markdown": "string",
  "artifact_links": ["optional /api/runs/.../artifacts/.../content links from allowed catalog"],
  "compliance_notes": "short note"
}
`),
		Messages: []providers.Message{
			{
				Role: "user",
				Content: fmt.Sprintf(
					"User ask:\n%s\n\nOriginal answer:\n%s\n\nRun provenance summary:\n%s\n\nAllowed artifact catalog:\n%s",
					task,
					raw,
					provenanceSummary,
					artifactCatalog,
				),
			},
		},
		Tools:   []providers.Tool{},
		Timeout: 20 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	envelope := parseDispatchEnvelope(resp.Text)
	if envelope == nil {
		return nil, fmt.Errorf("dispatcher returned invalid envelope")
	}
	return envelope, nil
}

func compactInternalArtifactNoise(raw string) string {
	lines := strings.Split(raw, "\n")
	out := make([]string, 0, len(lines))
	removed := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(strings.TrimPrefix(line, "-"))
		if trimmed == "" {
			out = append(out, line)
			continue
		}
		lower := strings.ToLower(trimmed)
		if uuidPattern.MatchString(trimmed) && len(trimmed) <= 64 {
			removed = true
			continue
		}
		if strings.Contains(lower, "artifact:") || strings.Contains(lower, "evidence:") {
			removed = true
			continue
		}
		out = append(out, line)
	}
	cleaned := strings.TrimSpace(strings.Join(out, "\n"))
	if cleaned == "" {
		cleaned = "Completed successfully. Output artifacts are available in the run details."
	}
	if removed {
		cleaned += "\n\nArtifact details are available in the run details."
	}
	return cleaned
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func parseDispatchEnvelope(raw string) *dispatchEnvelope {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil
	}
	var direct dispatchEnvelope
	if err := json.Unmarshal([]byte(text), &direct); err == nil {
		return &direct
	}
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil
	}
	var embedded dispatchEnvelope
	if err := json.Unmarshal([]byte(text[start:end+1]), &embedded); err != nil {
		return nil
	}
	return &embedded
}

func buildArtifactCatalog(runID string, artifacts []complianceArtifact) string {
	if len(artifacts) == 0 {
		return "none"
	}
	lines := make([]string, 0, len(artifacts))
	for _, artifact := range artifacts {
		if strings.TrimSpace(artifact.ID) == "" {
			continue
		}
		lines = append(lines, fmt.Sprintf("- id=%s mime=%s link=/api/runs/%s/artifacts/%s/content", artifact.ID, artifact.MIME, runID, artifact.ID))
	}
	if len(lines) == 0 {
		return "none"
	}
	return strings.Join(lines, "\n")
}

func appendAllowedArtifactLinks(runID, text string, links []string, artifacts []complianceArtifact) string {
	text = strings.TrimSpace(text)
	if len(links) == 0 {
		return text
	}
	allowed := map[string]bool{}
	for _, artifact := range artifacts {
		id := strings.TrimSpace(artifact.ID)
		if id == "" {
			continue
		}
		allowed[fmt.Sprintf("/api/runs/%s/artifacts/%s/content", runID, id)] = true
	}
	if len(allowed) == 0 {
		return text
	}
	additions := make([]string, 0, len(links))
	for _, rawLink := range links {
		link := strings.TrimSpace(rawLink)
		if link == "" {
			continue
		}
		match := artifactContentURLPattern.FindString(link)
		if match == "" {
			continue
		}
		if !allowed[match] {
			continue
		}
		if strings.Contains(text, match) {
			continue
		}
		additions = append(additions, fmt.Sprintf("- [Attachment](%s)", match))
	}
	if len(additions) == 0 {
		return text
	}
	if text == "" {
		return strings.Join(additions, "\n")
	}
	return text + "\n\n" + strings.Join(additions, "\n")
}
