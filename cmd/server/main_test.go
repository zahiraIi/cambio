package main

import (
	"context"
	"net/http"
	"reflect"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	empty := func(string) string { return "" }
	got := loadConfig(empty)
	want := config{Port: "8080", ModelPath: "models/cambio"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("defaults = %+v, want %+v", got, want)
	}

	env := map[string]string{"CAMBIO_ALLOWED_ORIGINS": " https://a.io, ,http://b:1 "}
	got = loadConfig(func(k string) string { return env[k] })
	if w := []string{"https://a.io", "http://b:1"}; !reflect.DeepEqual(got.AllowedOrigins, w) {
		t.Fatalf("AllowedOrigins = %q, want %q", got.AllowedOrigins, w)
	}
}

func TestRun_ShutdownOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	ready := make(chan string, 1)
	errc := make(chan error, 1)
	go func() { errc <- run(ctx, config{Port: "0", ModelPath: "../../models/cambio"}, ready) }()

	var addr string
	select {
	case addr = <-ready:
	case err := <-errc:
		t.Fatalf("run exited early: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("server never became ready")
	}

	resp, err := http.Get("http://" + addr + "/healthz")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("healthz: %v", err)
	}
	resp.Body.Close()

	cancel()
	select {
	case err := <-errc:
		if err != nil {
			t.Fatalf("run returned %v, want nil", err)
		}
	case <-time.After(11 * time.Second):
		t.Fatal("run did not return within 11s of cancel")
	}
}
