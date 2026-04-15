package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/adevireddy/colosseum/internal/api"
	"github.com/adevireddy/colosseum/internal/config"
	"github.com/adevireddy/colosseum/internal/db"
	"github.com/adevireddy/colosseum/internal/docker"
	"github.com/adevireddy/colosseum/internal/evals"
	"github.com/adevireddy/colosseum/internal/providers"
	"github.com/adevireddy/colosseum/internal/runtime"
	"github.com/adevireddy/colosseum/internal/tools"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: colosseum <server>")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "server":
		runServer()
	default:
		fmt.Printf("unknown command: %s\n", os.Args[1])
		os.Exit(1)
	}
}

func runServer() {
	cfg := config.Load(os.Args[2:])

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("db open failed: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("migration failed: %v", err)
	}
	if err := tools.EnsureBuiltinDefinitions(context.Background(), database); err != nil {
		log.Fatalf("tool seed failed: %v", err)
	}

	if err := os.MkdirAll(cfg.ArtifactPath, 0o755); err != nil {
		log.Fatalf("artifact directory creation failed: %v", err)
	}
	if err := os.MkdirAll(cfg.WorkspaceRoot, 0o755); err != nil {
		log.Fatalf("workspace root creation failed: %v", err)
	}

	providerMap := map[string]providers.Client{}
	availableProviders := map[string]bool{}
	if cfg.AnthropicKey != "" {
		providerMap["anthropic"] = &providers.AnthropicClient{APIKey: cfg.AnthropicKey}
		availableProviders["anthropic"] = true
	}
	if cfg.OpenAIKey != "" {
		providerMap["openai"] = &providers.OpenAIClient{APIKey: cfg.OpenAIKey}
		availableProviders["openai"] = true
	}
	dockerMgr, err := docker.NewManager(database, cfg.DockerImage)
	if err != nil {
		log.Fatalf("docker init failed: %v", err)
	}
	if err := dockerMgr.Ping(context.Background()); err != nil {
		log.Printf("warning: docker ping failed: %v", err)
	} else {
		_ = dockerMgr.CleanupOrphans(context.Background())
	}

	toolExec := &tools.Executor{DB: database, ArtifactsDir: cfg.ArtifactPath, Docker: dockerMgr}
	runtimeMgr := runtime.NewManager(database, providerMap, toolExec)
	evalMgr := evals.NewManager(database, cfg.WorkspaceRoot)
	runtimeCtx, runtimeCancel := context.WithCancel(context.Background())
	defer runtimeCancel()
	go runtimeMgr.Start(runtimeCtx)
	go evalMgr.Start(runtimeCtx)

	srv := api.NewServer(database, cfg.WorkspaceRoot, availableProviders, cfg.OpenAIKey, providerMap)
	httpServer := &http.Server{
		Addr:         cfg.BindAddr,
		Handler:      srv.Handler(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("colosseum listening on %s", cfg.BindAddr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 2)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(stop)

	<-stop
	log.Printf("shutdown signal received, stopping server...")

	// Second Ctrl+C forces immediate exit.
	go func() {
		<-stop
		log.Printf("second shutdown signal received, forcing exit")
		os.Exit(1)
	}()

	runtimeCancel()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		runtimeMgr.Wait()
	}()
	wg.Add(1)
	go func() {
		defer wg.Done()
		evalMgr.Wait()
	}()

	waitDone := make(chan struct{})
	go func() {
		defer close(waitDone)
		wg.Wait()
	}()

	select {
	case <-waitDone:
	case <-time.After(2 * time.Second):
		log.Printf("runtime workers still stopping, continuing with server shutdown")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("http shutdown warning: %v", err)
	}
}
