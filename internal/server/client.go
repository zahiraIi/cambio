package server

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

type Client struct {
	Conn     *websocket.Conn
	PlayerID string
	GameID   string
	mu       sync.Mutex
	Send     func(interface{})
}

func NewClient(conn *websocket.Conn, playerID, gameID string) *Client {
	c := &Client{
		Conn:     conn,
		PlayerID: playerID,
		GameID:   gameID,
	}
	c.Send = func(msg interface{}) {
		data, err := json.Marshal(msg)
		if err != nil {
			log.Printf("marshal error: %v", err)
			return
		}
		c.mu.Lock()
		defer c.mu.Unlock()
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("write error: %v", err)
		}
	}
	return c
}

type WSMessage struct {
	Action string          `json:"action"`
	Data   json.RawMessage `json:"data"`
}

type ActionData struct {
	Slot       int    `json:"slot"`
	TargetID   string `json:"targetId"`
	TargetSlot int    `json:"targetSlot"`
}
