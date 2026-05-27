import { SERVER_UNREACHABLE_MSG } from '../api.js';
import { createMainMenu } from './mainMenu.js';

export function createOverlay() {
  const root = document.getElementById('overlay-root');
  const toastStack = document.createElement('div');
  toastStack.className = 'toast-stack';
  root.appendChild(toastStack);

  const mainMenu = createMainMenu(root);

  const welcome = el('div', 'panel center-panel hidden', root);
  welcome.innerHTML = `
    <h1>CAMBIO</h1>
    <p class="sub">Multiplayer lobby — create or join a table</p>
    <button type="button" id="lobbyRulesBtn" class="btn-text lobby-rules-link">Rules</button>
    <p id="serverHint" class="server-hint hidden">${SERVER_UNREACHABLE_MSG}</p>
    <input type="text" id="playerName" placeholder="Your name" maxlength="20" autocomplete="nickname" />
    <label class="hint field-label">Practice vs bots</label>
    <input type="number" id="botCount" min="1" max="5" value="2" />
    <button type="button" id="soloBtn">Solo vs bots</button>
    <p class="lobby-divider">Play online</p>
    <label class="hint field-label" for="maxPlayers">Table size</label>
    <select id="maxPlayers">
      <option value="2">2 players</option>
      <option value="3">3 players</option>
      <option value="4" selected>4 players</option>
      <option value="5">5 players</option>
      <option value="6">6 players</option>
    </select>
    <button type="button" id="createOnlineBtn" class="accent">Create online table</button>
    <div class="join-row">
      <input type="text" id="gameIdInput" placeholder="Room code" />
      <button type="button" id="joinOnlineBtn" class="secondary">Join</button>
    </div>
    <div class="games-section">
      <div class="games-header">
        <span>Open tables</span>
        <button type="button" id="refreshGamesBtn" class="btn-text">Refresh</button>
      </div>
      <div id="gamesList" class="games-list"></div>
    </div>
    <p class="hint">Share room code with friends · Esc leaves waiting room</p>
    <button type="button" id="backToMenuBtn" class="btn-text back-to-menu">← Main menu</button>
  `;

  const tablePrompt = el('div', 'panel hidden', root);
  tablePrompt.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);';
  tablePrompt.innerHTML = `
    <p id="tablePromptTitle">Table</p>
    <p class="hint" id="tablePromptMeta"></p>
    <button type="button" id="tableCreateBtn">Create table here</button>
    <button type="button" id="tableJoinBtn" class="secondary">Join open table</button>
    <button type="button" id="tableSoloBtn" class="secondary hidden">Practice at this table</button>
  `;

  const waiting = el('div', 'panel center-panel hidden', root);
  waiting.id = 'waitingPanel';
  waiting.innerHTML = `
    <h1>Waiting</h1>
    <p class="sub" id="waitingRoomId"></p>
    <div id="waitingPlayers"></div>
    <p class="hint" id="waitingMeta"></p>
    <button type="button" id="startGameBtn" disabled>Start game</button>
    <p class="hint hidden" id="startHint">Need at least 2 players seated</p>
    <button type="button" id="leaveWaitingBtn" class="secondary">Leave table</button>
  `;

  const hudTop = el('div', 'hud hud-top room-chrome', root);
  hudTop.innerHTML = `
    <div class="panel chrome-left">
      <span id="connBadge" class="badge connection-badge offline">Offline</span>
      <p class="hint hidden" id="moveHint"></p>
    </div>
  `;

  const els = {
    playerName: welcome.querySelector('#playerName'),
    serverHint: welcome.querySelector('#serverHint'),
    soloBtn: welcome.querySelector('#soloBtn'),
    botCount: welcome.querySelector('#botCount'),
    maxPlayers: welcome.querySelector('#maxPlayers'),
    createOnlineBtn: welcome.querySelector('#createOnlineBtn'),
    gameIdInput: welcome.querySelector('#gameIdInput'),
    joinOnlineBtn: welcome.querySelector('#joinOnlineBtn'),
    refreshGamesBtn: welcome.querySelector('#refreshGamesBtn'),
    gamesList: welcome.querySelector('#gamesList'),
    backToMenuBtn: welcome.querySelector('#backToMenuBtn'),
    lobbyRulesBtn: welcome.querySelector('#lobbyRulesBtn'),
    tablePromptTitle: tablePrompt.querySelector('#tablePromptTitle'),
    tablePromptMeta: tablePrompt.querySelector('#tablePromptMeta'),
    tableCreateBtn: tablePrompt.querySelector('#tableCreateBtn'),
    tableJoinBtn: tablePrompt.querySelector('#tableJoinBtn'),
    tableSoloBtn: tablePrompt.querySelector('#tableSoloBtn'),
    waitingPanel: waiting,
    waitingRoomId: waiting.querySelector('#waitingRoomId'),
    waitingPlayers: waiting.querySelector('#waitingPlayers'),
    waitingMeta: waiting.querySelector('#waitingMeta'),
    startGameBtn: waiting.querySelector('#startGameBtn'),
    startHint: waiting.querySelector('#startHint'),
    leaveWaitingBtn: waiting.querySelector('#leaveWaitingBtn'),
    connBadge: hudTop.querySelector('#connBadge'),
  };

  return {
    root,
    mainMenu,
    welcome,
    tablePrompt,
    waiting,
    hudTop,
    toastStack,
    els,
    toast(text, ms = 3200) {
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = text;
      toastStack.appendChild(t);
      setTimeout(() => t.remove(), ms);
    },
    setConnection(status) {
      const label = status === 'online' ? 'Online' : status === 'reconnecting' ? 'Reconnecting' : 'Offline';
      const cls = `badge connection-badge ${status}`;
      for (const b of [els.connBadge, document.getElementById('playConnBadge')].filter(Boolean)) {
        b.className = cls;
        b.textContent = label;
      }
    },
    showMainMenu(show) {
      mainMenu.show(show);
    },
    showWelcome(show) {
      welcome.classList.toggle('hidden', !show);
    },
    showTablePrompt(show) {
      tablePrompt.classList.toggle('hidden', !show);
    },
    showWaiting(show) {
      waiting.classList.toggle('hidden', !show);
      if (show) welcome.classList.add('hidden');
    },
    showGameHud(_show) {
      /* Game chrome lives in play-root (pokerTable). */
    },
    setServerHint(visible) {
      els.serverHint.classList.toggle('hidden', !visible);
    },
  };
}

function el(tag, cls, parent) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  parent.appendChild(n);
  return n;
}
