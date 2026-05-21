package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zahir/cambio/internal/game"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Handler struct {
	Hub *Hub
}

func NewHandler(hub *Hub) *Handler {
	return &Handler{Hub: hub}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/games", h.handleGames)
	mux.HandleFunc("/api/games/create", h.handleCreateGame)
	mux.HandleFunc("/api/games/solo", h.handleSoloGame)
	mux.HandleFunc("/ws", h.handleWebSocket)
	mux.Handle("/", http.FileServer(http.Dir("web")))
}

func (h *Handler) handleGames(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.Hub.ListGames())
}

func (h *Handler) handleCreateGame(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		GameID     string `json:"gameId"`
		MaxPlayers int    `json:"maxPlayers"`
		PlayerName string `json:"playerName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.GameID == "" {
		req.GameID = fmt.Sprintf("game-%d", time.Now().UnixNano()%100000)
	}
	if req.MaxPlayers == 0 {
		req.MaxPlayers = 4
	}
	if req.MaxPlayers < 2 {
		req.MaxPlayers = 2
	}
	if req.MaxPlayers > 6 {
		req.MaxPlayers = 6
	}
	if _, err := h.Hub.CreateGame(req.GameID, req.MaxPlayers); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	playerID := fmt.Sprintf("p-%d", time.Now().UnixNano())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"gameId":     req.GameID,
		"playerId":   playerID,
		"maxPlayers": req.MaxPlayers,
	})
}

func (h *Handler) handleSoloGame(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PlayerID      string `json:"playerId"`
		PlayerName    string `json:"playerName"`
		BotCount      int    `json:"botCount"`
		BotDifficulty int    `json:"botDifficulty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.PlayerName == "" {
		http.Error(w, "playerName required", http.StatusBadRequest)
		return
	}
	if req.BotCount < 1 || req.BotCount > 5 {
		http.Error(w, "botCount must be between 1 and 5", http.StatusBadRequest)
		return
	}
	if req.PlayerID == "" {
		req.PlayerID = fmt.Sprintf("p-%d", time.Now().UnixNano())
	}
	gameID := fmt.Sprintf("solo-%d", time.Now().UnixNano())
	room, err := h.Hub.CreateGame(gameID, req.BotCount+1)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := room.Engine.AddPlayer(req.PlayerID, req.PlayerName); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	for i := 0; i < req.BotCount; i++ {
		botID := fmt.Sprintf("bot-%d-%s", i, gameID)
		difficulty := req.BotDifficulty
		if difficulty < 1 || difficulty > 3 {
			difficulty = 2
		}
		if err := room.Engine.AddBot(botID, fmt.Sprintf("Bot %d", i+1), difficulty); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	if err := room.Engine.Start(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"gameId":   gameID,
		"playerId": req.PlayerID,
	})
}

func (h *Handler) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	gameID := r.URL.Query().Get("gameId")
	playerID := r.URL.Query().Get("playerId")
	playerName := r.URL.Query().Get("playerName")

	if gameID == "" || playerID == "" {
		http.Error(w, "gameId and playerId required", http.StatusBadRequest)
		return
	}
	if playerName == "" {
		playerName = playerID
	}

	room := h.Hub.GetGame(gameID)
	if room == nil {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade error: %v", err)
		return
	}
	defer conn.Close()

	client := NewClient(conn, playerID, gameID)
	room.RegisterClient(client)

	addErr := room.Engine.AddPlayer(playerID, playerName)
	if addErr != nil && !errors.Is(addErr, game.ErrPlayerAlreadyInGame) {
		client.Send(map[string]interface{}{"type": "error", "error": addErr.Error()})
		room.UnregisterClient(playerID, client)
		return
	}

	client.Send(map[string]interface{}{
		"type":  "connected",
		"state": room.Engine.GetState(playerID),
		"room":  room.LobbyPayload(),
	})

	room.Broadcast(map[string]interface{}{
		"type": "lobby_update",
		"room": room.LobbyPayload(),
	})

	h.pumpBots(room)

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("read error: %v", err)
			if room.UnregisterClient(playerID, client) && room.Engine.PublicPhase() == "waiting" {
				_ = room.Engine.RemovePlayer(playerID)
			}
			room.Broadcast(map[string]interface{}{
				"type": "lobby_update",
				"room": room.LobbyPayload(),
			})
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			client.Send(map[string]interface{}{"type": "error", "error": "invalid message format"})
			continue
		}

		h.handleAction(room, client, msg)
	}
}

func (h *Handler) handleAction(room *GameRoom, client *Client, msg WSMessage) {
	var data ActionData
	if msg.Data != nil {
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			client.Send(map[string]interface{}{"type": "error", "error": "invalid action data"})
			return
		}
	}

	actionMap := map[string]game.ActionType{
		"start":          game.ActionDrawDeck, // special: start game
		"init_peek":      game.ActionInitPeek,
		"draw_deck":      game.ActionDrawDeck,
		"draw_discard":   game.ActionDrawDiscard,
		"swap_card":      game.ActionSwapCard,
		"discard":        game.ActionDiscard,
		"use_card":       game.ActionDiscard,
		"return_card":    game.ActionReturnDrawn,
		"peek_own":       game.ActionPeekOwn,
		"peek_opponent":  game.ActionPeekOpponent,
		"blind_switch":   game.ActionBlindSwitch,
		"look_switch":    game.ActionLookAndSwitch,
		"decline_switch": game.ActionDeclineSwitch,
		"call_cambio":    game.ActionCallCambio,
		"snap":           game.ActionSnapMatch,
		"stack_opponent": game.ActionStackOpponent,
	}

	if msg.Action == "start" {
		if err := room.Engine.Start(); err != nil {
			client.Send(map[string]interface{}{"type": "error", "error": err.Error()})
			return
		}
		room.mu.Lock()
		clients := make([]*Client, 0, len(room.Clients))
		for _, c := range room.Clients {
			clients = append(clients, c)
		}
		room.mu.Unlock()
		for _, c := range clients {
			c.Send(map[string]interface{}{
				"type":  "game_started",
				"state": room.Engine.GetState(c.PlayerID),
			})
		}
		h.pumpBots(room)
		return
	}

	actionType, ok := actionMap[msg.Action]
	if !ok {
		client.Send(map[string]interface{}{"type": "error", "error": "unknown action: " + msg.Action})
		return
	}

	action := game.Action{
		Type:       actionType,
		PlayerID:   client.PlayerID,
		Slot:       data.Slot,
		TargetID:   data.TargetID,
		TargetSlot: data.TargetSlot,
	}

	events, err := room.Engine.Execute(action)
	if err != nil {
		client.Send(map[string]interface{}{"type": "error", "error": err.Error()})
		return
	}

	h.broadcastEngineEvents(room, events)
	h.pumpBots(room)
}

func (h *Handler) broadcastEngineEvents(room *GameRoom, events []game.Event) {
	for _, event := range events {
		if event.Private && len(event.VisibleTo) > 0 {
			for _, pid := range event.VisibleTo {
				room.SendTo(pid, map[string]interface{}{"type": "event", "event": event})
			}
		} else {
			room.Broadcast(map[string]interface{}{"type": "event", "event": event})
		}
	}
	room.mu.Lock()
	clients := make([]*Client, 0, len(room.Clients))
	for _, c := range room.Clients {
		clients = append(clients, c)
	}
	room.mu.Unlock()
	for _, c := range clients {
		c.Send(map[string]interface{}{
			"type":  "state_update",
			"state": room.Engine.GetState(c.PlayerID),
		})
	}
}

func (h *Handler) pumpBots(room *GameRoom) {
	if !atomic.CompareAndSwapInt32(&room.botPump, 0, 1) {
		return
	}
	go func() {
		defer atomic.StoreInt32(&room.botPump, 0)
		for step := 0; step < 250; step++ {
			botID := room.Engine.NextAutomaticBotID()
			if botID == "" {
				return
			}
			delay := room.Engine.CurrentBotThinkDelay()
			jitter := rand.IntN(900) + 300
			time.Sleep(time.Duration(delay+jitter) * time.Millisecond)
			act, ok := room.Engine.BotChooseAction(botID)
			if !ok {
				log.Printf("bot: no move for %s", botID)
				events := room.Engine.ForceSkipAbility()
				h.broadcastEngineEvents(room, events)
				continue
			}
			events, err := room.Engine.Execute(act)
			if err != nil {
				log.Printf("bot execute: %v", err)
				continue
			}
			h.broadcastEngineEvents(room, events)
		}
	}()
}
