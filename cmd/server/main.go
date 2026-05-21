package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/zahir/cambio/internal/server"
)

func main() {
	port := flag.String("port", "8080", "server port")
	flag.Parse()

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
