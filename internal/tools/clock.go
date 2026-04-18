package tools

import (
	"encoding/json"
	"time"
)

func (e *Executor) clockNow(_ json.RawMessage) (Result, error) {
	now := time.Now()
	utc := now.UTC()
	tzName, _ := now.Zone()
	return Result{Output: map[string]any{
		"unix":      now.Unix(),
		"unix_ms":   now.UnixMilli(),
		"iso_utc":   utc.Format(time.RFC3339Nano),
		"iso_local": now.Format(time.RFC3339Nano),
		"timezone":  tzName,
		"date":      utc.Format("2006-01-02"),
		"time":      utc.Format("15:04:05"),
		"weekday":   utc.Weekday().String(),
	}}, nil
}
