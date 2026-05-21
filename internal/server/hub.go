package server

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/zahir/cambio/internal/game"
)

// #region agent log
func debugLogRoom(hypothesisID, location, message string, data map[string]interface{}) {
	f, err := os.OpenFile("/Users/zahir/cambio/.cursor/debug-1b9773.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	payload := map[string]interface{}{
		"sessionId":    "1b9773",
		"hypothesisId": hypothesisID,
		"location":     location,
		"message":      message,
		"data":         data,
		"timestamp":    time.Now().UnixMilli(),
	}
	b, _ := json.Marshal(payload)
	_, _ = f.Write(append(b, '\n'))
}

// #endregion

type Hub struct {
	mu    sync.RWMutex
	games map[string]*GameRoom
}

type GameRoom struct {
	mu      sync.Mutex
	Engine  *game.Engine
	Clients map[string]*Client
	botPump int32
}

func NewHub() *Hub {
	return &Hub{
		games: make(map[string]*GameRoom),
	}
}

func (h *Hub) CreateGame(gameID string, maxPlayers int) (*GameRoom, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, exists := h.games[gameID]; exists {
		return nil, fmt.Errorf("game %s already exists", gameID)
	}

	engine := game.NewEngine(gameID, maxPlayers)
	room := &GameRoom{
		Engine:  engine,
		Clients: make(map[string]*Client),
	}
	h.games[gameID] = room
	return room, nil
}

func (h *Hub) GetGame(gameID string) *GameRoom {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.games[gameID]
}

func (h *Hub) ListGames() []map[string]interface{} {
	h.mu.RLock()
	defer h.mu.RUnlock()

	list := make([]map[string]interface{}, 0, len(h.games))
	for id, room := range h.games {
		phase := room.Engine.PublicPhase()
		if phase == "scoring" {
			continue
		}
		room.mu.Lock()
		onlineCount := len(room.Clients)
		room.mu.Unlock()
		list = append(list, map[string]interface{}{
			"id":          id,
			"playerCount": room.Engine.PlayerCount(),
			"onlineCount": onlineCount,
			"maxPlayers":  room.Engine.MaxPlayers(),
			"phase":       phase,
			"joinable":    phase == "waiting" && room.Engine.PlayerCount() < room.Engine.MaxPlayers(),
		})
	}
	return list
}

func (room *GameRoom) LobbyPayload() map[string]interface{} {
	names := make([]string, 0, len(room.Engine.Players))
	for _, p := range room.Engine.Players {
		if !p.IsBot {
			names = append(names, p.Name)
		}
	}
	room.mu.Lock()
	onlineCount := len(room.Clients)
	room.mu.Unlock()
	return map[string]interface{}{
		"players":     names,
		"playerCount": room.Engine.PlayerCount(),
		"onlineCount": onlineCount,
		"maxPlayers":  room.Engine.MaxPlayers(),
		"phase":       room.Engine.PublicPhase(),
		"canStart":    room.Engine.PublicPhase() == "waiting" && onlineCount >= 2 && room.Engine.PlayerCount() >= 2,
	}
}

func (room *GameRoom) RegisterClient(client *Client) *Client {
	room.mu.Lock()
	defer room.mu.Unlock()
	if prev, ok := room.Clients[client.PlayerID]; ok && prev != client {
		// #region agent log
		debugLogRoom("D", "hub.go:RegisterClient", "closing previous client", map[string]interface{}{
			"playerId": client.PlayerID, "gameId": client.GameID,
		})
		// #endregion
		go prev.Conn.Close()
	}
	room.Clients[client.PlayerID] = client
	return room.Clients[client.PlayerID]
}

func (room *GameRoom) UnregisterClient(playerID string, client *Client) bool {
	room.mu.Lock()
	defer room.mu.Unlock()
	if cur, ok := room.Clients[playerID]; ok && cur == client {
		delete(room.Clients, playerID)
		return true
	}
	return false
}

func (room *GameRoom) Broadcast(msg interface{}) {
	room.mu.Lock()
	clients := make([]*Client, 0, len(room.Clients))
	for _, c := range room.Clients {
		clients = append(clients, c)
	}
	room.mu.Unlock()
	for _, client := range clients {
		client.Send(msg)
	}
}

func (room *GameRoom) SendTo(playerID string, msg interface{}) {
	room.mu.Lock()
	client, ok := room.Clients[playerID]
	room.mu.Unlock()
	if ok {
		client.Send(msg)
	}
}
