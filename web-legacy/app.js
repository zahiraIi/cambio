let ws = null;
let gameState = null;
let myPlayerId = null;
let selectedSlot = null;
let pendingAbility = null;
let soloSession = false;
let currentGameId = null;
let currentPlayerName = null;
let reconnectTimer = null;
let gamesPollTimer = null;
let lastTurnPlayer = null;

const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'Joker'];
const MEMORY_RECALL_MIN = 0.35;

const $ = (sel) => document.querySelector(sel);

let reconnectAttempts = 0;
const MAX_RECONNECT = 8;
let leaveInProgress = false;
let lastLobbyRoom = null;

const SEAT_POSITIONS = [
    { x: 50, y: 6 },
    { x: 78, y: 14 },
    { x: 92, y: 38 },
    { x: 8, y: 38 },
    { x: 22, y: 14 },
    { x: 50, y: 28 },
];

function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(`#${id}`).classList.add('active');
    document.body.classList.toggle('in-game', id === 'game');
    $('#quitGameBtn')?.classList.toggle('hidden', !(id === 'game' && soloSession));
    if (id !== 'game') hideScoresOverlay();
    if (id === 'lobby') startGamesPoll();
    else stopGamesPoll();
}

function disconnectGame() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    reconnectAttempts = MAX_RECONNECT;
    if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
        ws = null;
    }
}

function returnToLobby() {
    leaveInProgress = true;
    disconnectGame();
    soloSession = false;
    lastLobbyRoom = null;
    currentGameId = null;
    currentPlayerName = null;
    myPlayerId = null;
    gameState = null;
    pendingAbility = null;
    selectedSlot = null;
    lastTurnPlayer = null;
    clearSession();
    const u = new URL(location.href);
    u.searchParams.delete('room');
    history.replaceState(null, '', u);
    hideScoresOverlay();
    showScreen('lobby');
    setConnectionStatus('offline');
    leaveInProgress = false;
}

function quitSoloGame() {
    if (!soloSession) return;
    if (!confirm('Leave this game and return to the menu?')) return;
    returnToLobby();
}

function leaveWaitingRoom() {
    if (soloSession || !isRoomOwner()) return;
    if (!confirm('Cancel this table and return to the menu?')) return;
    returnToLobby();
}

function isRoomOwner() {
    return lastLobbyRoom?.ownerId && lastLobbyRoom.ownerId === myPlayerId;
}

function hideScoresOverlay() {
    $('#scoresOverlay')?.classList.add('hidden');
}

function memoryKey(targetId, slot) {
    return `${targetId}:${slot}`;
}

function getMemory(targetId, slotIdx) {
    const key = memoryKey(targetId, slotIdx);
    return (gameState?.memories || []).find((m) => m.key === key);
}

function rankLabel(rank) {
    return RANK_LABELS[rank] || '?';
}

function parseRankFromCard(cardStr) {
    if (!cardStr || cardStr === '🃏') return 14;
    const m = cardStr.match(/^(10|[AKQJ2-9])/);
    if (!m) return null;
    const t = m[1];
    if (t === 'A') return 1;
    if (t === 'J') return 11;
    if (t === 'Q') return 12;
    if (t === 'K') return 13;
    return parseInt(t, 10);
}

function slotRankForSnap(slotIdx, slotData) {
    if (slotData?.rank != null) return slotData.rank;
    if (slotData?.card) return parseRankFromCard(slotData.card);
    const mem = getMemory(myPlayerId, slotIdx);
    if (mem && mem.strength >= MEMORY_RECALL_MIN) return mem.rank;
    return null;
}

function stackWindowOpen() {
    return (
        gameState &&
        gameState.phase === 'turns' &&
        gameState.openStackRank > 0 &&
        !gameState.stackRankClaimed
    );
}

function holdingDrawnCard() {
    return !!(gameState?.hasDrawnCard && gameState.currentTurn === myPlayerId);
}

function canAttemptSnapOwn(slotIdx, slotData) {
    if (gameState?.pendingStackGive) return false;
    if (holdingDrawnCard()) return false;
    if (
        gameState.currentTurn === myPlayerId &&
        pendingAbility &&
        pendingAbility !== 'none'
    ) {
        return false;
    }
    if (!stackWindowOpen()) return false;
    return !!slotData?.hasCard;
}

function canSnapOwnCard(slotIdx, slotData) {
    if (!canAttemptSnapOwn(slotIdx, slotData)) return false;
    const rank = slotRankForSnap(slotIdx, slotData);
    return rank != null && rank === gameState.openStackRank;
}

function opponentStackMemory(targetId, slotIdx) {
    const mem = getMemory(targetId, slotIdx);
    if (!mem || mem.strength < MEMORY_RECALL_MIN) return null;
    return mem;
}

function canAttemptStackOpponent(targetId, targetSlot) {
    if (gameState?.pendingStackGive) return false;
    if (holdingDrawnCard()) return false;
    if (
        gameState.currentTurn === myPlayerId &&
        pendingAbility &&
        pendingAbility !== 'none'
    ) {
        return false;
    }
    if (!stackWindowOpen()) return false;
    const opp = gameState.players.find((p) => p.id === targetId);
    if (!opp?.hand?.[targetSlot]?.hasCard) return false;
    return opponentStackMemory(targetId, targetSlot) != null;
}

function canStackOpponentCard(targetId, slotIdx) {
    if (!canAttemptStackOpponent(targetId, slotIdx)) return false;
    const mem = opponentStackMemory(targetId, slotIdx);
    return mem.rank === gameState.openStackRank;
}

function cardIsRed(cardStr) {
    return cardStr?.includes('♥') || cardStr?.includes('♦');
}

function parseCard(cardStr) {
    if (!cardStr || cardStr === '🃏') {
        return { rank: '', suit: '', isRed: false, isJoker: true, label: '🃏' };
    }
    const m = cardStr.match(/^(10|[AKQJ2-9])(♥|♦|♣|♠)/);
    if (!m) return { rank: cardStr, suit: '', isRed: false, isJoker: false, label: cardStr };
    return {
        rank: m[1],
        suit: m[2],
        isRed: m[2] === '♥' || m[2] === '♦',
        isJoker: false,
        label: cardStr,
    };
}

function cornerHtml(rank, suit, pos) {
    return `<div class="pc-corner pc-${pos}"><span class="pc-rank">${escapeHtml(rank)}</span><span class="pc-suit">${suit}</span></div>`;
}

function centerHtml(rank, suit, compact) {
    if (rank === 'J' || rank === 'Q' || rank === 'K') {
        return `<div class="pc-center-face"><span class="pc-face-letter">${rank}</span><span class="pc-face-suit">${suit}</span></div>`;
    }
    if (rank === 'A') {
        return `<div class="pc-center-ace"><span class="pc-ace-suit">${suit}</span></div>`;
    }
    const n = parseInt(rank, 10);
    if (Number.isNaN(n)) return '';
    if (compact) {
        return `<div class="pc-center-compact"><span class="pc-compact-suit">${suit}</span></div>`;
    }
    const pips = Array.from({ length: n }, () => `<span class="pc-pip">${suit}</span>`).join('');
    return `<div class="pc-pips pc-pips-${n}">${pips}</div>`;
}

function cardFaceHtml(cardStr, opts = {}) {
    const { rankOnly = false, compact = false } = opts;
    const p = parseCard(cardStr);
    if (rankOnly && !p.isJoker) {
        const rank = p.rank || rankLabel(parseRankFromCard(cardStr));
        return `<div class="playing-card memory-rank-only"><span class="pc-rank-only">${escapeHtml(rank)}</span></div>`;
    }
    if (p.isJoker) {
        return `<div class="playing-card joker"><span class="pc-joker">🃏</span><span class="pc-joker-text">JOKER</span></div>`;
    }
    const color = p.isRed ? 'red' : 'black';
    return `<div class="playing-card ${color}">
        ${cornerHtml(p.rank, p.suit, 'tl')}
        ${centerHtml(p.rank, p.suit, compact)}
        ${cornerHtml(p.rank, p.suit, 'br')}
    </div>`;
}

function cardBackHtml() {
    return `<div class="playing-card playing-card-back"><div class="pc-back-inner"></div></div>`;
}

const CARD_FLIGHT = { holdMs: 420, flyMs: 720 };

function playerCardSize() {
    const style = getComputedStyle(document.documentElement);
    return {
        w: parseFloat(style.getPropertyValue('--card-w')) || 96,
        h: parseFloat(style.getPropertyValue('--card-h')) || 134,
    };
}

function isCompactLayout() {
    return window.matchMedia('(max-width: 640px)').matches;
}

function measureDrawnCardLanding() {
    const area = $('#drawnCardArea');
    const card = area?.querySelector('.drawn-card-display');
    if (!area || !card) return null;

    const wasHidden = area.classList.contains('hidden');
    const prevVis = area.style.visibility;
    area.classList.remove('hidden');
    area.style.visibility = 'hidden';
    area.style.pointerEvents = 'none';
    const rect = card.getBoundingClientRect();
    if (wasHidden) area.classList.add('hidden');
    area.style.visibility = prevVis;
    area.style.pointerEvents = '';
    if (rect.width > 0 && rect.height > 0) return rect;

    const { w, h } = playerCardSize();
    const hand = $('#playerHand')?.getBoundingClientRect();
    const float = area.getBoundingClientRect();
    if (!hand?.width) return null;
    const gap = isCompactLayout() ? 14 : 28;
    const top = float.height > 0 ? float.top + float.height / 2 - h / 2 : hand.top - h - gap;
    return {
        left: hand.left + hand.width / 2 - w / 2,
        top,
        width: w,
        height: h,
    };
}

function animateCardFlight(cardText, opts = {}) {
    const layer = $('#cardFlyLayer');
    if (!layer || !cardText) return false;

    const {
        fromEl,
        toEl = $('#discardPile'),
        toRect,
        startFace = 0,
        endFace = 180,
        holdMs = CARD_FLIGHT.holdMs,
        flyMs = CARD_FLIGHT.flyMs,
        onComplete,
    } = opts;

    const fromR = fromEl?.getBoundingClientRect?.();
    const toR = toRect || toEl?.getBoundingClientRect?.();
    if (!fromR || !toR || toR.width <= 0 || toR.height <= 0) {
        onComplete?.();
        return false;
    }

    const { w, h } = playerCardSize();
    const startCx = fromR.left + fromR.width / 2;
    const startCy = fromR.top + fromR.height / 2;
    const endCx = toR.left + toR.width / 2;
    const endCy = toR.top + toR.height / 2;
    const dx = endCx - startCx;
    const dy = endCy - startCy;
    const isRed = cardIsRed(cardText);

    const root = document.createElement('div');
    root.className = 'card-flight-root';
    root.style.left = `${startCx - w / 2}px`;
    root.style.top = `${startCy - h / 2}px`;
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;

    root.innerHTML = `
        <div class="card-flight-track">
            <div class="card-flight-flip">
                <div class="card-flight-face card-flight-front ${isRed ? 'red' : ''}">${cardFaceHtml(cardText)}</div>
                <div class="card-flight-face card-flight-back">${cardBackHtml()}</div>
            </div>
        </div>`;

    const track = root.querySelector('.card-flight-track');
    const flip = root.querySelector('.card-flight-flip');
    flip.style.transform = `rotateY(${startFace}deg)`;

    layer.appendChild(root);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            root.classList.add('is-holding');
            flip.style.transform = `rotateY(${startFace}deg) scale(1.14) translateZ(24px)`;
        });
    });

    const flyTimer = setTimeout(() => {
        root.classList.remove('is-holding');
        root.classList.add('is-flying');

        const easing = 'cubic-bezier(0.33, 1, 0.38, 1)';
        track.style.transition = `transform ${flyMs}ms ${easing}`;
        flip.style.transition = `transform ${flyMs}ms ${easing}`;

        track.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        flip.style.transform = `rotateY(${endFace}deg) scale(0.96) translateZ(0)`;
    }, holdMs);

    const doneTimer = setTimeout(() => {
        root.classList.add('is-done');
        setTimeout(() => {
            root.remove();
            onComplete?.();
        }, 160);
    }, holdMs + flyMs);

    root._cancel = () => {
        clearTimeout(flyTimer);
        clearTimeout(doneTimer);
        root.remove();
        onComplete?.();
    };
    return true;
}

function revealDrawnCardUI() {
    if (!gameState?.drawnCard || gameState.currentTurn !== myPlayerId) return;
    if (layerHasActiveFlight()) return;
    renderDrawnCard(true, false);
}

function flyCardToDiscard(cardText, opts = {}) {
    animateCardFlight(cardText, {
        fromEl: opts.fromEl,
        toEl: $('#discardPile'),
        startFace: 0,
        endFace: 180,
        ...opts,
    });
}

function flyCardToDrawnSlot(cardText, fromEl, opts = {}) {
    const area = $('#drawnCardArea');
    if (area) area.classList.add('hidden');
    const run = () => {
        const landing = measureDrawnCardLanding();
        const started = animateCardFlight(cardText, {
            fromEl,
            toRect: landing,
            onComplete: revealDrawnCardUI,
            ...opts,
        });
        if (!started) revealDrawnCardUI();
    };
    requestAnimationFrame(run);
}

function flyCardFromDeck(cardText, opts = {}) {
    flyCardToDrawnSlot(cardText, $('#deckPile'), { startFace: 180, endFace: 0, ...opts });
}

function flyCardFromDiscardToHand(cardText) {
    flyCardToDrawnSlot(cardText, $('#discardPile'), { startFace: 0, endFace: 0 });
}

function flyCardToHand(cardText, fromEl, toEl) {
    animateCardFlight(cardText, {
        fromEl,
        toEl: toEl || $('#playerHand'),
        startFace: 0,
        endFace: 360,
    });
}

function layerHasActiveFlight() {
    return !!$('#cardFlyLayer')?.querySelector('.card-flight-root:not(.is-done)');
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function setConnectionStatus(status) {
    const labels = { online: 'Live', offline: 'Offline', reconnecting: 'Reconnecting…' };
    document.querySelectorAll('.connection-badge').forEach((el) => {
        el.className = `connection-badge ${status}`;
        el.textContent = labels[status] || status;
    });
}

function persistSession() {
    if (!currentGameId || !myPlayerId) return;
    sessionStorage.setItem(
        'cambio_session',
        JSON.stringify({
            gameId: currentGameId,
            playerId: myPlayerId,
            playerName: currentPlayerName,
            solo: soloSession,
        }),
    );
}

function clearSession() {
    sessionStorage.removeItem('cambio_session');
}

function setRoomURL(gameId) {
    const u = new URL(location.href);
    u.searchParams.set('room', gameId);
    history.replaceState(null, '', u);
}

function getShareURL(gameId) {
    const u = new URL(location.href);
    u.searchParams.set('room', gameId);
    return u.toString();
}

function toast(text, important = false) {
    const stack = $('#toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast' + (important ? ' important' : '');
    el.textContent = text;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3600);
}

function logEvent(text, important = false) {
    toast(text, important);
}

// ── Lobby ──

async function fetchOpenGames() {
    try {
        const res = await fetch('/api/games');
        if (!res.ok) return [];
        return res.json();
    } catch {
        return [];
    }
}

async function renderGamesList() {
    const list = $('#gamesList');
    if (!list) return;
    const games = await fetchOpenGames();
    const open = games.filter((g) => g.joinable && !String(g.id).startsWith('solo-'));
    if (open.length === 0) {
        list.innerHTML = '<p class="games-empty">No open tables — create one!</p>';
        return;
    }
    list.innerHTML = open
        .map(
            (g) => `<div class="game-row">
            <span><strong>${escapeHtml(g.id)}</strong> · ${g.playerCount}/${g.maxPlayers}</span>
            <button type="button" class="btn btn-small btn-secondary" data-join="${escapeHtml(g.id)}">Join</button>
        </div>`,
        )
        .join('');
    list.querySelectorAll('[data-join]').forEach((btn) => {
        btn.addEventListener('click', () => {
            $('#gameIdInput').value = btn.dataset.join;
            $('#joinGameBtn').click();
        });
    });
}

function startGamesPoll() {
    renderGamesList();
    stopGamesPoll();
    gamesPollTimer = setInterval(renderGamesList, 4000);
}

function stopGamesPoll() {
    if (gamesPollTimer) {
        clearInterval(gamesPollTimer);
        gamesPollTimer = null;
    }
}

$('#refreshGamesBtn')?.addEventListener('click', renderGamesList);

$('#soloPlayBtn').addEventListener('click', async () => {
    const name = $('#playerName').value.trim();
    if (!name) return alert('Enter your name');
    let botCount = parseInt($('#botCount').value, 10);
    if (Number.isNaN(botCount)) botCount = 2;
    botCount = Math.min(5, Math.max(1, botCount));

    const res = await fetch('/api/games/solo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            playerName: name,
            botCount,
            botDifficulty: parseInt($('#botDifficulty')?.value || '2', 10) || 2,
        }),
    });
    if (!res.ok) return alert((await res.text()) || 'Could not start solo game');
    const data = await res.json();
    soloSession = true;
    joinGame(data.gameId, name, data.playerId);
});

$('#createGameBtn').addEventListener('click', async () => {
    const name = $('#playerName').value.trim();
    if (!name) return alert('Enter your name');
    const maxPlayers = parseInt($('#maxPlayers').value, 10) || 4;

    const res = await fetch('/api/games/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name, maxPlayers }),
    });
    if (!res.ok) return alert((await res.text()) || 'Could not create table');
    const data = await res.json();
    soloSession = false;
    joinGame(data.gameId, name, data.playerId);
});

$('#joinGameBtn').addEventListener('click', () => {
    const name = $('#playerName').value.trim();
    const gameId = $('#gameIdInput').value.trim();
    if (!name) return alert('Enter your name');
    if (!gameId) return alert('Enter a room code');
    soloSession = false;
    joinGame(gameId, name);
});

$('#copyRoomBtn')?.addEventListener('click', async () => {
    if (!currentGameId) return;
    try {
        await navigator.clipboard.writeText(getShareURL(currentGameId));
        toast('Invite link copied!', true);
    } catch {
        toast('Copy failed — share the room code manually');
    }
});

function joinGame(gameId, playerName, fixedPlayerId = null) {
    currentGameId = gameId;
    currentPlayerName = playerName;
    myPlayerId = fixedPlayerId || `p-${Date.now().toString(36)}`;
    setRoomURL(gameId);
    persistSession();
    connectWS(gameId, playerName, myPlayerId);
}

function connectWS(gameId, playerName, playerId) {
    if (ws) {
        ws.onclose = null;
        ws.close();
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws?gameId=${encodeURIComponent(gameId)}&playerId=${encodeURIComponent(playerId)}&playerName=${encodeURIComponent(playerName)}`;

    setConnectionStatus('reconnecting');
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        reconnectAttempts = 0;
        setConnectionStatus('online');
        if (!soloSession) {
            $('#waitingGameId').textContent = gameId;
            showScreen('waiting');
        } else {
            showScreen('game');
        }
    };

    ws.onmessage = (e) => {
        try {
            handleMessage(JSON.parse(e.data));
        } catch {
            toast('Invalid server message', true);
        }
    };

    ws.onerror = (ev) => {
    };

    ws.onclose = (ev) => {
        if (leaveInProgress) return;
        setConnectionStatus('offline');
        toast('Disconnected from server');
        const canReconnect =
            !soloSession &&
            currentGameId &&
            sessionStorage.getItem('cambio_session') &&
            reconnectAttempts < MAX_RECONNECT &&
            gameState?.phase !== 'scoring';
        if (canReconnect) {
            reconnectAttempts++;
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                toast('Reconnecting…', true);
                connectWS(currentGameId, currentPlayerName, myPlayerId);
            }, 2500);
        }
    };
}

$('#startGameBtn').addEventListener('click', () => {
    ws?.send(JSON.stringify({ action: 'start' }));
});

function handleMessage(msg) {
    switch (msg.type) {
        case 'connected':
            gameState = msg.state;
            if (msg.room) renderLobby(msg.room);
            if (gameState.phase !== 'waiting') {
                showScreen('game');
                renderGame();
                toast(soloSession ? 'Table ready — peek your first two cards.' : 'Connected to live table.', true);
            }
            break;
        case 'lobby_update':
            renderLobby(msg.room || { players: msg.players || [] });
            break;
        case 'game_cancelled':
            toast('Host left — table closed', true);
            returnToLobby();
            break;
        case 'game_started':
            gameState = msg.state;
            showScreen('game');
            renderGame(true);
            toast('Cards dealt — peek positions 1 & 2 once.', true);
            break;
        case 'state_update':
            gameState = msg.state;
            renderGame();
            checkGameOver();
            break;
        case 'event':
            handleEvent(msg.event);
            break;
        case 'error':
            toast('Error: ' + (msg.error || JSON.stringify(msg)), true);
            break;
        default:
            if (msg.error) toast('Error: ' + msg.error, true);
    }
}

function renderLobby(room) {
    lastLobbyRoom = room;
    const players = room.players || [];
    const list = $('#playersList');
    if (list) {
        list.innerHTML = players.map((p) => `<div class="player-tag">${escapeHtml(p)}</div>`).join('');
    }
    const meta = $('#waitingMeta');
    if (meta && room.maxPlayers) {
        meta.textContent = `${room.playerCount || players.length} / ${room.maxPlayers} seated · ${room.onlineCount || 0} online`;
    }
    const startBtn = $('#startGameBtn');
    const hint = $('#startHint');
    if (startBtn) {
        const canStart = room.canStart === true;
        startBtn.disabled = !canStart;
        if (hint) hint.classList.toggle('hidden', canStart);
    }
    $('#leaveWaitingBtn')?.classList.toggle('hidden', soloSession || !isRoomOwner());
}

function handleEvent(event) {
    const evtType = event.type || event.Type;
    const evtData = event.data || event.Data;
    const evtPlayer = event.playerId || event.PlayerID;

    switch (evtType) {
        case 'card_peeked':
        case 'peeked_own':
            toast(`Peeked: ${evtData.card} (${evtData.points} pts)`, true);
            break;
        case 'peeked_opponent':
            toast(`Opponent card: ${evtData.card}`, true);
            break;
        case 'card_drawn':
            if (evtPlayer === myPlayerId && evtData.card) {
                if (evtData.source === 'discard') {
                    flyCardFromDiscardToHand(evtData.card);
                } else {
                    flyCardFromDeck(evtData.card);
                }
            }
            toast(evtData.source === 'deck' ? 'Drew from deck' : `Drew ${evtData.card}`, false);
            break;
        case 'card_discarded':
            toast(
                `Discarded ${evtData.card}` + (evtData.ability !== 'none' ? ` → ${formatAbility(evtData.ability)}` : ''),
            );
            flyCardToDiscard(evtData.card, {
                fromEl: evtPlayer === myPlayerId ? $('#drawnCardArea') : $('.table-center'),
            });
            break;
        case 'card_returned':
            toast(`Returned ${evtData.card} to discard`, false);
            flyCardToDiscard(evtData.card, { fromEl: $('#drawnCardArea') });
            break;
        case 'card_swapped':
            toast(`${getPlayerName(evtPlayer)} swapped a card`);
            if (evtData.discarded) flyCardToDiscard(evtData.discarded, { fromEl: $('#playerHand') });
            break;
        case 'blind_switched':
            toast(`${getPlayerName(evtPlayer)} blind switched`);
            break;
        case 'look_and_switched':
            toast(`${getPlayerName(evtPlayer)} look-and-switched`);
            break;
        case 'looked_at_card':
            toast(`Looked: ${evtData.card}`, true);
            break;
        case 'switch_declined':
            toast(evtData.message || 'Kept cards without swapping', true);
            pendingAbility = null;
            selectedSlot = null;
            syncAbilityPromptFromState();
            break;
        case 'cambio_called':
            toast(`${evtData?.message || 'Cambio called'} — each other player gets one final turn.`, true);
            break;
        case 'snap_success':
            toast(`${getPlayerName(evtPlayer)} stacked ${evtData.card}!`, true);
            flyCardToDiscard(evtData.card, {
                fromEl:
                    evtPlayer === myPlayerId && evtData.slot != null
                        ? $(`#playerHand .card[data-slot="${evtData.slot}"]`)
                        : $(`.seat[data-player="${evtPlayer}"]`) || $('#playerHand'),
            });
            break;
        case 'snap_voided':
            toast(evtData.message || 'Stack voided — someone beat you to it.');
            break;
        case 'snap_failed':
            toast(evtData.message);
            break;
        case 'stack_opponent_success':
            toast(`Stacked opponent's ${evtData.card}! Pick a card to give them.`, true);
            flyCardToDiscard(evtData.card, { fromEl: $('.table-felt') });
            break;
        case 'stack_give_complete':
            toast('Card given to opponent.', true);
            break;
        case 'stack_opponent_voided':
            toast(evtData.message || 'Opponent stack voided.');
            break;
        case 'stack_opponent_failed':
            toast(evtData.message);
            break;
        case 'hand_cleared':
            toast(evtData?.message || `${getPlayerName(evtPlayer)} cleared their hand!`, true);
            break;
        case 'game_over':
            toast('Hand complete!', true);
            if (evtData && typeof evtData === 'object' && !Array.isArray(evtData)) {
                if (gameState) gameState = { ...gameState, phase: 'scoring', scores: evtData };
                clearSession();
                showScores(evtData);
            } else {
                checkGameOver();
            }
            break;
        case 'turns_begin':
            toast('Main round — lowest score wins. Call CAMBIO when you think you have the best hand.', true);
            break;
        case 'turn_changed':
            flashTurnChange(evtData?.currentPlayer || gameState?.currentTurn);
            break;
    }
}

function flashTurnChange(playerId) {
    if (playerId && playerId !== lastTurnPlayer) {
        lastTurnPlayer = playerId;
        document.querySelector('.table-felt')?.classList.add('turn-changed-flash');
        setTimeout(() => document.querySelector('.table-felt')?.classList.remove('turn-changed-flash'), 650);
    }
}

function syncAbilityPromptFromState() {
    const phase = gameState.phase;
    const isMyTurn = gameState.currentTurn === myPlayerId;
    const pa = gameState.pendingAbility;
    const psg = gameState.pendingStackGive;
    const prompt = $('#abilityPrompt');

    if (psg) {
        const opp = gameState.players.find((p) => p.id === psg.targetId);
        pendingAbility = null;
        prompt?.classList.remove('hidden');
        $('#abilityText').textContent = `Pick one of your cards to give ${opp?.name || 'your opponent'}`;
        $('#abilitySkipBtn')?.classList.add('hidden');
        return;
    }

    if (isMyTurn && pa && pa !== 'none' && phase !== 'init_peek' && phase !== 'scoring') {
        pendingAbility = pa;
        prompt?.classList.remove('hidden');
        const skip = $('#abilitySkipBtn');
        const confirm = $('#abilityConfirmBtn');
        skip?.classList.add('hidden');
        confirm?.classList.add('hidden');

        if (pa === 'look_and_switch') {
            const ls = gameState.lookSwitch || {};
            if (ls.mySlot == null || ls.mySlot < 0) {
                $('#abilityText').textContent = 'Pick one of your cards to look at';
            } else if (!ls.peekDone) {
                $('#abilityText').textContent = "Pick an opponent's card to look at";
            } else {
                $('#abilityText').textContent = 'Swap cards or keep yours?';
                skip.textContent = 'Keep';
                skip?.classList.remove('hidden');
                confirm?.classList.remove('hidden');
            }
        } else {
            $('#abilityText').textContent = abilityMessage(pa);
        }
    } else {
        pendingAbility = null;
        prompt?.classList.add('hidden');
    }
}

function abilityMessage(ability) {
    return (
        {
            peek_own: 'Click one of your cards to peek',
            peek_opponent: "Click one opponent's card to peek",
            blind_switch: 'Pick your card, then an opponent\'s card',
            look_and_switch: 'Pick your card, then an opponent\'s card — swap optional',
        }[ability] || ability
    );
}

function canReturnDrawnCard() {
    if (!gameState?.hasDrawnCard || gameState.currentTurn !== myPlayerId) return false;
    const phase = gameState.phase;
    return phase !== 'init_peek' && phase !== 'scoring';
}

function returnDrawnCard() {
    if (!canReturnDrawnCard()) return;
    const dc = gameState?.drawnCard;
    if (dc?.card) {
        $('#drawnCardArea')?.classList.add('hidden');
        flyCardToDiscard(dc.card, { fromEl: $('#drawnCardArea'), holdMs: 500 });
    }
    sendAction('return_card');
}

function bindDrawnCardReturnUI() {
    const pile = $('#discardPile');
    const area = $('#drawnCardArea');
    if (!pile || pile.dataset.returnBound) return;
    pile.dataset.returnBound = '1';

    pile.addEventListener('dragover', (e) => {
        if (!canReturnDrawnCard()) return;
        e.preventDefault();
        pile.classList.add('discard-drop-active');
    });
    pile.addEventListener('dragleave', () => pile.classList.remove('discard-drop-active'));
    pile.addEventListener('drop', (e) => {
        e.preventDefault();
        pile.classList.remove('discard-drop-active');
        returnDrawnCard();
    });

    if (area && !area.dataset.dragBound) {
        area.dataset.dragBound = '1';
        area.addEventListener('dragstart', (e) => {
            const display = e.target.closest('.drawn-card-display');
            if (!display || !canReturnDrawnCard()) {
                e.preventDefault();
                return;
            }
            e.dataTransfer.setData('text/plain', 'drawn');
            e.dataTransfer.effectAllowed = 'move';
            display.classList.add('dragging');
            pile.classList.add('discard-drop-target');
        });
        area.addEventListener('dragend', (e) => {
            const display = e.target.closest('.drawn-card-display');
            if (display) display.classList.remove('dragging');
            pile.classList.remove('discard-drop-target', 'discard-drop-active');
        });
    }
}

function renderGame(dealAnim = false) {
    if (!gameState) return;

    const isMyTurn = gameState.currentTurn === myPlayerId;
    const phase = gameState.phase;

    $('#phaseDisplay').textContent = phase.replace(/_/g, ' ');
    $('#deckCount').textContent = `${gameState.deckRemaining} left`;

    const turnEl = $('#turnIndicator');
    const compact = isCompactLayout();
    if (phase === 'init_peek') {
        const left = gameState.initPeeksLeft ?? 2;
        turnEl.textContent = left > 0
            ? compact
                ? `Peek cards 1 & 2 (${left} left)`
                : `Peek your first two cards (${left} left)`
            : 'Waiting for others…';
        turnEl.classList.toggle('my-turn', left > 0);
    } else if (phase === 'final_round') {
        const others = (gameState.players?.length || 1) - 1;
        const name = getPlayerName(gameState.currentTurn);
        turnEl.textContent = compact
            ? name
                ? `Final round — ${name}`
                : `Final round (${others} left)`
            : name
              ? `Final round (${others} player${others === 1 ? '' : 's'} left) — ${name}'s turn`
              : `Final round — ${others} player${others === 1 ? '' : 's'} still to play`;
        turnEl.classList.toggle('my-turn', isMyTurn);
    } else if (holdingDrawnCard()) {
        turnEl.textContent = compact ? 'Tap a hand card to swap' : 'Select a hand card to swap with your draw';
        turnEl.classList.add('my-turn');
    } else if (stackWindowOpen()) {
        const rank = rankLabel(gameState.openStackRank);
        turnEl.textContent = compact
            ? `Stack ${rank} — tap a card`
            : `Stack open (${rank}) — tap any card; wrong stack draws a penalty`;
        turnEl.classList.add('my-turn');
    } else if (isMyTurn) {
        turnEl.textContent = 'Your turn';
        turnEl.classList.add('my-turn');
    } else {
        const name = getPlayerName(gameState.currentTurn);
        turnEl.textContent = name ? `${name}'s turn` : '';
        turnEl.classList.remove('my-turn');
    }

    renderDiscard();
    ensureDeckBack();
    renderDrawnCard(isMyTurn, dealAnim);
    renderSeats(dealAnim);
    renderPlayerHand(dealAnim);
    syncAbilityPromptFromState();

    const hasDrawn = gameState.hasDrawnCard;
    const canAct = isMyTurn && phase !== 'init_peek' && phase !== 'scoring';
    $('#drawDeckBtn').disabled = !canAct || hasDrawn;
    $('#drawDiscardBtn').disabled = !canAct || hasDrawn;
    const canCambio = canAct && !hasDrawn && phase === 'turns' && !gameState.pendingStackGive;
    $('#cambioBtn').disabled = !canCambio;

    $('#deckPile').onclick = canAct && !hasDrawn ? () => sendAction('draw_deck') : null;

    const canReturn = canReturnDrawnCard();
    const discardPile = $('#discardPile');
    if (discardPile) {
        discardPile.classList.toggle('discard-drop-target', canReturn);
        discardPile.onclick = canReturn ? () => returnDrawnCard() : null;
        discardPile.title = canReturn ? 'Return drawn card here (no ability)' : 'Discard pile';
    }
    bindDrawnCardReturnUI();
}

function ensureDeckBack() {
    const deckCard = $('#deckPile .card');
    if (deckCard && !deckCard.querySelector('.playing-card')) {
        deckCard.innerHTML = cardBackHtml();
    }
}

function renderDiscard() {
    const discardEl = $('#discardPile');
    if (gameState.topDiscard) {
        const isRed = cardIsRed(gameState.topDiscard);
        discardEl.innerHTML = `<div class="card card-face card-animate-in ${isRed ? 'red' : ''}">${cardFaceHtml(gameState.topDiscard)}</div><span class="pile-label">DISCARD</span>`;
    } else {
        discardEl.innerHTML = '<div class="card card-empty"></div><span class="pile-label">DISCARD</span>';
    }
}

function renderDrawnCard(isMyTurn, anim) {
    const area = $('#drawnCardArea');
    const hintEl = $('#drawnAbilityHint');
    const swapBtn = $('#drawnSwapBtn');
    const playBtn = $('#drawnPlayBtn');

    if (gameState.drawnCard && isMyTurn) {
        const animatingDraw = layerHasActiveFlight();
        const compact = isCompactLayout();
        if (animatingDraw) {
            area.classList.add('hidden');
        } else {
            area.classList.remove('hidden');
        }
        const dc = gameState.drawnCard;
        const isRed = cardIsRed(dc.card);
        const display = area.querySelector('.drawn-card-display');
        display.className = `drawn-card-display ${isRed ? 'red' : ''}`;
        display.draggable = true;
        display.innerHTML = cardFaceHtml(dc.card);
        if (!compact && dc.points != null) {
            display.title = `${dc.card} · ${dc.points} pts`;
        } else {
            display.title = dc.card;
        }

        if (dc.hasAbility && dc.abilityHint) {
            hintEl.textContent = compact
                ? `${dc.abilityHint} — or tap discard to return`
                : `${dc.abilityHint} — or drag / tap discard to return without using`;
            hintEl.classList.remove('hidden');
        } else {
            hintEl.textContent = compact
                ? 'Tap discard pile to return'
                : 'Drag or tap the discard pile to return this card';
            hintEl.classList.remove('hidden');
        }

        playBtn.textContent = dc.hasAbility ? 'Use ability' : 'Discard';
        swapBtn.disabled = selectedSlot === null;
    } else {
        area.classList.add('hidden');
    }
}

function renderSeats(dealAnim) {
    const container = $('#seats');
    if (!container) return;
    container.innerHTML = '';

    const opponents = gameState.players.filter((p) => p.id !== myPlayerId);

    opponents.forEach((opp, idx) => {
        const pos = SEAT_POSITIONS[idx % SEAT_POSITIONS.length];
        const isActive = opp.id === gameState.currentTurn;
        const seat = document.createElement('div');
        seat.className = 'seat' + (isActive ? ' active-turn' : '') + (opp.calledCambio ? ' cambio' : '');
        seat.dataset.player = opp.id;
        seat.style.left = `${pos.x}%`;
        seat.style.top = `${pos.y}%`;

        const initials = opp.name.slice(0, 2).toUpperCase();
        let handHtml = '';
        opp.hand.forEach((slot, i) => {
            if (!slot.hasCard) {
                handHtml += '<div class="card" style="visibility:hidden"></div>';
                return;
            }
            if (opp.calledCambio && slot.card) {
                const isRed = cardIsRed(slot.card);
                let cls = `card card-face cambio-revealed ${isRed ? 'red' : ''}`;
                if (dealAnim) cls += ' card-animate-in';
                handHtml += `<div class="${cls}" data-opponent="${opp.id}" data-slot="${i}">${cardFaceHtml(slot.card, { compact: true })}</div>`;
                return;
            }

            const abilityClick =
                pendingAbility === 'peek_opponent' ||
                pendingAbility === 'blind_switch' ||
                pendingAbility === 'look_and_switch';
            const mem = opponentStackMemory(opp.id, i);
            const stackHere = canAttemptStackOpponent(opp.id, i);
            const stackMatch = canStackOpponentCard(opp.id, i);

            if (stackHere && mem) {
                const rankText = rankLabel(mem.rank);
                const opacity = 0.35 + mem.strength * 0.55;
                let cls = 'card card-face memory-fade stackable-opponent clickable';
                if (stackMatch) cls += ' stackable-opponent-match';
                if (dealAnim) cls += ' card-animate-in';
                const title = stackMatch
                    ? `Remembered ${rankText} — tap to stack on discard`
                    : `Remembered ${rankText} — tap to stack (wrong = penalty)`;
                handHtml += `<div class="${cls}" data-opponent="${opp.id}" data-slot="${i}" style="opacity:${opacity}" title="${escapeHtml(title)}">${cardFaceHtml(rankText, { rankOnly: true })}</div>`;
                return;
            }

            let cls = 'card card-back';
            if (abilityClick) cls += ' clickable';
            if (dealAnim) cls += ' card-animate-in';
            handHtml += `<div class="${cls}" data-opponent="${opp.id}" data-slot="${i}">${cardBackHtml()}</div>`;
        });

        seat.innerHTML = `
            <div class="seat-avatar">${escapeHtml(initials)}</div>
            <span class="seat-name">${escapeHtml(opp.name)}</span>
            <div class="seat-hand">${handHtml}</div>`;
        container.appendChild(seat);
    });

    container.querySelectorAll('[data-opponent]').forEach((card) => {
        card.addEventListener('click', () => {
            handleOpponentCardClick(card.dataset.opponent, parseInt(card.dataset.slot, 10));
        });
    });
}

function renderPlayerHand(dealAnim) {
    const container = $('#playerHand');
    container.innerHTML = '';
    const me = gameState.players.find((p) => p.id === myPlayerId);
    if (!me) return;

    const phase = gameState.phase;
    const initMask = gameState.initPeekMask ?? 0;

    me.hand.forEach((slot, i) => {
        const card = document.createElement('div');
        const mem = getMemory(myPlayerId, i);

        if (!slot.hasCard) {
            card.className = 'card';
            card.style.visibility = 'hidden';
        } else if (slot.card && (slot.revealed || slot.known)) {
            const isRed = cardIsRed(slot.card);
            const revealed = slot.revealed ? ' cambio-revealed' : ' known';
            card.className = `card${revealed} clickable card-face ${isRed ? 'red' : ''}`;
            if (dealAnim) card.classList.add('card-animate-in');
            card.innerHTML = cardFaceHtml(slot.card);
        } else if (mem && mem.strength >= MEMORY_RECALL_MIN) {
            card.className = 'card memory-fade clickable card-face';
            card.style.opacity = String(0.35 + mem.strength * 0.55);
            card.innerHTML = cardFaceHtml(rankLabel(mem.rank), { rankOnly: true });
            if (dealAnim) card.classList.add('card-animate-in');
        } else {
            card.className = 'card card-back clickable' + (dealAnim ? ' card-animate-in' : '');
            card.innerHTML = cardBackHtml();
        }

        if (phase === 'init_peek') {
            if (i > 1) {
                card.classList.add('init-peek-disabled');
                card.classList.remove('clickable');
            } else if ((initMask & (1 << i)) !== 0) {
                card.classList.add('init-peek-done');
            } else {
                card.classList.add('init-peek-hint');
            }
        }
        if (canAttemptSnapOwn(i, slot)) {
            card.classList.add('stackable-own');
            if (canSnapOwnCard(i, slot)) card.classList.add('stackable-own-match');
            card.title = canSnapOwnCard(i, slot)
                ? 'Tap to stack on discard'
                : 'Tap to attempt stack (wrong = penalty card)';
        } else if (holdingDrawnCard() && slot.hasCard) {
            card.title = 'Tap to swap with drawn card';
        }
        if (gameState.pendingStackGive && slot.hasCard) {
            card.classList.add('stack-give-pick');
            card.title = 'Click to give this card to your opponent';
        }
        if (i === selectedSlot) card.classList.add('selected');

        card.dataset.slot = String(i);
        card.addEventListener('click', () => handleOwnCardClick(i, card));
        container.appendChild(card);
    });
}

function handleOwnCardClick(slot, cardEl) {
    const phase = gameState.phase;
    const me = gameState.players.find((p) => p.id === myPlayerId);
    const slotData = me?.hand?.[slot];

    if (gameState.pendingStackGive) {
        sendAction('stack_give', { slot });
        return;
    }
    if (phase === 'init_peek') {
        if (slot > 1) return;
        const mask = gameState.initPeekMask ?? 0;
        if (mask & (1 << slot)) return;
        sendAction('init_peek', { slot });
        return;
    }
    if (pendingAbility === 'peek_own') {
        sendAction('peek_own', { slot });
        return;
    }
    if (pendingAbility === 'look_and_switch') {
        const ls = gameState.lookSwitch || {};
        if (ls.mySlot == null || ls.mySlot < 0) {
            sendAction('look_switch_own', { slot });
            selectedSlot = null;
            return;
        }
    }
    if (pendingAbility === 'blind_switch') {
        selectedSlot = slot;
        renderPlayerHand();
        return;
    }
    if (holdingDrawnCard()) {
        selectedSlot = slot;
        renderPlayerHand();
        renderDrawnCard(true, false);
        return;
    }
    if (slotData && canAttemptSnapOwn(slot, slotData)) {
        const label = slotData.card || rankLabel(slotRankForSnap(slot, slotData)) || '?';
        flyCardToDiscard(label, { fromEl: cardEl });
        sendAction('snap', { slot });
        return;
    }

    selectedSlot = slot;
    renderPlayerHand();
}

function handleOpponentCardClick(targetId, targetSlot) {
    if (canAttemptStackOpponent(targetId, targetSlot)) {
        sendAction('stack_opponent', { targetId, targetSlot });
        return;
    }
    if (pendingAbility === 'peek_opponent') {
        sendAction('peek_opponent', { targetId, targetSlot });
        return;
    }
    if (pendingAbility === 'blind_switch' && selectedSlot !== null) {
        sendAction('blind_switch', { slot: selectedSlot, targetId, targetSlot });
        pendingAbility = null;
        selectedSlot = null;
        $('#abilityPrompt').classList.add('hidden');
        return;
    }
    if (pendingAbility === 'look_and_switch') {
        const ls = gameState.lookSwitch || {};
        if ((ls.mySlot == null || ls.mySlot < 0) || ls.peekDone) {
            return;
        }
        sendAction('look_switch_peek', { targetId, targetSlot });
        return;
    }
}

function sendAction(action, data = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        toast('Not connected — wait for reconnect', true);
        return;
    }
    ws.send(JSON.stringify({ action, data }));
    if (action === 'swap_card' || action === 'discard' || action === 'use_card' || action === 'return_card') selectedSlot = null;
}

function skipAbility() {
    if (pendingAbility === 'look_and_switch') sendAction('decline_switch');
    pendingAbility = null;
    selectedSlot = null;
    $('#abilityPrompt').classList.add('hidden');
}

function confirmLookSwitch() {
    const ls = gameState?.lookSwitch;
    if (!ls?.peekDone) return;
    sendAction('look_switch', {
        slot: ls.mySlot,
        targetId: ls.targetId,
        targetSlot: ls.targetSlot,
    });
    pendingAbility = null;
    selectedSlot = null;
    $('#abilityPrompt').classList.add('hidden');
}

function checkGameOver() {
    if (gameState?.phase !== 'scoring') return;
    const scores = gameState.scores;
    if (!scores || Object.keys(scores).length === 0) return;
    clearSession();
    showScores(scores);
}

function showScores(scores) {
    const overlay = $('#scoresOverlay');
    const entries = Object.entries(scores || {});
    const announce = $('#winnerAnnounce');
    const nameEl = $('#winnerName');
    const scoreEl = $('#winnerScore');
    if (entries.length === 0) {
        if (announce) announce.classList.add('hidden');
        $('#scoreBoard').innerHTML = '<p class="games-empty">No scores recorded.</p>';
        overlay?.classList.remove('hidden');
        return;
    }
    const sorted = entries.sort((a, b) => a[1] - b[1]);
    const lowest = sorted[0][1];
    const winners = sorted.filter(([, score]) => score === lowest);
    const winnerNames = winners.map(([pid]) => getPlayerName(pid)).join(' & ');

    if (announce && nameEl && scoreEl) {
        announce.classList.remove('hidden');
        nameEl.textContent = winnerNames;
        scoreEl.textContent =
            winners.length > 1
                ? `Tied at ${lowest} points`
                : `${lowest} point${lowest === 1 ? '' : 's'}`;
    }

    $('#scoreBoard').innerHTML = sorted
        .map(([pid, score]) => {
            const name = getPlayerName(pid);
            const win = score === lowest;
            return `<div class="score-row ${win ? 'winner' : ''}">
                <span>${escapeHtml(name)}${win ? ' ★' : ''}</span>
                <span class="score-value">${score}</span>
            </div>`;
        })
        .join('');
    overlay?.classList.remove('hidden');
}

function getPlayerName(playerId) {
    const p = gameState?.players?.find((x) => x.id === playerId);
    return p ? p.name : playerId;
}

function formatAbility(ability) {
    return (
        {
            peek_opponent: 'Peek opponent',
            peek_own: 'Peek own',
            blind_switch: 'Blind switch',
            look_and_switch: 'Look & switch',
        }[ability] || ability
    );
}

$('#drawnSwapBtn').addEventListener('click', () => {
    if (selectedSlot === null) return toast('Select a card in your hand first', true);
    sendAction('swap_card', { slot: selectedSlot });
});

$('#drawnPlayBtn').addEventListener('click', () => {
    const dc = gameState?.drawnCard;
    sendAction(dc?.hasAbility ? 'use_card' : 'discard');
});

$('#drawDeckBtn').addEventListener('click', () => sendAction('draw_deck'));
$('#drawDiscardBtn').addEventListener('click', () => sendAction('draw_discard'));
$('#cambioBtn').addEventListener('click', () => sendAction('call_cambio'));

$('#abilitySkipBtn').addEventListener('click', skipAbility);
$('#abilityConfirmBtn').addEventListener('click', confirmLookSwitch);
$('#quitGameBtn')?.addEventListener('click', quitSoloGame);
$('#leaveWaitingBtn')?.addEventListener('click', leaveWaitingRoom);

// Boot: URL param, session restore, games poll
(function init() {
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    if (room) $('#gameIdInput').value = room;

    const saved = sessionStorage.getItem('cambio_session');
    if (saved) {
        try {
            const s = JSON.parse(saved);
            if (s.playerName) $('#playerName').value = s.playerName;
            if (s.gameId) {
                if (room) $('#gameIdInput').value = room;
                else if (s.gameId) {
                    $('#gameIdInput').value = s.gameId;
                    setRoomURL(s.gameId);
                }
                soloSession = !!s.solo;
                currentGameId = s.gameId;
                currentPlayerName = s.playerName;
                myPlayerId = s.playerId;
                connectWS(s.gameId, s.playerName, s.playerId);
            }
        } catch {
            /* ignore */
        }
    }

    fetch('/api/games')
        .then(() => setConnectionStatus('online'))
        .catch(() => setConnectionStatus('offline'));

    startGamesPoll();
    ensureDeckBack();
})();

window.addEventListener(
    'resize',
    () => {
        if (gameState && document.querySelector('#game.active')) renderGame();
    },
    { passive: true },
);

document.addEventListener(
    'touchmove',
    (e) => {
        if (!document.body.classList.contains('in-game')) return;
        if (e.target.closest('.scores-overlay-panel')) return;
        e.preventDefault();
    },
    { passive: false },
);

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}
