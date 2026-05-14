package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (e *Executor) webFetch(ctx context.Context, input json.RawMessage) (Result, error) {
	var req struct {
		URL           string `json:"url"`
		TimeoutSecond int    `json:"timeout_seconds"`
		MaxBytes      int64  `json:"max_bytes"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if req.URL == "" {
		return Result{}, fmt.Errorf("url required")
	}
	if err := validateOutboundToolURL(req.URL); err != nil {
		return Result{}, err
	}
	if req.TimeoutSecond <= 0 {
		req.TimeoutSecond = 15
	}
	if req.MaxBytes <= 0 {
		req.MaxBytes = 256 * 1024
	}
	client := outboundHTTPClient(req.TimeoutSecond)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, req.URL, nil)
	if err != nil {
		return Result{}, err
	}
	httpReq.Header.Set("User-Agent", "colosseum/1.0")
	resp, err := client.Do(httpReq)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	b, err := ioReadAllLimited(resp.Body, req.MaxBytes)
	if err != nil {
		return Result{}, err
	}
	content := string(b)
	return Result{Output: map[string]any{
		"url":          req.URL,
		"status":       resp.StatusCode,
		"content":      content,
		"content_len":  len(content),
		"content_type": resp.Header.Get("Content-Type"),
	}}, nil
}

func (e *Executor) httpRequest(ctx context.Context, input json.RawMessage) (Result, error) {
	var req struct {
		URL           string            `json:"url"`
		Method        string            `json:"method"`
		Headers       map[string]string `json:"headers"`
		Body          string            `json:"body"`
		JSON          any               `json:"json"`
		TimeoutSecond int               `json:"timeout_seconds"`
		MaxBytes      int64             `json:"max_bytes"`
	}
	if err := json.Unmarshal(input, &req); err != nil {
		return Result{}, err
	}
	if req.URL == "" {
		return Result{}, fmt.Errorf("url required")
	}
	if err := validateOutboundToolURL(req.URL); err != nil {
		return Result{}, err
	}
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = http.MethodGet
	}
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead, http.MethodOptions:
	default:
		return Result{}, fmt.Errorf("unsupported method: %s", method)
	}
	if req.TimeoutSecond <= 0 {
		req.TimeoutSecond = 30
	}
	if req.MaxBytes <= 0 {
		req.MaxBytes = 512 * 1024
	}

	var bodyReader io.Reader
	contentType := ""
	if req.JSON != nil {
		buf, err := json.Marshal(req.JSON)
		if err != nil {
			return Result{}, fmt.Errorf("encode json body: %w", err)
		}
		bodyReader = bytes.NewReader(buf)
		contentType = "application/json"
	} else if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}

	client := outboundHTTPClient(req.TimeoutSecond)
	httpReq, err := http.NewRequestWithContext(ctx, method, req.URL, bodyReader)
	if err != nil {
		return Result{}, err
	}
	httpReq.Header.Set("User-Agent", "colosseum/1.0")
	if contentType != "" {
		httpReq.Header.Set("Content-Type", contentType)
	}
	for k, v := range req.Headers {
		if strings.TrimSpace(k) == "" {
			continue
		}
		httpReq.Header.Set(k, v)
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	b, err := ioReadAllLimited(resp.Body, req.MaxBytes)
	if err != nil {
		return Result{}, err
	}
	respHeaders := make(map[string]string, len(resp.Header))
	for k, v := range resp.Header {
		if len(v) > 0 {
			respHeaders[k] = v[0]
		}
	}
	content := string(b)
	return Result{Output: map[string]any{
		"url":          req.URL,
		"method":       method,
		"status":       resp.StatusCode,
		"headers":      respHeaders,
		"content":      content,
		"content_len":  len(content),
		"content_type": resp.Header.Get("Content-Type"),
	}}, nil
}

func outboundHTTPClient(timeoutSeconds int) *http.Client {
	return &http.Client{
		Timeout: time.Duration(timeoutSeconds) * time.Second,
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			return validateOutboundToolURL(req.URL.String())
		},
	}
}

func validateOutboundToolURL(rawURL string) error {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Scheme == "" {
		return fmt.Errorf("invalid url")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("only http/https urls are allowed")
	}
	host := strings.Trim(strings.ToLower(u.Hostname()), "[]")
	if host == "" {
		return fmt.Errorf("url host required")
	}
	if host == "169.254.169.254" || host == "metadata.google.internal" {
		return fmt.Errorf("blocked metadata service host")
	}
	if ip := parseOutboundHostIP(host); ip.IsValid() && ip == netip.MustParseAddr("169.254.169.254") {
		return fmt.Errorf("blocked metadata service host")
	}
	return nil
}

func parseOutboundHostIP(host string) netip.Addr {
	if ip, err := netip.ParseAddr(host); err == nil {
		return ip
	}
	if parsed := net.ParseIP(host); parsed != nil {
		if ip, err := netip.ParseAddr(parsed.String()); err == nil {
			return ip
		}
	}
	if strings.HasPrefix(host, "0x") {
		var n uint32
		if _, err := fmt.Sscanf(host, "0x%x", &n); err == nil {
			return netip.AddrFrom4([4]byte{byte(n >> 24), byte(n >> 16), byte(n >> 8), byte(n)})
		}
	}
	if n, err := strconv.ParseUint(host, 10, 32); err == nil {
		return netip.AddrFrom4([4]byte{byte(n >> 24), byte(n >> 16), byte(n >> 8), byte(n)})
	}
	return netip.Addr{}
}
