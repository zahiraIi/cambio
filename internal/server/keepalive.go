package server

import (
	"time"

	"github.com/gorilla/websocket"
)

// Package-level so tests can shorten them; read once per connection.
var (
	pongWait             = 60 * time.Second
	pingPeriod           = 54 * time.Second // pongWait * 9/10
	writeWait            = 10 * time.Second
	maxMessageSize int64 = 4096
)

// startKeepalive applies the read limit and deadline, extends the deadline on
// each pong, and pings on a ticker until stop is called. Pings use WriteControl,
// which is safe alongside Client.Send's mutex-guarded writes.
func startKeepalive(conn *websocket.Conn) (stop func()) {
	wait, period := pongWait, pingPeriod
	conn.SetReadLimit(maxMessageSize)
	conn.SetReadDeadline(time.Now().Add(wait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wait))
	})

	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(period)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
					return
				}
			}
		}
	}()
	return func() { close(done) }
}
