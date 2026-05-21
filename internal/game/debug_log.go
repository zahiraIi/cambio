package game

import (
	"encoding/json"
	"os"
	"time"
)

// AgentDebugLog writes NDJSON debug entries for agent debugging sessions.
func AgentDebugLog(hypothesisId, location, message string, data map[string]interface{}) {
	agentDebugLog(hypothesisId, location, message, data)
}

// #region agent log
func agentDebugLog(hypothesisId, location, message string, data map[string]interface{}) {
	payload := map[string]interface{}{
		"sessionId":    "1b9773",
		"hypothesisId": hypothesisId,
		"location":     location,
		"message":      message,
		"data":         data,
		"timestamp":    time.Now().UnixMilli(),
		"runId":        "pre-fix",
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	f, err := os.OpenFile("/Users/zahir/cambio/.cursor/debug-1b9773.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

// #endregion
