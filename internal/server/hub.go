package server

import (
	"fmt"
	"sync"

	"github.com/zahir/cambio/internal/game"
)

type Hub struct {
	mu    sync.RWMutex
	games map[string]*GameRoom
}

type GameRoom struct {
	mu               sync.Mutex
	GameID           string
	OwnerID          string
	Engine           *game.Engine
	Clients          map[string]*Client
	botPump          int32
	TutorialPractice bool
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
		GameID:  gameID,
		Engine:  engine,
		Clients: make(map[string]*Client),
	}
	h.games[gameID] = room
	return room, nil
}

func (h *Hub) DeleteGame(gameID string) {
	h.mu.Lock()
	delete(h.games, gameID)
	h.mu.Unlock()
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
	names := room.Engine.PlayerNames()
	room.mu.Lock()
	onlineCount := len(room.Clients)
	room.mu.Unlock()
	return map[string]interface{}{
		"players":     names,
		"playerCount": room.Engine.PlayerCount(),
		"onlineCount": onlineCount,
		"maxPlayers":  room.Engine.MaxPlayers(),
		"phase":       room.Engine.PublicPhase(),
		"ownerId":     room.OwnerID,
		"canStart":    room.Engine.PublicPhase() == "waiting" && onlineCount >= 2 && room.Engine.PlayerCount() >= 2,
	}
}

func (room *GameRoom) RegisterClient(client *Client) *Client {
	room.mu.Lock()
	defer room.mu.Unlock()
	if prev, ok := room.Clients[client.PlayerID]; ok && prev != client {
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
