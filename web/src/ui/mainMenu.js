export function createMainMenu(root) {
  const screen = el('div', 'main-menu', root);
  screen.innerHTML = `
    <div class="main-menu__bg" aria-hidden="true">
      <span class="suit-deco suit-deco--1">♠</span>
      <span class="suit-deco suit-deco--2">♥</span>
      <span class="suit-deco suit-deco--3">♦</span>
      <span class="suit-deco suit-deco--4">♣</span>
      <span class="suit-deco suit-deco--5">♠</span>
      <span class="suit-deco suit-deco--6">♥</span>
    </div>

    <header class="main-menu__header">
      <div class="title-fan" aria-hidden="true">
        <div class="fan-card"><span class="fan-rank">J</span><span class="fan-suit red">♦</span></div>
        <div class="fan-card"><span class="fan-rank">Q</span><span class="fan-suit red">♦</span></div>
        <div class="fan-card"><span class="fan-rank">K</span><span class="fan-suit red">♦</span></div>
        <div class="fan-card"><span class="fan-rank">A</span><span class="fan-suit red">♦</span></div>
      </div>
      <h1 class="game-title">
        <span class="title-main">CAMBIO</span>
      </h1>
      <p class="title-tagline">Peek · Swap · Call Cambio</p>
    </header>

    <div class="main-menu__panel" id="menuPanel">
      <button type="button" class="menu-btn" id="menuLearnBtn">Learn to play</button>
      <button type="button" class="menu-btn" id="menuSoloBtn">Play vs bots</button>
      <button type="button" class="menu-btn" id="menuPlayBtn">Play online</button>
      <button type="button" class="menu-btn menu-btn--secondary" id="menuRulesBtn">Rules</button>
      <button type="button" class="menu-btn" id="menuOptionsBtn">Options</button>
      <button type="button" class="menu-btn menu-btn--exit" id="menuExitBtn">Exit</button>
    </div>

    <div class="main-menu__panel main-menu__tutorial hidden" id="tutorialPanel">
      <h2 class="options-heading">Learn to play</h2>
      <p class="solo-hint">Interactive walkthrough, then practice at your pace.</p>
      <button type="button" class="menu-btn" id="menuTutorialStartBtn">Start tutorial</button>
      <button type="button" class="menu-btn menu-btn--secondary" id="menuTutorialRulesBtn">Rules</button>
      <button type="button" class="menu-btn menu-btn--back" id="menuTutorialBackBtn">Back</button>
    </div>

    <div class="main-menu__panel main-menu__solo hidden" id="soloPanel">
      <h2 class="options-heading">Play vs bots</h2>
      <p class="solo-hint">How many bots at the table?</p>
      <label class="options-label" for="menuSoloBotCount">Bots (1–5)</label>
      <input type="number" id="menuSoloBotCount" min="1" max="5" value="2" />
      <button type="button" class="menu-btn" id="menuSoloStartBtn">Start game</button>
      <button type="button" class="menu-btn menu-btn--back" id="menuSoloBackBtn">Back</button>
    </div>

    <div class="main-menu__panel main-menu__options hidden" id="optionsPanel">
      <h2 class="options-heading">Options</h2>
      <label class="options-label" for="menuPlayerNameInput">Display name</label>
      <input type="text" id="menuPlayerNameInput" placeholder="Your name" maxlength="20" autocomplete="nickname" />
      <p id="menuServerHint" class="menu-server-hint hidden"></p>
      <button type="button" class="menu-btn menu-btn--back" id="menuOptionsBackBtn">Back</button>
    </div>

    <footer class="main-menu__footer">
      <button type="button" class="footer-tab" id="menuStatusBtn">
        <span id="menuServerBadge" class="footer-badge offline">Offline</span>
        Server
      </button>
      <div class="player-chip">
        <span class="player-chip__icon">♣</span>
        <span class="player-chip__name" id="menuPlayerChip">Guest</span>
      </div>
      <span class="footer-brand">Cambio</span>
    </footer>
  `;

  const els = {
    screen,
    menuPanel: screen.querySelector('#menuPanel'),
    tutorialPanel: screen.querySelector('#tutorialPanel'),
    soloPanel: screen.querySelector('#soloPanel'),
    optionsPanel: screen.querySelector('#optionsPanel'),
    menuPlayBtn: screen.querySelector('#menuPlayBtn'),
    menuLearnBtn: screen.querySelector('#menuLearnBtn'),
    menuRulesBtn: screen.querySelector('#menuRulesBtn'),
    menuTutorialStartBtn: screen.querySelector('#menuTutorialStartBtn'),
    menuTutorialRulesBtn: screen.querySelector('#menuTutorialRulesBtn'),
    menuTutorialBackBtn: screen.querySelector('#menuTutorialBackBtn'),
    menuSoloBtn: screen.querySelector('#menuSoloBtn'),
    menuSoloStartBtn: screen.querySelector('#menuSoloStartBtn'),
    menuSoloBackBtn: screen.querySelector('#menuSoloBackBtn'),
    menuSoloBotCount: screen.querySelector('#menuSoloBotCount'),
    menuOptionsBtn: screen.querySelector('#menuOptionsBtn'),
    menuExitBtn: screen.querySelector('#menuExitBtn'),
    menuOptionsBackBtn: screen.querySelector('#menuOptionsBackBtn'),
    menuPlayerNameInput: screen.querySelector('#menuPlayerNameInput'),
    menuPlayerChip: screen.querySelector('#menuPlayerChip'),
    menuServerBadge: screen.querySelector('#menuServerBadge'),
    menuServerHint: screen.querySelector('#menuServerHint'),
    menuStatusBtn: screen.querySelector('#menuStatusBtn'),
  };

  return {
    screen,
    els,
    show(show) {
      screen.classList.toggle('hidden', !show);
    },
    showOptions(show) {
      els.menuPanel.classList.toggle('hidden', show);
      els.tutorialPanel.classList.add('hidden');
      els.soloPanel.classList.add('hidden');
      els.optionsPanel.classList.toggle('hidden', !show);
    },
    showSolo(show) {
      els.menuPanel.classList.toggle('hidden', show);
      els.tutorialPanel.classList.add('hidden');
      els.soloPanel.classList.toggle('hidden', !show);
      els.optionsPanel.classList.add('hidden');
    },
    showTutorial(show) {
      els.menuPanel.classList.toggle('hidden', show);
      els.tutorialPanel.classList.toggle('hidden', !show);
      els.soloPanel.classList.add('hidden');
      els.optionsPanel.classList.add('hidden');
    },
    showMainPanel() {
      els.menuPanel.classList.remove('hidden');
      els.tutorialPanel.classList.add('hidden');
      els.soloPanel.classList.add('hidden');
      els.optionsPanel.classList.add('hidden');
    },
    setPlayerName(name) {
      const n = name.trim() || 'Guest';
      els.menuPlayerChip.textContent = n;
      if (els.menuPlayerNameInput.value !== name) {
        els.menuPlayerNameInput.value = name;
      }
    },
    setServerStatus(online) {
      const b = els.menuServerBadge;
      b.className = `footer-badge ${online ? 'online' : 'offline'}`;
      b.textContent = online ? 'Online' : 'Offline';
      els.menuServerHint.classList.toggle('hidden', online);
    },
    setServerHint(msg) {
      els.menuServerHint.textContent = msg;
    },
  };
}

function el(tag, cls, parent) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  parent.appendChild(n);
  return n;
}
