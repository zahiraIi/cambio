package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/zahiraIi/cambio/internal/game"
	"github.com/zahiraIi/cambio/internal/server"
)

type config struct {
	Port           string
	ModelPath      string
	AllowedOrigins []string
}

// loadConfig reads PORT, CAMBIO_MODEL_PATH and CAMBIO_ALLOWED_ORIGINS
// (comma-separated full origins, e.g. https://example.com).
func loadConfig(getenv func(string) string) config {
	cfg := config{Port: getenv("PORT"), ModelPath: getenv("CAMBIO_MODEL_PATH")}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.ModelPath == "" {
		cfg.ModelPath = "models/cambio"
	}
	for _, o := range strings.Split(getenv("CAMBIO_ALLOWED_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			cfg.AllowedOrigins = append(cfg.AllowedOrigins, o)
		}
	}
	return cfg
}

// run serves until ctx is cancelled, then drains in-flight requests for up to 10s.
// The bound address is sent on ready once the listener is open.
func run(ctx context.Context, cfg config, ready chan<- string) error {
	if err := game.LoadPolicy(cfg.ModelPath); err != nil {
		log.Printf("policy not loaded (%v) — bots use heuristics", err)
	} else {
		log.Printf("loaded policy from %s", cfg.ModelPath)
	}

	mux := http.NewServeMux()
	server.NewHandler(server.NewHub(), cfg.AllowedOrigins).RegisterRoutes(mux)

	ln, err := net.Listen("tcp", ":"+cfg.Port)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: mux}
	log.Printf("Cambio server starting on %s", ln.Addr())
	if ready != nil {
		ready <- ln.Addr().String()
	}

	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Printf("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, loadConfig(os.Getenv), nil); err != nil {
		log.Fatal(err)
	}
}
