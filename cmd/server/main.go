package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	"github.com/zahir/cambio/internal/game"
	"github.com/zahir/cambio/internal/server"
)

func main() {
	port := flag.String("port", "8080", "server port")
	modelPath := flag.String("model", "", "path prefix for policy weights (default CAMBIO_MODEL_PATH or models/cambio)")
	flag.Parse()

	path := *modelPath
	if path == "" {
		path = os.Getenv("CAMBIO_MODEL_PATH")
	}
	if path == "" {
		path = "models/cambio"
	}
	if err := game.LoadPolicy(path); err != nil {
		log.Printf("policy not loaded (%v) — bots use heuristics", err)
	} else {
		log.Printf("loaded policy from %s", path)
	}

	hub := server.NewHub()
	handler := server.NewHandler(hub)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	addr := ":" + *port
	log.Printf("Cambio server starting on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
