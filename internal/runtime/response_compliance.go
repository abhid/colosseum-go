package runtime

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type complianceArtifact struct {
	ID   string
	MIME string
}

type dispatchContext struct {
	ProvenanceSummary string
	Media             mediaEvidence
	Artifacts         []complianceArtifact
}

func (m *Manager) buildDispatchContext(ctx context.Context, runID string) (dispatchContext, error) {
	parts := make([]string, 0, 16)
	media := mediaEvidence{}
	artifacts := make([]complianceArtifact, 0, 12)

	rows, err := m.DB.QueryContext(ctx, `
		SELECT tool_name,status,error_message
		FROM tool_calls
		WHERE run_id=?
		ORDER BY started_at ASC
		LIMIT 16
	`, runID)
	if err != nil && err != sql.ErrNoRows {
		return dispatchContext{}, err
	}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var toolName, status, errMsg string
			if scanErr := rows.Scan(&toolName, &status, &errMsg); scanErr != nil {
				return dispatchContext{}, scanErr
			}
			line := fmt.Sprintf("tool: %s status: %s", strings.TrimSpace(toolName), strings.TrimSpace(status))
			if strings.TrimSpace(errMsg) != "" {
				line += " error: " + truncateForEvent(errMsg, 160)
			}
			parts = append(parts, line)
		}
	}

	artifactRows, err := m.DB.QueryContext(ctx, `
		SELECT id,kind,path,mime_type
		FROM artifacts
		WHERE run_id=?
		ORDER BY created_at DESC
		LIMIT 12
	`, runID)
	if err != nil && err != sql.ErrNoRows {
		return dispatchContext{}, err
	}
	if artifactRows != nil {
		defer artifactRows.Close()
		for artifactRows.Next() {
			var id, kind, path, mime string
			if scanErr := artifactRows.Scan(&id, &kind, &path, &mime); scanErr != nil {
				return dispatchContext{}, scanErr
			}
			lowerMIME := strings.ToLower(strings.TrimSpace(mime))
			artifacts = append(artifacts, complianceArtifact{ID: strings.TrimSpace(id), MIME: lowerMIME})
			switch {
			case strings.HasPrefix(lowerMIME, "image/"):
				media.Images++
			case strings.HasPrefix(lowerMIME, "video/"):
				media.Videos++
			case strings.HasPrefix(lowerMIME, "audio/"):
				media.Audios++
			}
			parts = append(parts, fmt.Sprintf("artifact: %s mime: %s path: %s", kind, mime, path))
		}
	}

	provenance := "no tool calls or artifacts recorded"
	if len(parts) > 0 {
		provenance = strings.Join(parts, "\n")
	}
	return dispatchContext{
		ProvenanceSummary: provenance,
		Media:             media,
		Artifacts:         artifacts,
	}, nil
}

func ensureAttachmentReferences(runID, text, claimSource string, artifacts []complianceArtifact) string {
	text = strings.TrimSpace(text)
	if text == "" || hasArtifactContentLink(text) {
		return text
	}
	source := strings.TrimSpace(claimSource)
	if source == "" {
		source = text
	}
	claim := parseMediaClaim(strings.ToLower(source))
	if !claim.ClaimsDelivery {
		return text
	}
	additions := make([]string, 0, 3)
	added := map[string]bool{}
	appendFor := func(kind, label string) {
		if added[kind] {
			return
		}
		for _, artifact := range artifacts {
			mime := strings.ToLower(strings.TrimSpace(artifact.MIME))
			match := false
			switch kind {
			case "image":
				match = strings.HasPrefix(mime, "image/")
			case "video":
				match = strings.HasPrefix(mime, "video/")
			case "audio":
				match = strings.HasPrefix(mime, "audio/")
			}
			if !match || artifact.ID == "" {
				continue
			}
			additions = append(additions, fmt.Sprintf("- [%s](/api/runs/%s/artifacts/%s/content)", label, runID, artifact.ID))
			added[kind] = true
			return
		}
	}
	if claim.MentionsImage {
		appendFor("image", "Screenshot")
	}
	if claim.MentionsVideo {
		appendFor("video", "Video")
	}
	if claim.MentionsAudio {
		appendFor("audio", "Audio")
	}
	if len(additions) == 0 {
		return text
	}
	return text + "\n\n" + strings.Join(additions, "\n")
}
