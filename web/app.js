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
    if (id === 'lobby') startGamesPoll();
    else stopGamesPoll();
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

function canStackOpponentCard(targetId, slotIdx) {
    if (!gameState || gameState.phase === 'init_peek' || gameState.phase === 'scoring') return false;
    if (gameState.currentTurn !== myPlayerId || gameState.hasDrawnCard) return false;
    if (pendingAbility && pendingAbility !== 'none') return false;
    const mem = getMemory(targetId, slotIdx);
    if (!mem || mem.strength < MEMORY_RECALL_MIN || gameState.topDiscardRank === undefined) return false;
    return mem.rank === gameState.topDiscardRank;
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
            toast(evtData.source === 'deck' ? 'Drew from deck' : `Drew ${evtData.card}`, false);
            break;
        case 'card_swapped':
            toast(`${getPlayerName(evtPlayer)} swapped a card`);
            break;
        case 'card_discarded':
            toast(
                `Discarded ${evtData.card}` + (evtData.ability !== 'none' ? ` → ${formatAbility(evtData.ability)}` : ''),
            );
            break;
        case 'card_returned':
            toast(`Returned ${evtData.card} to discard`, false);
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
            toast('Switch declined — blind switch required', true);
            pendingAbility = 'blind_switch';
            syncAbilityPromptFromState();
            break;
        case 'cambio_called':
            toast(`${evtData.message} — one final round for everyone else.`, true);
            break;
        case 'snap_success':
            toast(`${getPlayerName(evtPlayer)} stacked ${evtData.card}!`, true);
            break;
        case 'snap_failed':
            toast(evtData.message);
            break;
        case 'stack_opponent_success':
            toast(`Stacked opponent's ${evtData.card}!`, true);
            break;
        case 'stack_opponent_failed':
            toast(evtData.message);
            break;
        case 'game_over':
            toast('Hand complete!', true);
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
    const prompt = $('#abilityPrompt');

    if (isMyTurn && pa && pa !== 'none' && phase !== 'init_peek' && phase !== 'scoring') {
        pendingAbility = pa;
        prompt?.classList.remove('hidden');
        $('#abilityText').textContent = abilityMessage(pa, gameState.peekOpponentRemaining);
        const skip = $('#abilitySkipBtn');
        if (pa === 'look_and_switch') {
            skip.textContent = 'Decline Switch';
            skip.classList.remove('hidden');
        } else {
            skip.classList.add('hidden');
        }
    } else {
        pendingAbility = null;
        prompt?.classList.add('hidden');
    }
}

function abilityMessage(ability, peekRem) {
    const messages = {
        peek_own: 'Click one of your cards to peek',
        peek_opponent: "Click an opponent's card to peek",
        blind_switch: 'Pick your card, then an opponent\'s card',
        look_and_switch: 'Pick your card, then an opponent\'s card to look & switch',
    };
    let base = messages[ability] || ability;
    if (ability === 'peek_opponent' && peekRem > 0) base += ` (${peekRem} left)`;
    return base;
}

function canReturnDrawnCard() {
    if (!gameState?.hasDrawnCard || gameState.currentTurn !== myPlayerId) return false;
    const phase = gameState.phase;
    return phase !== 'init_peek' && phase !== 'scoring';
}

function returnDrawnCard() {
    if (!canReturnDrawnCard()) return;
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
    if (phase === 'init_peek') {
        const left = gameState.initPeeksLeft ?? 2;
        turnEl.textContent = left > 0 ? `Peek your first two cards (${left} left)` : 'Waiting for others…';
        turnEl.classList.toggle('my-turn', left > 0);
    } else if (isMyTurn) {
        turnEl.textContent = 'Your turn';
        turnEl.classList.add('my-turn');
    } else {
        const name = getPlayerName(gameState.currentTurn);
        turnEl.textContent = name ? `${name}'s turn` : '';
        turnEl.classList.remove('my-turn');
    }

    renderDiscard();
    renderDrawnCard(isMyTurn, dealAnim);
    renderSeats(dealAnim);
    renderPlayerHand(dealAnim);
    syncAbilityPromptFromState();

    const hasDrawn = gameState.hasDrawnCard;
    const canAct = isMyTurn && phase !== 'init_peek' && phase !== 'scoring';
    $('#drawDeckBtn').disabled = !canAct || hasDrawn;
    $('#drawDiscardBtn').disabled = !canAct || hasDrawn;
    const canCambio = canAct && !hasDrawn && phase === 'turns';
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

function renderDiscard() {
    const discardEl = $('#discardPile');
    if (gameState.topDiscard) {
        const isRed = gameState.topDiscard.includes('♥') || gameState.topDiscard.includes('♦');
        discardEl.innerHTML = `<div class="card card-face card-animate-in ${isRed ? 'red' : ''}">${escapeHtml(gameState.topDiscard)}</div>`;
    } else {
        discardEl.innerHTML = '<div class="card card-empty"><span class="card-label">DISCARD</span></div>';
    }
}

function renderDrawnCard(isMyTurn, anim) {
    const area = $('#drawnCardArea');
    const hintEl = $('#drawnAbilityHint');
    const swapBtn = $('#drawnSwapBtn');
    const playBtn = $('#drawnPlayBtn');

    if (gameState.drawnCard && isMyTurn) {
        area.classList.remove('hidden');
        const dc = gameState.drawnCard;
        const isRed = dc.card.includes('♥') || dc.card.includes('♦');
        const display = area.querySelector('.drawn-card-display');
        display.className = `drawn-card-display ${isRed ? 'red' : ''} ${anim ? 'card-animate-draw' : 'card-animate-in'}`;
        display.draggable = true;
        $('#drawnCardValue').textContent = `${dc.card} · ${dc.points}`;

        if (dc.hasAbility && dc.abilityHint) {
            hintEl.textContent = `${dc.abilityHint} — or drag / tap discard to return without using`;
            hintEl.classList.remove('hidden');
        } else {
            hintEl.textContent = 'Drag or tap the discard pile to return this card';
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
        seat.style.left = `${pos.x}%`;
        seat.style.top = `${pos.y}%`;

        const initials = opp.name.slice(0, 2).toUpperCase();
        let handHtml = '';
        opp.hand.forEach((slot, i) => {
            if (!slot.hasCard) {
                handHtml += '<div class="card card-small" style="visibility:hidden"></div>';
                return;
            }
            const abilityClick =
                pendingAbility === 'peek_opponent' ||
                pendingAbility === 'blind_switch' ||
                pendingAbility === 'look_and_switch';
            const stackHere = canStackOpponentCard(opp.id, i);
            let cls = 'card card-back card-small';
            if (abilityClick) cls += ' clickable';
            if (stackHere) cls += ' stackable-opponent';
            if (dealAnim) cls += ' card-animate-in';
            const stackTitle = stackHere ? ' title="Click to stack on discard"' : '';
            handHtml += `<div class="${cls}" data-opponent="${opp.id}" data-slot="${i}"${stackTitle}></div>`;
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
        } else if (slot.known && slot.card) {
            const isRed = slot.card.includes('♥') || slot.card.includes('♦');
            card.className = `card known clickable card-face ${isRed ? 'red' : ''}`;
            if (dealAnim) card.classList.add('card-animate-in');
            card.textContent = slot.card;
        } else if (mem && mem.strength >= MEMORY_RECALL_MIN) {
            card.className = 'card memory-fade clickable card-face';
            card.style.opacity = String(0.35 + mem.strength * 0.55);
            card.textContent = rankLabel(mem.rank);
            if (dealAnim) card.classList.add('card-animate-in');
        } else {
            card.className = 'card card-back clickable' + (dealAnim ? ' card-animate-in' : '');
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
        if (i === selectedSlot) card.classList.add('selected');

        card.dataset.slot = String(i);
        card.addEventListener('click', () => handleOwnCardClick(i));
        card.addEventListener('dblclick', (ev) => {
            ev.preventDefault();
            if (phase !== 'turns' && phase !== 'final_round') return;
            if (gameState.currentTurn !== myPlayerId || gameState.hasDrawnCard) return;
            if (!slot.hasCard) return;
            sendAction('snap', { slot: i });
        });
        container.appendChild(card);
    });
}

function handleOwnCardClick(slot) {
    const phase = gameState.phase;
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
    if (gameState.hasDrawnCard && gameState.currentTurn === myPlayerId) {
        selectedSlot = slot;
        renderPlayerHand();
        renderDrawnCard(true, false);
        return;
    }
    if (pendingAbility === 'blind_switch' || pendingAbility === 'look_and_switch') {
        selectedSlot = slot;
        renderPlayerHand();
        return;
    }
    selectedSlot = slot;
    renderPlayerHand();
}

function handleOpponentCardClick(targetId, targetSlot) {
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
    if (pendingAbility === 'look_and_switch' && selectedSlot !== null) {
        sendAction('look_switch', { slot: selectedSlot, targetId, targetSlot });
        pendingAbility = null;
        selectedSlot = null;
        $('#abilityPrompt').classList.add('hidden');
        return;
    }
    if (canStackOpponentCard(targetId, targetSlot)) {
        sendAction('stack_opponent', { targetId, targetSlot });
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
    $('#abilityPrompt').classList.add('hidden');
}

function checkGameOver() {
    if (gameState?.phase === 'scoring' && gameState.scores) {
        clearSession();
        showScores(gameState.scores);
    }
}

function showScores(scores) {
    showScreen('scores');
    const entries = Object.entries(scores || {});
    if (entries.length === 0) {
        $('#scoreBoard').innerHTML = '<p class="games-empty">No scores recorded.</p>';
        return;
    }
    const sorted = entries.sort((a, b) => a[1] - b[1]);
    const lowest = sorted[0][1];
    $('#scoreBoard').innerHTML = sorted
        .map(([pid, score]) => {
            const name = getPlayerName(pid);
            const win = score === lowest;
            return `<div class="score-row ${win ? 'winner' : ''}">
                <span>${escapeHtml(name)} ${win ? '★' : ''}</span>
                <span class="score-value">${score}</span>
            </div>`;
        })
        .join('');
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
})();
