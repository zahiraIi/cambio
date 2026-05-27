const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'Joker'];
const SUITS = ['♠', '♥', '♦', '♣'];

export const SERVER_UNREACHABLE_MSG =
  'Game server not reachable. Run `python3 scripts/launch.py` (Docker, default) or `python3 scripts/launch.py --native` without Docker.';

export function rankLabel(rank) {
  return RANK_LABELS[rank] || '?';
}

/** Parse "10♥" style card string from server */
export function parseCardString(cardStr) {
  if (!cardStr || cardStr === '🃏') return { rank: 14, suit: 0, label: 'Joker', red: false };
  const m = cardStr.match(/^(10|[AKQJ2-9])([♠♥♦♣])?/);
  if (!m) return { rank: 0, suit: 0, label: cardStr, red: false };
  const label = m[1];
  const suitChar = m[2] || '♠';
  const suit = SUITS.indexOf(suitChar);
  const red = suitChar === '♥' || suitChar === '♦';
  let rank = parseInt(label, 10);
  if (label === 'A') rank = 1;
  if (label === 'J') rank = 11;
  if (label === 'Q') rank = 12;
  if (label === 'K') rank = 13;
  return { rank, suit: suit >= 0 ? suit : 0, label, red, text: cardStr };
}

async function apiFetch(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    const msg = String(err?.message || err);
    if (err instanceof TypeError || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      throw new Error(SERVER_UNREACHABLE_MSG);
    }
    throw err;
  }
}

export async function checkServerReachable() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('/api/games', { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchOpenGames() {
  try {
    const res = await fetch('/api/games');
    if (!res.ok) return [];
    const games = await res.json();
    return games.filter((g) => g.joinable && !String(g.id).startsWith('solo-'));
  } catch {
    return [];
  }
}

export async function createGame(playerName, maxPlayers = 4) {
  const res = await apiFetch('/api/games/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName, maxPlayers }),
  });
  if (!res.ok) throw new Error((await res.text()) || 'Could not create table');
  return res.json();
}

export async function startSoloGame(playerName, botCount = 2, botDifficulty = 2, tutorialPractice = false) {
  const res = await apiFetch('/api/games/solo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName, botCount, botDifficulty, tutorialPractice }),
  });
  if (!res.ok) throw new Error((await res.text()) || 'Could not start solo game');
  return res.json();
}

export async function startTutorialPractice(playerName) {
  return startSoloGame(playerName, 1, 1, true);
}

export class GameConnection {
  constructor({ onMessage, onStatus }) {
    this.ws = null;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.reconnectAttempts = 0;
    this.maxReconnect = 8;
    this.reconnectTimer = null;
    this.leaveInProgress = false;
    this.session = null;
  }

  connect(gameId, playerName, playerId, { solo = false } = {}) {
    this.disconnect(false);
    this.session = { gameId, playerName, playerId, solo };
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?gameId=${encodeURIComponent(gameId)}&playerId=${encodeURIComponent(playerId)}&playerName=${encodeURIComponent(playerName)}`;
    this.onStatus?.('reconnecting');
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStatus?.('online');
    };

    this.ws.onmessage = (e) => {
      try {
        this.onMessage?.(JSON.parse(e.data));
      } catch {
        this.onMessage?.({ type: 'error', error: 'invalid message' });
      }
    };

    this.ws.onerror = () => {};

    this.ws.onclose = () => {
      if (this.leaveInProgress) return;
      this.onStatus?.('offline');
      const { solo: isSolo, gameId: gid, playerName: name, playerId: pid } = this.session || {};
      if (!isSolo && gid && this.reconnectAttempts < this.maxReconnect) {
        this.reconnectAttempts += 1;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.onStatus?.('reconnecting');
          this.connect(gid, name, pid, { solo: false });
        }, 2500);
      }
    };
  }

  sendAction(action, data = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, data }));
    }
  }

  startGame() {
    this.sendAction('start');
  }

  disconnect(permanent = true) {
    if (permanent) {
      this.leaveInProgress = true;
      this.reconnectAttempts = this.maxReconnect;
    }
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    if (permanent) {
      this.session = null;
      this.leaveInProgress = false;
    }
  }
}
