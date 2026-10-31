import {
  checkServerReachable,
  createGame,
  fetchOpenGames,
  GameConnection,
  rankLabel,
  SERVER_UNREACHABLE_MSG,
  startSoloGame,
  startTutorialPractice,
} from './api.js';
import { createCardAnimations } from './ui/cardAnimations.js';
import { createOverlay } from './ui/overlay.js';
import { createPokerTable } from './ui/pokerTable.js';
import { createRulesModal } from './ui/rulesModal.js';
import { createTutorialCoach } from './ui/tutorialCoach.js';
import { resolveGuidedHint } from './tutorial/guided.js';
import {
  applyScriptAction,
  getScriptState,
  getScriptStep,
  matchesScriptExpect,
  scriptStepCount,
  TUTORIAL_PLAYER,
} from './tutorial/script.js';

const ui = createOverlay();
const table = createPokerTable();
const rulesModal = createRulesModal();
const coach = createTutorialCoach();
Object.assign(ui.els, table.gameEls);
const cardAnims = createCardAnimations(
  table.getAnimationRefs(() => {
    if (gameState) table.syncState(gameState, myPlayerId);
  }),
);
const conn = new GameConnection({
  onMessage: handleMessage,
  onStatus: (s) => ui.setConnection(s),
});

let gameState = null;
let myPlayerId = null;
let currentGameId = null;
let soloSession = false;
let mode = 'menu';
let gamesPollTimer = null;
let mainMenuOpen = true;
let lastTurnPlayer = null;
let pendingDrawnCard = null;
let tutorialPhase = null;
let scriptStepIndex = 0;
let lastGuidedHintKey = '';

const PLAYER_NAME_KEY = 'cambio_player_name';

function isTutorialScript() {
  return tutorialPhase === 'script';
}

function isTutorialGuided() {
  return tutorialPhase === 'guided';
}

function inTutorial() {
  return tutorialPhase != null;
}

function openRules(sectionId) {
  rulesModal.open(sectionId || null);
}

function showScriptStep(index) {
  const step = getScriptStep(index);
  if (!step) return;
  gameState = getScriptState(index);
  syncTable();
  coach.show(step, { index, total: scriptStepCount(), mode: 'script' });
}

function advanceScriptStep() {
  scriptStepIndex += 1;
  if (scriptStepIndex >= scriptStepCount()) {
    finishScriptTutorial();
    return;
  }
  showScriptStep(scriptStepIndex);
}

function finishScriptTutorial() {
  coach.hide();
  ui.toast('Starting guided practice…');
  startGuidedPractice();
}

function handleTutorialAction(action, data = {}) {
  if (!isTutorialScript()) return;
  const step = getScriptStep(scriptStepIndex);
  if (!step) return;

  if (step.type === 'info') return;

  if (!matchesScriptExpect(step, action, data)) {
    ui.toast('Follow the highlighted step first');
    return;
  }

  gameState = applyScriptAction(scriptStepIndex, action, data);
  table.resetSelection();
  advanceScriptStep();
}

function enterTutorialScript() {
  const name = playerName() || 'Guest';
  syncPlayerName(name);
  tutorialPhase = 'script';
  scriptStepIndex = 0;
  soloSession = false;
  mainMenuOpen = false;
  prepareForSoloPlay();
  myPlayerId = TUTORIAL_PLAYER;
  gameState = getScriptState(0);
  mode = 'tutorial-script';
  ui.showGameHud(true);
  table.show(true);
  showScriptStep(0);
}

async function startGuidedPractice() {
  const name = playerName() || 'Guest';
  syncPlayerName(name);
  tutorialPhase = 'guided';
  scriptStepIndex = 0;
  lastGuidedHintKey = '';
  coach.hide();
  await updateServerHint();
  try {
    const data = await startTutorialPractice(name);
    soloSession = true;
    prepareForSoloPlay();
    joinGame(data.gameId, name, data.playerId);
  } catch (e) {
    tutorialPhase = null;
    ui.toast(e.message);
    showMainMenuScreen();
  }
}

function exitTutorial() {
  if (isTutorialGuided()) {
    conn.disconnect(true);
  }
  tutorialPhase = null;
  scriptStepIndex = 0;
  lastGuidedHintKey = '';
  coach.hide();
}

function updateGuidedCoach() {
  if (!isTutorialGuided() || !gameState) return;
  const hint = resolveGuidedHint(gameState, myPlayerId);
  if (!hint) return;
  const key = `${hint.title}:${hint.body}`;
  if (key === lastGuidedHintKey) return;
  lastGuidedHintKey = key;
  coach.show(
    { ...hint, type: 'info' },
    { index: 0, total: 1, mode: 'guided' },
  );
}

coach.setHandlers({
  back: () => {
    if (!isTutorialScript() || scriptStepIndex <= 0) return;
    scriptStepIndex -= 1;
    showScriptStep(scriptStepIndex);
  },
  skip: () => {
    if (inTutorial()) {
      exitTutorial();
      gameState = null;
      myPlayerId = null;
      currentGameId = null;
      soloSession = false;
      table.show(false);
      table.resetSelection();
      showMainMenuScreen();
    }
  },
  continueFn: () => {
    if (!isTutorialScript()) return;
    advanceScriptStep();
  },
  rules: () => {
    const step = isTutorialScript() ? getScriptStep(scriptStepIndex) : null;
    openRules(step?.rulesSection);
  },
});

table.setCallbacks({
  onAction: (action, data) => {
    if (isTutorialScript()) {
      handleTutorialAction(action, data);
      return;
    }
    conn.sendAction(action, data);
    if (
      action === 'swap_card' ||
      action === 'discard' ||
      action === 'use_card' ||
      action === 'return_card' ||
      action === 'snap' ||
      action === 'stack_opponent' ||
      action === 'stack_give'
    ) {
      table.resetSelection();
    }
  },
  onDrawDeck: () => {
    if (isTutorialScript()) {
      handleTutorialAction('draw_deck', {});
      return;
    }
    if (canDrawDeck()) conn.sendAction('draw_deck');
  },
  onDrawDiscard: () => {
    if (isTutorialScript()) {
      handleTutorialAction('draw_discard', {});
      return;
    }
    if (canDrawDiscard()) conn.sendAction('draw_discard');
  },
  onPlayAgain: () => leaveToLobby(),
});

function playerName() {
  const fromWelcome = ui.els.playerName.value.trim();
  const fromMenu = ui.mainMenu.els.menuPlayerNameInput.value.trim();
  return fromWelcome || fromMenu;
}

function syncPlayerName(name) {
  ui.els.playerName.value = name;
  ui.mainMenu.setPlayerName(name);
  if (name) localStorage.setItem(PLAYER_NAME_KEY, name);
}

async function updateMenuServerStatus() {
  const ok = await checkServerReachable();
  ui.mainMenu.setServerStatus(ok);
  if (!ok) ui.mainMenu.setServerHint(SERVER_UNREACHABLE_MSG);
}

function enterLobbyFromMenu() {
  const name = playerName();
  if (name) syncPlayerName(name);
  soloSession = false;
  mainMenuOpen = false;
  mode = 'lobby';
  ui.showMainMenu(false);
  ui.showWelcome(true);
  updateServerHint();
  startGamesPoll();
}

function showMainMenuScreen() {
  exitTutorial();
  mainMenuOpen = true;
  soloSession = false;
  mode = 'menu';
  stopGamesPoll();
  ui.showWelcome(false);
  ui.showTablePrompt(false);
  ui.showWaiting(false);
  ui.showGameHud(false);
  table.show(false);
  ui.showMainMenu(true);
  ui.hudTop.classList.add('menu-mode');
  updateMenuServerStatus();
}

async function updateServerHint() {
  const ok = await checkServerReachable();
  ui.setServerHint(!ok);
  return ok;
}

function renderGamesList(games) {
  const list = ui.els.gamesList;
  if (!list) return;
  const open = games ?? [];
  if (open.length === 0) {
    list.innerHTML = '<p class="games-empty">No open tables — create one!</p>';
    return;
  }
  list.innerHTML = open
    .map(
      (g) => `<div class="game-row">
        <span><strong>${escapeHtml(g.id)}</strong> · ${g.playerCount}/${g.maxPlayers}</span>
        <button type="button" class="secondary" data-join="${escapeHtml(g.id)}">Join</button>
      </div>`,
    )
    .join('');
  list.querySelectorAll('[data-join]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.els.gameIdInput.value = btn.dataset.join;
      ui.els.joinOnlineBtn.click();
    });
  });
}

async function refreshGames() {
  const games = await fetchOpenGames();
  renderGamesList(games);
}

function startGamesPoll() {
  refreshGames();
  stopGamesPoll();
  gamesPollTimer = setInterval(refreshGames, 4000);
}

function stopGamesPoll() {
  if (gamesPollTimer) clearInterval(gamesPollTimer);
  gamesPollTimer = null;
}

function soloBotCount(fromMenu = false) {
  if (fromMenu) {
    const n = parseInt(ui.mainMenu.els.menuSoloBotCount?.value, 10);
    return Math.min(5, Math.max(1, Number.isNaN(n) ? 2 : n));
  }
  const n = parseInt(ui.els.botCount?.value, 10);
  return Math.min(5, Math.max(1, Number.isNaN(n) ? 2 : n));
}

function prepareForSoloPlay() {
  mainMenuOpen = false;
  stopGamesPoll();
  ui.showMainMenu(false);
  ui.showWelcome(false);
  ui.showTablePrompt(false);
  ui.showWaiting(false);
  ui.hudTop.classList.remove('menu-mode');
}

async function startSoloSession(fromMenu = false) {
  const name = playerName();
  if (!name) return ui.toast('Enter your name');
  syncPlayerName(name);
  await updateServerHint();
  try {
    const data = await startSoloGame(name, soloBotCount(fromMenu));
    soloSession = true;
    prepareForSoloPlay();
    joinGame(data.gameId, name, data.playerId);
  } catch (e) {
    ui.toast(e.message);
  }
}

function joinOnlineFromMenu() {
  const name = playerName();
  if (!name) return ui.toast('Enter your name');
  const gameId = ui.els.gameIdInput.value.trim();
  if (!gameId) return ui.toast('Enter a room code');
  soloSession = false;
  const pid = `p-${Date.now().toString(36)}`;
  joinGame(gameId, name, pid);
}

ui.els.soloBtn.addEventListener('click', () => startSoloSession());

ui.els.createOnlineBtn.addEventListener('click', async () => {
  const name = playerName();
  if (!name) return ui.toast('Enter your name');
  await updateServerHint();
  try {
    const maxPlayers = parseInt(ui.els.maxPlayers.value, 10) || 4;
    const data = await createGame(name, maxPlayers);
    soloSession = false;
    joinGame(data.gameId, name, data.playerId);
  } catch (e) {
    ui.toast(e.message);
  }
});

ui.els.joinOnlineBtn.addEventListener('click', () => joinOnlineFromMenu());
ui.els.refreshGamesBtn.addEventListener('click', () => refreshGames());
ui.els.startGameBtn.addEventListener('click', () => conn.startGame());
ui.els.leaveWaitingBtn.addEventListener('click', () => leaveToLobby());
ui.els.leaveGameBtn.addEventListener('click', () => leaveToLobby());
ui.els.rulesGameBtn?.addEventListener('click', () => openRules());

ui.els.drawDeckBtn.addEventListener('click', () => {
  if (isTutorialScript()) {
    handleTutorialAction('draw_deck', {});
    return;
  }
  if (canDrawDeck()) conn.sendAction('draw_deck');
});
ui.els.drawDiscardBtn.addEventListener('click', () => {
  if (isTutorialScript()) {
    handleTutorialAction('draw_discard', {});
    return;
  }
  if (canDrawDiscard()) conn.sendAction('draw_discard');
});
ui.els.callCambioBtn.addEventListener('click', () => {
  if (canCallCambio()) conn.sendAction('call_cambio');
});

function joinGame(gameId, name, playerId) {
  currentGameId = gameId;
  myPlayerId = playerId;
  ui.showWelcome(false);
  ui.showTablePrompt(false);
  conn.connect(gameId, name, playerId, { solo: soloSession });
}

function leaveToLobby() {
  const wasSolo = soloSession;
  const wasTutorial = inTutorial();
  if (wasTutorial) exitTutorial();
  conn.disconnect(true);
  gameState = null;
  myPlayerId = null;
  currentGameId = null;
  soloSession = false;
  lastTurnPlayer = null;
  mode = wasTutorial || wasSolo ? 'menu' : 'lobby';
  table.show(false);
  table.resetSelection();
  ui.showWaiting(false);
  ui.showGameHud(false);
  if (wasSolo || wasTutorial) {
    showMainMenuScreen();
  } else {
    ui.showWelcome(true);
    ui.hudTop.classList.remove('menu-mode');
    updateServerHint();
    startGamesPoll();
  }
}

function enterPlay() {
  mode = 'play';
  stopGamesPoll();
  ui.showWaiting(false);
  ui.showWelcome(false);
  ui.showGameHud(true);
  table.show(true);
}

function enterWaiting() {
  mode = 'waiting';
  table.show(false);
  ui.showWaiting(true);
  ui.els.waitingRoomId.textContent = currentGameId || '';
}

function hasActivePendingAbility() {
  const pa = gameState?.pendingAbility;
  return !!(pa && pa !== 'none');
}

function canDrawDeck() {
  return (
    gameState?.phase === 'turns' &&
    gameState.currentTurn === myPlayerId &&
    !gameState.hasDrawnCard &&
    !hasActivePendingAbility()
  );
}

function canDrawDiscard() {
  return canDrawDeck() && gameState?.topDiscard;
}

function canCallCambio() {
  return (
    gameState?.phase === 'turns' &&
    gameState.currentTurn === myPlayerId &&
    !gameState.hasDrawnCard &&
    !hasActivePendingAbility() &&
    !gameState.pendingStackGive
  );
}

function holdingDrawnCard() {
  return (
    gameState?.currentTurn === myPlayerId &&
    !!(gameState?.hasDrawnCard || gameState?.drawnCard?.card)
  );
}

function stackWindowOpen() {
  return (
    gameState?.phase === 'turns' &&
    gameState.openStackRank > 0 &&
    !gameState.stackRankClaimed
  );
}

function playerDisplayName(playerId) {
  return gameState?.players?.find((p) => p.id === playerId)?.name || playerId || 'Player';
}

function updateActionHud() {
  const phase = gameState?.phase ?? '—';
  const scoring = phase === 'scoring';

  ui.els.drawDeckBtn.disabled = scoring || !canDrawDeck();
  ui.els.drawDiscardBtn.disabled = scoring || !canDrawDiscard();
  ui.els.callCambioBtn.disabled = scoring || !canCallCambio();

  ui.els.phaseLabel.textContent = phase.replace(/_/g, ' ');
  ui.els.deckCountLabel.textContent =
    gameState != null ? `${gameState.deckRemaining ?? 0} left` : '';

  const isMyTurn = gameState?.currentTurn === myPlayerId;
  const turnName =
    gameState?.players?.find((p) => p.id === gameState?.currentTurn)?.name || '—';

  if (scoring) {
    ui.els.turnLabel.textContent = 'Round over';
    ui.els.turnLabel.classList.remove('my-turn');
  } else if (phase === 'init_peek') {
    const left = gameState.initPeeksLeft ?? 2;
    ui.els.turnLabel.textContent =
      left > 0
        ? `Peek your first two cards (${left} left)`
        : 'Waiting for others…';
    ui.els.turnLabel.classList.toggle('my-turn', left > 0);
  } else if (holdingDrawnCard()) {
    ui.els.turnLabel.textContent = 'Tap a hand card to swap with your draw';
    ui.els.turnLabel.classList.add('my-turn');
  } else if (stackWindowOpen()) {
    const rank = rankLabel(gameState.openStackRank);
    ui.els.turnLabel.textContent = `Stack open (${rank}) — tap a matching card`;
    ui.els.turnLabel.classList.add('my-turn');
  } else {
    ui.els.turnLabel.textContent = isMyTurn ? 'Your turn' : `Turn: ${turnName}`;
    ui.els.turnLabel.classList.toggle('my-turn', isMyTurn && phase === 'turns');
  }

  const pa = gameState?.pendingAbility;
  if (gameState?.pendingStackGive) {
    ui.els.abilityHint.textContent = 'Pick a card to give your opponent';
  } else if (pa && pa !== 'none' && gameState.currentTurn === myPlayerId) {
    ui.els.abilityHint.textContent = 'Resolve ability on the table — use prompt below';
  } else if (gameState?.phase === 'init_peek') {
    const left = gameState.initPeeksLeft ?? 2;
    ui.els.abilityHint.textContent =
      left > 0
        ? 'Tap slots 1 & 2 to peek your starting cards'
        : 'Waiting for others to finish peeking…';
  } else if (holdingDrawnCard()) {
    ui.els.abilityHint.textContent = 'Tap one of your cards to swap with the drawn card';
  } else if (stackWindowOpen()) {
    const rank = rankLabel(gameState.openStackRank);
    ui.els.abilityHint.textContent = `Stack ${rank} — tap your card or a remembered opponent card`;
  } else if (scoring) {
    ui.els.abilityHint.textContent = 'See winner below.';
  } else {
    ui.els.abilityHint.textContent = "Click your cards to peek / swap when it's your turn.";
  }
}

function renderLobby(room) {
  const players = room.players || [];
  ui.els.waitingPlayers.innerHTML = players
    .map((p) => `<p class="hint">• ${escapeHtml(p)}</p>`)
    .join('');
  if (room.maxPlayers) {
    ui.els.waitingMeta.textContent = `${room.playerCount || players.length} / ${room.maxPlayers} seated`;
  }
  const canStart = room.canStart === true;
  ui.els.startGameBtn.disabled = !canStart;
  ui.els.startHint.classList.toggle('hidden', canStart);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function syncTable() {
  if (!gameState) return;
  updateActionHud();
  table.syncState(gameState, myPlayerId);
  updateGuidedCoach();
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'connected':
      gameState = msg.state;
      if (msg.room) renderLobby(msg.room);
      if (gameState.phase !== 'waiting') {
        enterPlay();
        syncTable();
        ui.toast(soloSession ? 'Peek slots 1 & 2' : 'Connected');
      } else if (!soloSession) {
        enterWaiting();
      } else {
        enterPlay();
        syncTable();
        ui.toast('Peek slots 1 & 2');
      }
      break;
    case 'lobby_update':
      renderLobby(msg.room || { players: msg.players || [] });
      break;
    case 'game_cancelled':
      ui.toast('Host left — table closed');
      leaveToLobby();
      break;
    case 'game_started':
      gameState = msg.state;
      enterPlay();
      syncTable();
      ui.toast('Cards dealt — peek slots 1 & 2');
      break;
    case 'state_update':
      gameState = msg.state;
      syncTable();
      break;
    case 'event':
      handleEvent(msg.event);
      break;
    case 'error':
      ui.toast(`Error: ${msg.error}`);
      break;
    default:
      break;
  }
}

function handleEvent(event) {
  const type = event.type || event.Type;
  const data = event.data || event.Data;
  const pid = event.playerId || event.PlayerID;
  switch (type) {
    case 'card_drawn':
      if (pid === myPlayerId && data?.card) {
        pendingDrawnCard = data.card;
        if (data.source === 'discard') cardAnims.flyFromDiscardToDrawn(data.card);
        else cardAnims.flyFromDeck(data.card);
      }
      if (pid === myPlayerId) ui.toast('Drew a card');
      syncTable();
      break;
    case 'card_discarded':
      ui.toast(`Discarded ${data?.card || ''}`);
      if (data?.card && pid === myPlayerId) {
        cardAnims.flyToDiscard(data.card, { fromEl: table.els.drawnArea });
      }
      pendingDrawnCard = null;
      syncTable();
      break;
    case 'card_returned':
      if (data?.card) {
        cardAnims.flyToDiscard(data.card, { fromEl: table.els.drawnArea });
      }
      pendingDrawnCard = null;
      syncTable();
      break;
    case 'card_swapped':
      if (pid === myPlayerId) {
        if (pendingDrawnCard && data?.slot != null) {
          cardAnims.flyToHandSlot(pendingDrawnCard, table.els.drawnArea, data.slot);
          pendingDrawnCard = null;
        }
        if (data?.discarded) {
          cardAnims.flyToDiscard(data.discarded, {
            fromEl: table.els.playerHand.querySelector(`[data-slot="${data.slot}"]`),
          });
        }
      }
      syncTable();
      break;
    case 'card_peeked':
    case 'peeked_own':
      ui.toast(`Peeked: ${data?.card || '?'}`);
      syncTable();
      break;
    case 'cambio_called':
      ui.toast(data?.message || `${playerDisplayName(pid)} called Cambio!`);
      syncTable();
      break;
    case 'hand_cleared':
      ui.toast(data?.message || `${playerDisplayName(pid)} cleared their hand!`, true);
      syncTable();
      break;
    case 'game_over':
      syncTable();
      break;
    case 'snap_success':
      ui.toast(`Stacked ${data?.card || 'card'}!`, true);
      if (data?.card) {
        cardAnims.flyToDiscard(data.card, {
          fromEl:
            pid === myPlayerId && data.slot != null
              ? table.els.playerHand.querySelector(`[data-slot="${data.slot}"]`)
              : table.els.playerHand,
        });
      }
      syncTable();
      break;
    case 'snap_failed':
      ui.toast(data?.message || 'Wrong stack — penalty card drawn');
      syncTable();
      break;
    case 'snap_voided':
      ui.toast(data?.message || 'Stack voided — someone beat you to it.');
      syncTable();
      break;
    case 'stack_opponent_success':
      ui.toast(`Stacked opponent's ${data?.card || 'card'}! Pick a card to give them.`, true);
      if (data?.card) {
        cardAnims.flyToDiscard(data.card, { fromEl: table.els.felt });
      }
      syncTable();
      break;
    case 'stack_give_complete':
      ui.toast('Card given to opponent');
      syncTable();
      break;
    case 'stack_opponent_voided':
      ui.toast(data?.message || 'Opponent stack voided.');
      syncTable();
      break;
    case 'stack_opponent_failed':
      ui.toast(data?.message || 'Wrong opponent stack — penalty card drawn');
      syncTable();
      break;
    case 'turn_changed': {
      const next = data?.currentPlayer || gameState?.currentTurn;
      if (next && next !== lastTurnPlayer) {
        lastTurnPlayer = next;
        table.flashTurn();
      }
      syncTable();
      break;
    }
    default:
      syncTable();
      break;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode === 'play' && gameState?.phase === 'waiting') {
    leaveToLobby();
  }
});

ui.mainMenu.els.menuLearnBtn.addEventListener('click', () => {
  ui.mainMenu.showTutorial(true);
});

ui.mainMenu.els.menuTutorialStartBtn.addEventListener('click', () => enterTutorialScript());
ui.mainMenu.els.menuTutorialBackBtn.addEventListener('click', () => ui.mainMenu.showTutorial(false));
ui.mainMenu.els.menuTutorialRulesBtn.addEventListener('click', () => openRules());
ui.mainMenu.els.menuRulesBtn.addEventListener('click', () => openRules());

ui.mainMenu.els.menuSoloBtn.addEventListener('click', () => {
  const name = playerName();
  if (!name) {
    ui.toast('Set your name in Options first');
    ui.mainMenu.showOptions(true);
    return;
  }
  ui.mainMenu.showSolo(true);
});

ui.mainMenu.els.menuSoloStartBtn.addEventListener('click', () => startSoloSession(true));
ui.mainMenu.els.menuSoloBackBtn.addEventListener('click', () => ui.mainMenu.showSolo(false));

ui.mainMenu.els.menuPlayBtn.addEventListener('click', () => enterLobbyFromMenu());

ui.mainMenu.els.menuOptionsBtn.addEventListener('click', () => {
  ui.mainMenu.showOptions(true);
  updateMenuServerStatus();
});

ui.mainMenu.els.menuOptionsBackBtn.addEventListener('click', () => {
  syncPlayerName(ui.mainMenu.els.menuPlayerNameInput.value.trim());
  ui.mainMenu.showOptions(false);
});

ui.mainMenu.els.menuExitBtn.addEventListener('click', () => {
  ui.toast('See you at the tables!');
  setTimeout(() => window.close(), 400);
});

ui.mainMenu.els.menuStatusBtn.addEventListener('click', async () => {
  const ok = await checkServerReachable();
  ui.mainMenu.setServerStatus(ok);
  ui.toast(ok ? 'Game server is online' : SERVER_UNREACHABLE_MSG);
});

ui.mainMenu.els.menuPlayerNameInput.addEventListener('input', (e) => {
  ui.mainMenu.setPlayerName(e.target.value);
  ui.els.playerName.value = e.target.value;
});

ui.els.playerName.addEventListener('input', (e) => {
  ui.mainMenu.setPlayerName(e.target.value);
});

ui.els.backToMenuBtn.addEventListener('click', () => showMainMenuScreen());
ui.els.lobbyRulesBtn?.addEventListener('click', () => openRules());

const savedName = localStorage.getItem(PLAYER_NAME_KEY) || '';
if (savedName) syncPlayerName(savedName);

showMainMenuScreen();
updateMenuServerStatus();
