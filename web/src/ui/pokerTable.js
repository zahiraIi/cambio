import { rankLabel, parseCardString } from '../api.js';
import { cardBackHtml, cardFaceHtml, cardIsRed } from './cards.js';
import { hasActiveFlight } from './cardAnimations.js';

const MEMORY_RECALL_MIN = 0.35;

/** Seat positions on oval felt (%). Hero is rendered separately at bottom. */
const OPP_SEATS = [
  { x: 50, y: 20 },
  { x: 24, y: 28 },
  { x: 76, y: 28 },
  { x: 14, y: 46 },
  { x: 86, y: 46 },
];

export function createPokerTable() {
  const root = document.createElement('div');
  root.id = 'play-root';
  root.className = 'play-root hidden';
  root.innerHTML = `
    <div class="poker-room">
      <div class="room-chrome" id="ptRoomChrome">
        <div class="chrome-left">
          <span id="playConnBadge" class="badge connection-badge offline">Offline</span>
          <button type="button" id="rulesGameBtn" class="btn btn-small btn-secondary quit-btn">Rules</button>
          <button type="button" id="leaveGameBtn" class="btn btn-small btn-secondary quit-btn">Leave</button>
        </div>
        <div class="chrome-center">
          <span id="phaseLabel" class="phase-badge">—</span>
          <span id="deckCountLabel" class="deck-count"></span>
        </div>
        <p id="turnLabel" class="turn-banner">—</p>
      </div>

      <div class="table-stage">
        <div class="table-scene">
          <div class="table-rail">
            <div class="table-felt">
              <div class="seats" id="ptSeats"></div>
              <div class="seat seat-hero" id="ptHeroSeat">
                <span class="seat-name" id="ptHeroName">You</span>
                <div class="seat-hand hand-pov" id="ptPlayerHand" data-tutorial-id="hero-hand"></div>
              </div>
              <div class="drawn-float hidden" id="ptDrawnArea" data-tutorial-id="drawn-card">
                <div class="drawn-card-display" id="ptDrawnCard"></div>
                <p class="drawn-ability-hint hidden" id="ptDrawnHint"></p>
                <div class="drawn-actions">
                  <button type="button" class="btn btn-chip" id="ptDrawnSwap">Swap</button>
                  <button type="button" class="btn btn-chip btn-chip-accent" id="ptDrawnPlay">Discard</button>
                </div>
              </div>
              <div class="table-center">
                <div class="pile deck-pile" id="ptDeck" title="Draw from deck" data-tutorial-id="deck-pile">
                  <div class="card card-back deck-stack" id="ptDeckStack"></div>
                  <span class="pile-label">DECK</span>
                </div>
                <div class="pile discard-pile" id="ptDiscard" title="Take or return card" data-tutorial-id="discard-pile">
                  <div class="card card-empty" id="ptDiscardCard"></div>
                  <span class="pile-label">DISCARD</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="play-actions" id="ptPlayActions">
        <div class="action-bar" id="ptActionBar">
          <button type="button" id="drawDeckBtn" class="btn btn-chip" data-tutorial-id="draw-deck">Draw deck</button>
          <button type="button" id="drawDiscardBtn" class="btn btn-chip" data-tutorial-id="draw-discard">Draw discard</button>
          <button type="button" id="callCambioBtn" class="btn btn-cambio" data-tutorial-id="call-cambio">CAMBIO</button>
        </div>
        <p class="hint ability-hint" id="abilityHint">Click your cards to peek / swap when it's your turn.</p>
      </div>

      <div class="ability-overlay hidden" id="ptAbilityPrompt">
        <div class="ability-card">
          <p id="ptAbilityText"></p>
          <div class="ability-actions">
            <button type="button" class="btn btn-small btn-primary hidden" id="ptAbilityConfirm">Swap</button>
            <button type="button" class="btn btn-small btn-secondary hidden" id="ptAbilitySkip">Keep</button>
          </div>
        </div>
      </div>

      <div id="ptCardFlyLayer" class="card-fly-layer" aria-hidden="true"></div>

      <div id="ptScoresOverlay" class="scores-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="ptWinnerName">
        <div class="scores-overlay-panel">
          <div id="ptWinnerAnnounce" class="winner-announce">
            <p class="winner-label">Winner</p>
            <h2 id="ptWinnerName" class="winner-name"></h2>
            <p id="ptWinnerScore" class="winner-score"></p>
          </div>
          <div id="ptScoreBoard" class="score-board"></div>
          <button type="button" id="ptScoresPlayAgain" class="btn btn-primary scores-play-again">Play again</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertBefore(root, document.getElementById('overlay-root'));

  const els = {
    seats: root.querySelector('#ptSeats'),
    deck: root.querySelector('#ptDeck'),
    deckStack: root.querySelector('#ptDeckStack'),
    discard: root.querySelector('#ptDiscard'),
    discardCard: root.querySelector('#ptDiscardCard'),
    playerHand: root.querySelector('#ptPlayerHand'),
    heroName: root.querySelector('#ptHeroName'),
    drawnArea: root.querySelector('#ptDrawnArea'),
    drawnHint: root.querySelector('#ptDrawnHint'),
    drawnCard: root.querySelector('#ptDrawnCard'),
    drawnSwap: root.querySelector('#ptDrawnSwap'),
    drawnPlay: root.querySelector('#ptDrawnPlay'),
    abilityPrompt: root.querySelector('#ptAbilityPrompt'),
    abilityText: root.querySelector('#ptAbilityText'),
    abilitySkip: root.querySelector('#ptAbilitySkip'),
    abilityConfirm: root.querySelector('#ptAbilityConfirm'),
    felt: root.querySelector('.table-felt'),
    flyLayer: root.querySelector('#ptCardFlyLayer'),
    scoresOverlay: root.querySelector('#ptScoresOverlay'),
    winnerName: root.querySelector('#ptWinnerName'),
    winnerScore: root.querySelector('#ptWinnerScore'),
    scoreBoard: root.querySelector('#ptScoreBoard'),
    scoresPlayAgain: root.querySelector('#ptScoresPlayAgain'),
  };

  let state = null;
  let myPlayerId = null;
  let pendingAbility = null;
  let selectedSlot = null;
  let blindSwitchSlot = null;
  const callbacks = {};

  function memoryKey(targetId, slot) {
    return `${targetId}:${slot}`;
  }

  function getMemory(targetId, slotIdx) {
    const key = memoryKey(targetId, slotIdx);
    return (state?.memories || []).find((m) => m.key === key);
  }

  function holdingDrawnCard() {
    if (state?.currentTurn !== myPlayerId) return false;
    return !!(state?.hasDrawnCard || state?.drawnCard?.card);
  }

  function stackWindowOpen() {
    return (
      state &&
      state.phase === 'turns' &&
      state.openStackRank > 0 &&
      !state.stackRankClaimed
    );
  }

  function slotRankForSnap(slotIdx, slotData) {
    if (slotData?.rank != null) return slotData.rank;
    if (slotData?.card) return parseCardString(slotData.card).rank;
    const mem = getMemory(myPlayerId, slotIdx);
    if (mem && mem.strength >= MEMORY_RECALL_MIN) return mem.rank;
    return null;
  }

  function canAttemptSnapOwn(slotIdx, slotData) {
    if (state?.pendingStackGive) return false;
    if (holdingDrawnCard()) return false;
    if (
      state.currentTurn === myPlayerId &&
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
    return rank != null && rank === state.openStackRank;
  }

  function opponentStackMemory(targetId, slotIdx) {
    const mem = getMemory(targetId, slotIdx);
    if (!mem || mem.strength < MEMORY_RECALL_MIN) return null;
    return mem;
  }

  function canAttemptStackOpponent(targetId, targetSlot) {
    if (state?.pendingStackGive) return false;
    if (holdingDrawnCard()) return false;
    if (
      state.currentTurn === myPlayerId &&
      pendingAbility &&
      pendingAbility !== 'none'
    ) {
      return false;
    }
    if (!stackWindowOpen()) return false;
    const opp = state.players?.find((p) => p.id === targetId);
    if (!opp?.hand?.[targetSlot]?.hasCard) return false;
    return opponentStackMemory(targetId, targetSlot) != null;
  }

  function canStackOpponentCard(targetId, slotIdx) {
    if (!canAttemptStackOpponent(targetId, slotIdx)) return false;
    const mem = opponentStackMemory(targetId, slotIdx);
    return mem.rank === state.openStackRank;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function playerOrder(players) {
    const myIndex = players.findIndex((p) => p.id === myPlayerId);
    const base = myIndex >= 0 ? myIndex : 0;
    return players.map((p, i) => ({
      ...p,
      order: (i - base + players.length) % players.length,
    }));
  }

  function syncAbilityPrompt() {
    const phase = state?.phase;
    const isMyTurn = state?.currentTurn === myPlayerId;
    const pa = state?.pendingAbility;
    const psg = state?.pendingStackGive;

    if (psg) {
      const opp = state.players?.find((p) => p.id === psg.targetId);
      pendingAbility = null;
      els.abilityPrompt.classList.remove('hidden');
      els.abilityText.textContent = `Pick one of your cards to give ${opp?.name || 'opponent'}`;
      els.abilitySkip.classList.add('hidden');
      els.abilityConfirm.classList.add('hidden');
      return;
    }

    if (isMyTurn && pa && pa !== 'none' && phase !== 'init_peek' && phase !== 'scoring') {
      pendingAbility = pa;
      els.abilityPrompt.classList.remove('hidden');
      els.abilitySkip.classList.add('hidden');
      els.abilityConfirm.classList.add('hidden');

      if (pa === 'look_and_switch') {
        const ls = state.lookSwitch || {};
        if (ls.mySlot == null || ls.mySlot < 0) {
          els.abilityText.textContent = 'Pick one of your cards to look at';
        } else if (!ls.peekDone) {
          els.abilityText.textContent = "Pick an opponent's card to look at";
        } else {
          els.abilityText.textContent = 'Swap cards or keep yours?';
          els.abilitySkip.textContent = 'Keep';
          els.abilitySkip.classList.remove('hidden');
          els.abilityConfirm.classList.remove('hidden');
        }
      } else {
        els.abilityText.textContent = abilityMessage(pa);
      }
    } else {
      pendingAbility = null;
      els.abilityPrompt.classList.add('hidden');
    }
  }

  function abilityMessage(ability) {
    return (
      {
        peek_own: 'Click one of your cards to peek',
        peek_opponent: "Click one opponent's card to peek",
        blind_switch: 'Pick your card, then an opponent\'s card',
        look_and_switch: 'Pick your card, then peek an opponent — swap optional',
      }[ability] || ability
    );
  }

  function ensureCardInner(cardEl, html) {
    if (!cardEl) return;
    if (!cardEl.querySelector('.playing-card')) {
      cardEl.innerHTML = html;
    }
  }

  function renderDeckDiscard() {
    const remaining = state?.deckRemaining ?? 0;
    els.deck.classList.toggle('deck-empty', remaining <= 0);
    if (remaining > 0) {
      els.deckStack.className = 'card card-back deck-stack';
      els.deckStack.innerHTML = cardBackHtml();
      ensureCardInner(els.deckStack, cardBackHtml());
    } else {
      els.deckStack.className = 'card card-empty';
      els.deckStack.innerHTML = '';
    }

    const top = state?.topDiscard;
    if (top) {
      const isRed = cardIsRed(top);
      els.discardCard.className = `card card-face ${isRed ? 'red' : ''}`;
      els.discardCard.innerHTML = cardFaceHtml(top, { compact: true });
    } else {
      els.discardCard.className = 'card card-empty';
      els.discardCard.innerHTML = '';
    }
  }

  function renderDrawnCard() {
    const isMyTurn = state?.currentTurn === myPlayerId;
    if (state?.drawnCard?.card && isMyTurn) {
      if (hasActiveFlight()) {
        els.drawnArea.classList.add('hidden');
      } else {
        els.drawnArea.classList.remove('hidden');
      }
      const dc = state.drawnCard;
      els.drawnCard.innerHTML = cardFaceHtml(dc.card);
      if (dc.hasAbility && dc.abilityHint) {
        els.drawnHint.textContent = `${dc.abilityHint} — or discard to return`;
        els.drawnHint.classList.remove('hidden');
      } else {
        els.drawnHint.textContent = 'Tap discard pile or Discard to return';
        els.drawnHint.classList.remove('hidden');
      }
      els.drawnPlay.textContent = dc.hasAbility ? 'Use ability' : 'Discard';
      els.drawnSwap.disabled = selectedSlot === null;
    } else {
      els.drawnArea.classList.add('hidden');
      els.drawnHint.classList.add('hidden');
    }
  }

  function renderOpponentSeats() {
    els.seats.innerHTML = '';
    const players = state?.players || [];
    const ordered = playerOrder(players);
    const opponents = ordered.filter((p) => p.order !== 0);

    opponents.forEach((opp, idx) => {
      const pos = OPP_SEATS[idx % OPP_SEATS.length];
      const isActive = opp.id === state.currentTurn;
      const seat = document.createElement('div');
      seat.className =
        'seat' + (isActive ? ' active-turn' : '') + (opp.calledCambio ? ' cambio' : '');
      seat.style.left = `${pos.x}%`;
      seat.style.top = `${pos.y}%`;

      const initials = (opp.name || '?').slice(0, 2).toUpperCase();
      let handHtml = '';
      const hand = opp.hand || [];
      hand.forEach((slot, i) => {
        if (!slot.hasCard) {
          handHtml += '<div class="card" style="visibility:hidden"></div>';
          return;
        }
        if (opp.calledCambio && slot.card) {
          const isRed = cardIsRed(slot.card);
          handHtml += `<div class="card card-face cambio-revealed ${isRed ? 'red' : ''}" data-opp="${opp.id}" data-slot="${i}">${cardFaceHtml(slot.card, { compact: true })}</div>`;
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
          const title = stackMatch
            ? `Remembered ${rankText} — tap to stack on discard`
            : `Remembered ${rankText} — tap to stack (wrong = penalty)`;
          handHtml += `<div class="${cls}" data-opp="${opp.id}" data-slot="${i}" style="opacity:${opacity}" title="${escapeHtml(title)}">${cardFaceHtml(rankText, { rankOnly: true })}</div>`;
          return;
        }

        let cls = 'card card-back';
        if (abilityClick) cls += ' clickable';
        handHtml += `<div class="${cls}" data-opp="${opp.id}" data-slot="${i}">${cardBackHtml()}</div>`;
      });

      const score = opp.score != null ? opp.score : '';
      seat.innerHTML = `
        <div class="seat-hand" data-tutorial-id="opponent-hand">${handHtml}</div>
        <span class="seat-name">${escapeHtml(opp.name || 'Player')}</span>
        <div class="seat-avatar">${escapeHtml(initials)}</div>
        ${score !== '' ? `<span class="seat-score">${score} pts</span>` : ''}`;
      els.seats.appendChild(seat);
    });

    els.seats.querySelectorAll('[data-opp]').forEach((card) => {
      card.addEventListener('click', () => {
        handleOpponentClick(card.dataset.opp, parseInt(card.dataset.slot, 10));
      });
    });
  }

  function renderHeroAndHand() {
    const me = state?.players?.find((p) => p.id === myPlayerId);
    if (!me) return;

    const phase = state.phase;
    const initMask = state.initPeekMask ?? 0;
    els.playerHand.innerHTML = '';
    if (els.heroName) els.heroName.textContent = me.name || 'You';
    const heroSeat = root.querySelector('#ptHeroSeat');
    if (heroSeat) {
      heroSeat.classList.toggle('active-turn', state.currentTurn === myPlayerId);
    }

    me.hand.forEach((slot, i) => {
      const card = document.createElement('div');
      const mem = getMemory(myPlayerId, i);

      if (!slot.hasCard) {
        card.className = 'card';
        card.style.visibility = 'hidden';
      } else if (slot.card && (slot.revealed || slot.known)) {
        const isRed = cardIsRed(slot.card);
        const revealed = slot.revealed ? ' cambio-revealed' : ' known';
        card.className = `card card-face clickable${revealed} ${isRed ? 'red' : ''}`;
        card.innerHTML = cardFaceHtml(slot.card);
      } else if (mem && mem.strength >= MEMORY_RECALL_MIN) {
        card.className = 'card memory-fade clickable card-face';
        card.style.opacity = String(0.35 + mem.strength * 0.55);
        card.innerHTML = cardFaceHtml(rankLabel(mem.rank), { rankOnly: true });
      } else {
        card.className = 'card card-back clickable';
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
      if (holdingDrawnCard() && slot.hasCard) {
        card.classList.add('swap-ready');
        card.title = 'Tap to swap with drawn card';
      } else if (canAttemptSnapOwn(i, slot)) {
        card.classList.add('stackable-own');
        if (canSnapOwnCard(i, slot)) card.classList.add('stackable-own-match');
        card.title = canSnapOwnCard(i, slot)
          ? 'Tap to stack on discard'
          : 'Tap to attempt stack (wrong = penalty card)';
      }
      if (state.pendingStackGive && slot.hasCard) {
        card.classList.add('stack-give-pick');
        card.title = 'Give this card to opponent';
      }
      if (i === selectedSlot) card.classList.add('selected');

      if (slot.hasCard) {
        ensureCardInner(
          card,
          card.classList.contains('card-face')
            ? card.innerHTML || cardFaceHtml(slot.card || '')
            : cardBackHtml(),
        );
      }

      card.dataset.slot = String(i);
      card.setAttribute('data-tutorial-id', `hero-slot-${i}`);
      card.addEventListener('click', () => handleOwnClick(i));
      els.playerHand.appendChild(card);
    });
  }

  function handleOwnClick(slot) {
    if (!state || !callbacks.onAction) return;
    const me = state.players?.find((p) => p.id === myPlayerId);
    const slotData = me?.hand?.[slot];

    if (state.pendingStackGive) {
      callbacks.onAction('stack_give', { slot });
      return;
    }
    if (state.phase === 'init_peek') {
      if (slot > 1) return;
      const mask = state.initPeekMask ?? 0;
      if (mask & (1 << slot)) return;
      callbacks.onAction('init_peek', { slot });
      return;
    }
    if (pendingAbility === 'peek_own') {
      callbacks.onAction('peek_own', { slot });
      return;
    }
    if (pendingAbility === 'look_and_switch') {
      const ls = state.lookSwitch || {};
      if (ls.mySlot == null || ls.mySlot < 0) {
        callbacks.onAction('look_switch_own', { slot });
        selectedSlot = null;
        return;
      }
    }
    if (pendingAbility === 'blind_switch') {
      blindSwitchSlot = slot;
      selectedSlot = slot;
      syncState(state, myPlayerId);
      return;
    }
    if (holdingDrawnCard()) {
      if (!slotData?.hasCard) return;
      callbacks.onAction('swap_card', { slot });
      selectedSlot = null;
      return;
    }
    if (slotData && canAttemptSnapOwn(slot, slotData)) {
      callbacks.onAction('snap', { slot });
      selectedSlot = null;
      return;
    }

    selectedSlot = slot;
    syncState(state, myPlayerId);
  }

  function handleOpponentClick(targetId, targetSlot) {
    if (!state || !callbacks.onAction) return;

    if (canAttemptStackOpponent(targetId, targetSlot)) {
      callbacks.onAction('stack_opponent', { targetId, targetSlot });
      return;
    }
    if (pendingAbility === 'peek_opponent') {
      callbacks.onAction('peek_opponent', { targetId, targetSlot });
      return;
    }
    if (pendingAbility === 'blind_switch' && blindSwitchSlot !== null) {
      callbacks.onAction('blind_switch', {
        slot: blindSwitchSlot,
        targetId,
        targetSlot,
      });
      blindSwitchSlot = null;
      selectedSlot = null;
      return;
    }
    if (pendingAbility === 'look_and_switch') {
      const ls = state.lookSwitch || {};
      if ((ls.mySlot == null || ls.mySlot < 0) || ls.peekDone) return;
      callbacks.onAction('look_switch_peek', { targetId, targetSlot });
    }
  }

  function flashTurn() {
    els.felt?.classList.add('turn-changed-flash');
    setTimeout(() => els.felt?.classList.remove('turn-changed-flash'), 650);
  }

  els.drawnSwap.addEventListener('click', () => {
    const holding = holdingDrawnCard();
    if (selectedSlot === null || !holding) return;
    callbacks.onAction?.('swap_card', { slot: selectedSlot });
    selectedSlot = null;
  });

  els.drawnPlay.addEventListener('click', () => {
    if (!holdingDrawnCard()) return;
    const dc = state?.drawnCard;
    if (dc?.hasAbility) callbacks.onAction?.('use_card');
    else callbacks.onAction?.('discard');
    selectedSlot = null;
  });

  els.discard.addEventListener('click', () => {
    if (holdingDrawnCard() && state.phase !== 'init_peek') {
      callbacks.onAction?.('return_card');
      selectedSlot = null;
      return;
    }
    callbacks.onDrawDiscard?.();
  });

  els.deck.addEventListener('click', () => callbacks.onDrawDeck?.());

  els.abilitySkip.addEventListener('click', () => {
    if (pendingAbility === 'look_and_switch') callbacks.onAction?.('decline_switch');
    pendingAbility = null;
    selectedSlot = null;
    blindSwitchSlot = null;
  });

  els.abilityConfirm.addEventListener('click', () => {
    const ls = state?.lookSwitch;
    if (!ls?.peekDone) return;
    callbacks.onAction?.('look_switch', {
      slot: ls.mySlot,
      targetId: ls.targetId,
      targetSlot: ls.targetSlot,
    });
    selectedSlot = null;
    blindSwitchSlot = null;
  });

  els.scoresPlayAgain.addEventListener('click', () => callbacks.onPlayAgain?.());

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function playerName(playerId) {
    return state?.players?.find((p) => p.id === playerId)?.name || playerId;
  }

  function hideScoresOverlay() {
    els.scoresOverlay.classList.add('hidden');
  }

  function showScoresOverlay() {
    const scores = state?.scores;
    if (!scores || Object.keys(scores).length === 0) return;

    const entries = Object.entries(scores).sort((a, b) => a[1] - b[1]);
    const lowest = entries[0][1];
    const winners =
      state.winners?.length > 0
        ? state.winners
        : entries.filter(([, score]) => score === lowest).map(([id]) => id);
    const winnerNames = winners.map(playerName).join(' & ');

    els.winnerName.textContent = winnerNames;

    if (state.winReason === 'hand_cleared') {
      els.winnerScore.textContent = 'Cleared their hand!';
    } else if (winners.length > 1) {
      els.winnerScore.textContent = `Tied at ${lowest} point${lowest === 1 ? '' : 's'}`;
    } else {
      els.winnerScore.textContent = `${lowest} point${lowest === 1 ? '' : 's'}`;
    }

    els.scoreBoard.innerHTML = entries
      .map(([pid, score]) => {
        const name = playerName(pid);
        const win = winners.includes(pid);
        return `<div class="score-row${win ? ' winner' : ''}">
          <span>${escapeHtml(name)}${win ? ' ★' : ''}</span>
          <span class="score-value">${score}</span>
        </div>`;
      })
      .join('');

    els.scoresOverlay.classList.remove('hidden');
  }

  const gameEls = {
    playConnBadge: root.querySelector('#playConnBadge'),
    phaseLabel: root.querySelector('#phaseLabel'),
    deckCountLabel: root.querySelector('#deckCountLabel'),
    turnLabel: root.querySelector('#turnLabel'),
    drawDeckBtn: root.querySelector('#drawDeckBtn'),
    drawDiscardBtn: root.querySelector('#drawDiscardBtn'),
    callCambioBtn: root.querySelector('#callCambioBtn'),
    leaveGameBtn: root.querySelector('#leaveGameBtn'),
    rulesGameBtn: root.querySelector('#rulesGameBtn'),
    abilityHint: root.querySelector('#abilityHint'),
  };

  return {
    root,
    els,
    gameEls,
    getAnimationRefs(onRevealDrawn) {
      return {
        flyLayer: els.flyLayer,
        deck: els.deckStack,
        discard: els.discardCard,
        hand: els.playerHand,
        drawnArea: els.drawnArea,
        onRevealDrawn,
      };
    },
    show(show) {
      root.classList.toggle('hidden', !show);
      document.body.classList.toggle('in-play', show);
      if (!show) hideScoresOverlay();
    },
    setCallbacks(cbs) {
      Object.assign(callbacks, cbs);
    },
    flashTurn,
    syncState(gameState, playerId) {
      state = gameState;
      myPlayerId = playerId;
      syncAbilityPrompt();
      renderDeckDiscard();
      renderOpponentSeats();
      renderHeroAndHand();
      renderDrawnCard();
      if (gameState?.phase === 'scoring') {
        showScoresOverlay();
      } else {
        hideScoresOverlay();
      }
    },
    resetSelection() {
      selectedSlot = null;
      blindSwitchSlot = null;
    },
  };
}
