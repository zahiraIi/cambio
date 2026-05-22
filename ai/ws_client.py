"""WebSocket client that connects a trained AI agent to the Go game server."""

import asyncio
import json
import argparse
import numpy as np

try:
    import websockets
except ImportError:
    print("pip install websockets")
    raise

from agent import CambioAgent
from policy_spec import HAND_SIZE, NUM_ACTIONS


ACTION_MAP = {
    0: "draw_deck",
    1: "draw_discard",
    6: "discard",
    19: "call_cambio",
    20: "decline_switch",
}


def action_to_ws_message(action_idx, game_state):
    """Convert an action index to a WebSocket JSON message."""
    if action_idx in ACTION_MAP:
        return {"action": ACTION_MAP[action_idx], "data": {}}

    # Swap with hand slot (2-5)
    if 2 <= action_idx <= 5:
        return {"action": "swap_card", "data": {"slot": action_idx - 2}}

    # Peek own (7-10)
    if 7 <= action_idx <= 10:
        return {"action": "peek_own", "data": {"slot": action_idx - 7}}

    # Peek opponent (11-14)
    if 11 <= action_idx <= 14:
        opponents = [p for p in game_state.get("players", [])
                     if p["id"] != game_state.get("_myId")]
        target = opponents[0] if opponents else None
        if target:
            return {
                "action": "peek_opponent",
                "data": {"targetId": target["id"], "targetSlot": action_idx - 11},
            }

    # Blind/look switch (15-18)
    if 15 <= action_idx <= 18:
        opponents = [p for p in game_state.get("players", [])
                     if p["id"] != game_state.get("_myId")]
        target = opponents[0] if opponents else None
        if target:
            target_slot = np.random.randint(HAND_SIZE)
            ability = game_state.get("pendingAbility", "none")
            action_name = "look_switch" if ability == "look_and_switch" else "blind_switch"
            return {
                "action": action_name,
                "data": {
                    "slot": action_idx - 15,
                    "targetId": target["id"],
                    "targetSlot": target_slot,
                },
            }

    return {"action": "draw_deck", "data": {}}


def state_to_obs(state, my_id):
    """Convert server game state to the 32-dim observation vector."""
    obs = [0.0] * 32
    idx = 0

    me = None
    for p in state.get("players", []):
        if p["id"] == my_id:
            me = p
            break
    if not me:
        return obs

    # Own hand
    for slot in me.get("hand", []):
        has_card = 1.0 if slot.get("hasCard") else 0.0
        known = 1.0 if slot.get("known") else 0.0
        pts = slot.get("points", 0) / 13.0 if slot.get("known") else 0.0
        obs[idx] = has_card
        obs[idx + 1] = known
        obs[idx + 2] = pts
        idx += 3

    # Estimated score
    known_pts = sum(
        s.get("points", 0) for s in me.get("hand", []) if s.get("known")
    )
    unknown_count = sum(
        1 for s in me.get("hand", []) if s.get("hasCard") and not s.get("known")
    )
    obs[idx] = (known_pts + unknown_count * 5.5) / 40.0
    idx += 1

    # Top discard — just use 0 for simplicity (server doesn't expose points directly)
    obs[idx] = 0.0
    obs[idx + 1] = 0.0
    idx += 2

    # Drawn card
    dc = state.get("drawnCard")
    if dc:
        obs[idx] = 1.0
        obs[idx + 1] = dc.get("points", 0) / 13.0
    idx += 2

    # Phase
    phase_map = {"init_peek": 0, "turns": 1, "final_round": 2, "scoring": 3}
    obs[idx] = phase_map.get(state.get("phase", ""), 0) / 3.0
    idx += 1
    obs[idx] = 1.0 if state.get("currentTurn") == my_id else 0.0
    idx += 1
    ability_map = {"none": 0, "peek_opponent": 1, "peek_own": 2, "blind_switch": 3, "look_and_switch": 4}
    obs[idx] = ability_map.get(state.get("pendingAbility", "none"), 0) / 4.0
    idx += 1

    return obs[:32]


def derive_valid_actions(state, my_id):
    """Derive valid actions from server state."""
    phase = state.get("phase", "")
    is_my_turn = state.get("currentTurn") == my_id
    has_drawn = state.get("hasDrawnCard", False)
    pending = state.get("pendingAbility", "none")

    if phase == "init_peek":
        peeks = state.get("initPeeksLeft", 0)
        if peeks > 0:
            return [7, 8, 9, 10]
        return []

    if phase == "scoring":
        return []

    if not is_my_turn:
        return []

    if pending == "peek_own":
        return [7, 8, 9, 10]
    if pending == "peek_opponent":
        return [11, 12, 13, 14]
    if pending == "blind_switch":
        return [15, 16, 17, 18]
    if pending == "look_and_switch":
        return [15, 16, 17, 18, 20]

    if has_drawn:
        return [2, 3, 4, 5, 6]

    valid = [0]
    if state.get("topDiscard"):
        valid.append(1)
    if phase == "turns":
        valid.append(19)
    return valid


async def play(server_url, game_id, player_name, model_path):
    agent = CambioAgent()
    try:
        agent.load(model_path)
        print(f"Loaded model from {model_path}")
    except FileNotFoundError:
        print("No saved model found, using untrained agent")

    player_id = f"ai-{player_name.lower()}"
    url = f"{server_url}/ws?gameId={game_id}&playerId={player_id}&playerName={player_name}"
    game_state = {}

    async with websockets.connect(url) as ws:
        print(f"Connected to {game_id} as {player_name}")

        async for raw in ws:
            msg = json.loads(raw)

            if msg.get("type") == "connected":
                game_state = msg.get("state", {})
                game_state["_myId"] = player_id

            elif msg.get("type") == "state_update":
                game_state = msg.get("state", {})
                game_state["_myId"] = player_id

            elif msg.get("type") == "game_started":
                game_state = msg.get("state", {})
                game_state["_myId"] = player_id

            elif msg.get("error"):
                print(f"Error: {msg['error']}")
                continue

            # Decide if we should act
            valid = derive_valid_actions(game_state, player_id)
            if not valid:
                continue

            obs = state_to_obs(game_state, player_id)
            action = agent.select_action(obs, valid, explore=False)

            ws_msg = action_to_ws_message(action, game_state)
            await ws.send(json.dumps(ws_msg))
            print(f"  -> {ws_msg['action']} {ws_msg.get('data', {})}")

            if game_state.get("phase") == "scoring":
                print("Game over!")
                scores = game_state.get("scores", {})
                for pid, score in scores.items():
                    print(f"  {pid}: {score} pts")
                break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Connect AI agent to Cambio server")
    parser.add_argument("--server", default="ws://localhost:8080")
    parser.add_argument("--game-id", required=True)
    parser.add_argument("--name", default="CambioBot")
    parser.add_argument("--model", default="models/cambio")
    args = parser.parse_args()

    asyncio.run(play(args.server, args.game_id, args.name, args.model))
