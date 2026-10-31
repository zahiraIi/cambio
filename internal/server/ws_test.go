package server

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// createSolo starts a solo game over the real API and returns its id.
func createSolo(t *testing.T, srvURL, playerID string) string {
	t.Helper()
	body := `{"playerId":"` + playerID + `","playerName":"` + playerID + `","botCount":2}`
	resp, err := http.Post(srvURL+"/api/games/solo", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		GameID string `json:"gameId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.GameID == "" {
		t.Fatalf("solo create failed: status %d err %v", resp.StatusCode, err)
	}
	return out.GameID
}

func createLobby(t *testing.T, srvURL string) (gameID, ownerID string) {
	t.Helper()
	resp, err := http.Post(srvURL+"/api/games/create", "application/json", strings.NewReader(`{"maxPlayers":4,"playerName":"owner"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		GameID   string `json:"gameId"`
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out.GameID, out.PlayerID
}

func dialWS(t *testing.T, srvURL, gameID, playerID string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srvURL, "http") + "/ws?gameId=" + gameID + "&playerId=" + playerID + "&playerName=" + playerID
	hdr := http.Header{"Origin": {srvURL}}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, hdr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func setKeepalive(t *testing.T, pong, ping time.Duration) {
	t.Helper()
	oldPong, oldPing := pongWait, pingPeriod
	pongWait, pingPeriod = pong, ping
	t.Cleanup(func() { pongWait, pingPeriod = oldPong, oldPing })
}

func clientRegistered(room *GameRoom, playerID string) bool {
	room.mu.Lock()
	defer room.mu.Unlock()
	_, ok := room.Clients[playerID]
	return ok
}

func TestReadLimit_ClosesOversizedFrame(t *testing.T) {
	srv, _ := newTestServer(t)
	gameID := createSolo(t, srv.URL, "big")
	conn := dialWS(t, srv.URL, gameID, "big")

	if err := conn.WriteMessage(websocket.TextMessage, []byte(strings.Repeat("x", 5000))); err != nil {
		t.Fatal(err)
	}
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var err error
	for err == nil {
		_, _, err = conn.ReadMessage()
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		t.Fatalf("server did not close oversized connection: %v", err)
	}

	resp, herr := http.Get(srv.URL + "/healthz")
	if herr != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("server unhealthy after oversized frame: %v", herr)
	}
	resp.Body.Close()
}

func TestKeepalive_DropsSilentPeer(t *testing.T) {
	setKeepalive(t, 300*time.Millisecond, 100*time.Millisecond)
	srv, hub := newTestServer(t)
	gameID, ownerID := createLobby(t, srv.URL)
	conn := dialWS(t, srv.URL, gameID, ownerID)
	conn.SetPingHandler(func(string) error { return nil }) // never pong; also never read

	room := hub.GetGame(gameID)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if hub.GetGame(gameID) == nil || !clientRegistered(room, ownerID) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("silent peer still registered after 2s")
}

func TestKeepalive_PingWhileBroadcasting(t *testing.T) {
	setKeepalive(t, time.Second, 5*time.Millisecond)
	srv, _ := newTestServer(t)
	gameID, ownerID := createLobby(t, srv.URL)
	a := dialWS(t, srv.URL, gameID, ownerID)
	b := dialWS(t, srv.URL, gameID, "guest")

	var wg sync.WaitGroup
	for _, c := range []*websocket.Conn{a, b} {
		wg.Add(1)
		go func(c *websocket.Conn) {
			defer wg.Done()
			c.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
			for {
				if _, _, err := c.ReadMessage(); err != nil {
					return
				}
			}
		}(c)
	}
	for i := 0; i < 200; i++ {
		if err := b.WriteJSON(map[string]string{"action": "start"}); err != nil {
			t.Fatal(err)
		}
	}
	wg.Wait()
}
