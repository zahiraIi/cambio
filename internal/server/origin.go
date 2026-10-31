package server

import (
	"net/http"
	"net/url"
	"strings"
)

// originAllowed admits websocket upgrades whose Origin host matches the request
// Host (same-site page) or whose full origin is in the allowlist. Requests with
// no Origin header (native clients) are rejected.
func originAllowed(allowed []string) func(*http.Request) bool {
	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return false
		}
		for _, a := range allowed {
			if origin == a {
				return true
			}
		}
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" {
			return false
		}
		return strings.EqualFold(u.Host, r.Host)
	}
}
