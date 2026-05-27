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
	port := flag.String("port", "", "server port (default PORT env or 8080)")
	modelPath := flag.String("model", "", "path prefix for policy weights (default CAMBIO_MODEL_PATH or models/cambio)")
	flag.Parse()

	listenPort := *port
	if listenPort == "" {
		listenPort = os.Getenv("PORT")
	}
	if listenPort == "" {
		listenPort = "8080"
	}
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

	addr := ":" + listenPort
	log.Printf("Cambio server starting on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
