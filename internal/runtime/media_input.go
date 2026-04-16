package runtime

import (
	"encoding/base64"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/adevireddy/colosseum/internal/providers"
)

type mediaInputPolicy struct {
	ProviderName   string
	Model          string
	MaxInlineBytes int
	MaxParts       int
	// MIME types that can be sent directly as image_url multimodal parts.
	DirectImageMIMEs map[string]bool
}

func buildMediaInputPolicy(providerName, model string) mediaInputPolicy {
	// Keep policy table explicit and centralized for maintainability.
	policy := mediaInputPolicy{
		ProviderName:   strings.ToLower(strings.TrimSpace(providerName)),
		Model:          strings.TrimSpace(model),
		MaxInlineBytes: 3 * 1024 * 1024,
		MaxParts:       4, // text + up to three media parts
		DirectImageMIMEs: map[string]bool{
			"image/png":  true,
			"image/jpeg": true,
			"image/jpg":  true,
			"image/webp": true,
			"image/gif":  true,
		},
	}
	return policy
}

func buildAttachmentContentParts(policy mediaInputPolicy, artifactID, path, mime string) []providers.ContentPart {
	artifactID = strings.TrimSpace(artifactID)
	mimeLower := strings.ToLower(strings.TrimSpace(mime))
	if artifactID == "" || !strings.HasPrefix(mimeLower, "image/") {
		return nil
	}
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return nil
	}
	if len(b) > policy.MaxInlineBytes {
		// Skip very large inline payloads.
		return nil
	}
	if policy.DirectImageMIMEs[mimeLower] {
		encoded := base64.StdEncoding.EncodeToString(b)
		dataURL := fmt.Sprintf("data:%s;base64,%s", strings.TrimSpace(mime), encoded)
		return []providers.ContentPart{{Type: "image_url", URL: dataURL}}
	}
	if mimeLower == "image/svg+xml" {
		summary := summarizeSVGContent(b)
		return []providers.ContentPart{{
			Type: "text",
			Text: fmt.Sprintf("Attached SVG image (%s). Extracted SVG text/metadata: %s", artifactID, summary),
		}}
	}
	// Unknown image MIME fallback: provide metadata to avoid silent drops.
	return []providers.ContentPart{{
		Type: "text",
		Text: fmt.Sprintf("Attached image (%s) with MIME type %s could not be passed as direct multimodal input.", artifactID, mimeLower),
	}}
}

func summarizeSVGContent(raw []byte) string {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return "empty SVG"
	}
	// Collect title/desc/text payloads when present.
	blockPattern := regexp.MustCompile(`(?is)<(title|desc|text)[^>]*>(.*?)</(title|desc|text)>`)
	matches := blockPattern.FindAllStringSubmatch(text, 8)
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if len(m) < 3 {
			continue
		}
		value := stripXMLTags(m[2])
		value = strings.Join(strings.Fields(value), " ")
		if value != "" {
			out = append(out, value)
		}
	}
	if len(out) > 0 {
		return truncateForEvent(strings.Join(out, " | "), 500)
	}
	// Fallback to compacted opening portion for shape/logo hints.
	compact := strings.Join(strings.Fields(text), " ")
	return truncateForEvent(compact, 500)
}

func stripXMLTags(value string) string {
	tagPattern := regexp.MustCompile(`(?is)<[^>]+>`)
	return tagPattern.ReplaceAllString(value, "")
}
