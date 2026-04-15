package api

import (
	"database/sql"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/adevireddy/colosseum/internal/providers"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Server struct {
	r             chi.Router
	DB            *sql.DB
	WorkspaceRoot string
	Providers     map[string]bool
	ProviderMap   map[string]providers.Client
}

func NewServer(
	db *sql.DB,
	workspaceRoot string,
	providers map[string]bool,
	openAIKey string,
	providerMap map[string]providers.Client,
) *Server {
	s := &Server{DB: db, WorkspaceRoot: workspaceRoot, Providers: providers, ProviderMap: providerMap}
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(timeoutExceptStream(120 * time.Second))

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := db.PingContext(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	registerAPIRoutes(r, db, workspaceRoot, providers, openAIKey, providerMap)
	mountUI(r)

	s.r = r
	return s
}

func (s *Server) Handler() http.Handler { return s.r }

func mountUI(r chi.Router) {
	sub, err := fs.Sub(uiFS, "ui/dist")
	if err != nil {
		r.Get("/*", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte("UI assets not embedded yet. Run: make ui-build && make build"))
		})
		return
	}

	fsHandler := http.FileServer(http.FS(sub))

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		content, err := fs.ReadFile(sub, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(content)
	})

	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		if _, err := sub.Open(r.URL.Path[1:]); err == nil {
			fsHandler.ServeHTTP(w, r)
			return
		}
		content, err := fs.ReadFile(sub, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(content)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func timeoutExceptStream(d time.Duration) func(http.Handler) http.Handler {
	timeoutMW := middleware.Timeout(d)
	return func(next http.Handler) http.Handler {
		wrapped := timeoutMW(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/stream/") {
				next.ServeHTTP(w, r)
				return
			}
			wrapped.ServeHTTP(w, r)
		})
	}
}
