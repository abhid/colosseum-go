package config

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

type Config struct {
	BindAddr        string
	ListenIP        string
	Port            int
	DBPath          string
	ArtifactPath    string
	WorkspaceRoot   string
	DockerHost      string
	DockerImage     string
	OpenAIKey       string
	AnthropicKey    string
	DefaultModel    string
	BrowserMode     string
	BrowserImage    string
	BrowserFallback bool
}

func Load(args []string) Config {
	listenIP := getenv("COLOSSEUM_LISTEN_IP", "0.0.0.0")
	port := getenvInt("COLOSSEUM_PORT", 8080)
	defaultBind := getenv("COLOSSEUM_BIND", fmt.Sprintf("%s:%d", listenIP, port))

	cfg := Config{
		BindAddr:        defaultBind,
		ListenIP:        listenIP,
		Port:            port,
		DBPath:          getenv("COLOSSEUM_DB_PATH", "./colosseum.db"),
		ArtifactPath:    getenv("COLOSSEUM_ARTIFACT_PATH", "./artifacts"),
		WorkspaceRoot:   getenv("COLOSSEUM_WORKSPACE_ROOT", "./workspaces"),
		DockerHost:      getenv("DOCKER_HOST", ""),
		DockerImage:     getenv("COLOSSEUM_DOCKER_IMAGE", "golang:1.25-bookworm"),
		OpenAIKey:       os.Getenv("OPENAI_API_KEY"),
		AnthropicKey:    os.Getenv("ANTHROPIC_API_KEY"),
		DefaultModel:    getenv("COLOSSEUM_DEFAULT_MODEL", "gpt-4.1-mini"),
		BrowserMode:     getenv("COLOSSEUM_BROWSER_MODE", "docker"),
		BrowserImage:    getenv("COLOSSEUM_BROWSER_IMAGE", "mcr.microsoft.com/playwright:v1.59.1-jammy"),
		BrowserFallback: getenvBool("COLOSSEUM_BROWSER_FALLBACK", true),
	}

	fs := flag.NewFlagSet("colosseum", flag.ContinueOnError)
	fs.StringVar(&cfg.BindAddr, "bind", cfg.BindAddr, "HTTP bind address")
	fs.StringVar(&cfg.ListenIP, "listen-ip", cfg.ListenIP, "HTTP listen IP address")
	fs.IntVar(&cfg.Port, "port", cfg.Port, "HTTP listen port")
	fs.StringVar(&cfg.DBPath, "db", cfg.DBPath, "SQLite database path")
	fs.StringVar(&cfg.ArtifactPath, "artifacts", cfg.ArtifactPath, "artifact directory")
	fs.StringVar(&cfg.WorkspaceRoot, "workspace-root", cfg.WorkspaceRoot, "managed workspace root directory")
	fs.StringVar(&cfg.DefaultModel, "model", cfg.DefaultModel, "default model")
	_ = fs.Parse(args)
	if !hasFlag(args, "--bind") {
		cfg.BindAddr = fmt.Sprintf("%s:%d", cfg.ListenIP, cfg.Port)
	}

	return cfg
}

func getenv(key, fallback string) string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v
}

func getenvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	var parsed int
	_, err := fmt.Sscanf(v, "%d", &parsed)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func hasFlag(args []string, flagName string) bool {
	for i := range args {
		if args[i] == flagName {
			return true
		}
	}
	return false
}

func getenvBool(key string, fallback bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if v == "" {
		return fallback
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
