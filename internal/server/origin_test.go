package server

import (
	"net/http/httptest"
	"testing"
)

func TestOriginAllowed(t *testing.T) {
	cases := []struct {
		name    string
		origin  string
		host    string
		allowed []string
		want    bool
	}{
		{"SameHost", "https://1.2.3.4.sslip.io", "1.2.3.4.sslip.io", nil, true},
		{"Listed", "http://localhost:5173", "localhost:8080", []string{"http://localhost:5173"}, true},
		{"Foreign", "https://evil.example", "1.2.3.4.sslip.io", nil, false},
		{"Missing", "", "1.2.3.4.sslip.io", nil, false},
		{"Malformed", "::bad", "1.2.3.4.sslip.io", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/ws", nil)
			r.Host = tc.host
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if got := originAllowed(tc.allowed)(r); got != tc.want {
				t.Fatalf("originAllowed = %v, want %v", got, tc.want)
			}
		})
	}
}
