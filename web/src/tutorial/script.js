/** Scripted tutorial — local fake game states (no WebSocket). */

export const TUTORIAL_PLAYER = 'tutorial-player';
export const TUTORIAL_BOT = 'tutorial-bot';

function hiddenSlot() {
  return { hasCard: true };
}

function knownSlot(card) {
  return { hasCard: true, card, known: true, rank: cardRank(card) };
}

function cardRank(cardStr) {
  if (!cardStr || cardStr === '🃏') return 14;
  const m = cardStr.match(/^(10|[AKQJ2-9])/);
  if (!m) return 0;
  const label = m[1];
  if (label === 'A') return 1;
  if (label === 'J') return 11;
  if (label === 'Q') return 12;
  if (label === 'K') return 13;
  return parseInt(label, 10);
}

function botHand() {
  return [hiddenSlot(), hiddenSlot(), hiddenSlot(), hiddenSlot()];
}

function baseState(overrides = {}) {
  return {
    gameId: 'tutorial',
    phase: 'turns',
    players: [
      {
        id: TUTORIAL_PLAYER,
        name: 'You',
        hand: [hiddenSlot(), hiddenSlot(), hiddenSlot(), hiddenSlot()],
        calledCambio: false,
        cardCount: 4,
        isBot: false,
      },
      {
        id: TUTORIAL_BOT,
        name: 'Bot 1',
        hand: botHand(),
        calledCambio: false,
        cardCount: 4,
        isBot: true,
      },
    ],
    currentTurn: TUTORIAL_PLAYER,
    hasDrawnCard: false,
    pendingAbility: 'none',
    deckRemaining: 40,
    topDiscard: '5♥',
    topDiscardRank: 5,
    openStackRank: 0,
    stackRankClaimed: false,
    initPeeksLeft: 0,
    initPeekMask: 0,
    turnCounter: 1,
    ...overrides,
  };
}

export const SCRIPT_STEPS = [
  {
    id: 'welcome',
    type: 'info',
    title: 'Welcome to Cambio',
    body: 'Cambio is a memory card game. Four cards face down — lowest score wins. This walkthrough shows every major rule.',
    highlight: null,
    rulesSection: 'goal',
    state: () => baseState({ phase: 'waiting' }),
  },
  {
    id: 'goal',
    type: 'info',
    title: 'Scoring',
    body: 'Ace = 1, 2–10 = face value, J/Q/K = 10, red King = −1. Try to keep your total low.',
    highlight: null,
    rulesSection: 'goal',
    state: () => baseState({ phase: 'waiting' }),
  },
  {
    id: 'peek_intro',
    type: 'info',
    title: 'Starting peek',
    body: 'Before play, peek at your first two cards (leftmost slots). Tap slot 1, then slot 2.',
    highlight: 'hero-hand',
    rulesSection: 'setup',
    state: () =>
      baseState({
        phase: 'init_peek',
        initPeeksLeft: 2,
        initPeekMask: 0,
        topDiscard: '9♣',
        topDiscardRank: 9,
      }),
  },
  {
    id: 'peek_0',
    type: 'action',
    title: 'Peek slot 1',
    body: 'Tap your leftmost card to peek.',
    highlight: 'hero-slot-0',
    rulesSection: 'setup',
    expect: { action: 'init_peek', slot: 0 },
    state: () =>
      baseState({
        phase: 'init_peek',
        initPeeksLeft: 2,
        initPeekMask: 0,
        topDiscard: '9♣',
      }),
  },
  {
    id: 'peek_1',
    type: 'action',
    title: 'Peek slot 2',
    body: 'Now peek your second card.',
    highlight: 'hero-slot-1',
    rulesSection: 'setup',
    expect: { action: 'init_peek', slot: 1 },
    state: () =>
      baseState({
        phase: 'init_peek',
        initPeeksLeft: 1,
        initPeekMask: 1,
        players: [
          {
            id: TUTORIAL_PLAYER,
            name: 'You',
            hand: [knownSlot('3♠'), hiddenSlot(), hiddenSlot(), hiddenSlot()],
            calledCambio: false,
            cardCount: 4,
            isBot: false,
          },
          {
            id: TUTORIAL_BOT,
            name: 'Bot 1',
            hand: botHand(),
            calledCambio: false,
            cardCount: 4,
            isBot: true,
          },
        ],
      }),
  },
  {
    id: 'turns_start',
    type: 'info',
    title: 'Cards hide again',
    body: 'After everyone peeks, cards flip face down. On your turn: draw, then swap with your hand or discard.',
    highlight: 'draw-deck',
    rulesSection: 'turn',
    state: () =>
      baseState({
        phase: 'turns',
        initPeeksLeft: 0,
        initPeekMask: 3,
      }),
  },
  {
    id: 'draw',
    type: 'action',
    title: 'Draw from deck',
    body: 'Tap Draw deck to take a card.',
    highlight: 'draw-deck',
    rulesSection: 'turn',
    expect: { action: 'draw_deck' },
    state: () => baseState({ phase: 'turns' }),
  },
  {
    id: 'swap',
    type: 'action',
    title: 'Swap with your hand',
    body: 'You drew a 4♦. Tap one of your cards to swap — your old card goes to the discard pile.',
    highlight: 'hero-slot-2',
    rulesSection: 'turn',
    expect: { action: 'swap_card', slot: 2 },
    state: () =>
      baseState({
        phase: 'turns',
        hasDrawnCard: true,
        drawnCard: {
          card: '4♦',
          points: 4,
          hasAbility: false,
          ability: 'none',
        },
      }),
  },
  {
    id: 'ability_intro',
    type: 'info',
    title: 'Discard abilities',
    body: '7/8 peek an opponent card. 9/10 peek your own. J/Q blind swap. Black K look-and-switch. Discard (not swap) to use them.',
    highlight: 'draw-discard',
    rulesSection: 'abilities',
    state: () => baseState({ phase: 'turns', currentTurn: TUTORIAL_PLAYER }),
  },
  {
    id: 'ability_peek',
    type: 'info',
    title: 'Example: 7 or 8',
    body: 'If you discard a 7 or 8, tap one opponent card to peek at it. You may remember it for stacking later.',
    highlight: 'opponent-hand',
    rulesSection: 'abilities',
    state: () =>
      baseState({
        phase: 'turns',
        pendingAbility: 'peek_opponent',
        peekOpponentRemaining: 1,
      }),
  },
  {
    id: 'black_k',
    type: 'info',
    title: 'Black King',
    body: 'Discard a black King to peek one of your cards and one opponent card, then optionally swap them.',
    highlight: null,
    rulesSection: 'abilities',
    state: () =>
      baseState({
        phase: 'turns',
        pendingAbility: 'look_and_switch',
        lookSwitch: { mySlot: -1, peekDone: false },
      }),
  },
  {
    id: 'stack_intro',
    type: 'info',
    title: 'Stack window',
    body: 'When someone discards a rank, anyone can stack a matching card on the discard pile during the brief window.',
    highlight: 'hero-hand',
    rulesSection: 'stack',
    state: () =>
      baseState({
        phase: 'turns',
        topDiscard: '8♠',
        topDiscardRank: 8,
        openStackRank: 8,
        stackRankClaimed: false,
        players: [
          {
            id: TUTORIAL_PLAYER,
            name: 'You',
            hand: [
              hiddenSlot(),
              hiddenSlot(),
              knownSlot('8♥'),
              hiddenSlot(),
            ],
            calledCambio: false,
            cardCount: 4,
            isBot: false,
          },
          {
            id: TUTORIAL_BOT,
            name: 'Bot 1',
            hand: botHand(),
            calledCambio: false,
            cardCount: 4,
            isBot: true,
          },
        ],
      }),
  },
  {
    id: 'stack_snap',
    type: 'info',
    title: 'Snap your 8',
    body: 'You know you have an 8 — tap it to stack on the discard and dump those points.',
    highlight: 'hero-slot-2',
    rulesSection: 'stack',
    state: () =>
      baseState({
        phase: 'turns',
        topDiscard: '8♠',
        openStackRank: 8,
        stackRankClaimed: false,
        players: [
          {
            id: TUTORIAL_PLAYER,
            name: 'You',
            hand: [
              hiddenSlot(),
              hiddenSlot(),
              knownSlot('8♥'),
              hiddenSlot(),
            ],
            calledCambio: false,
            cardCount: 4,
            isBot: false,
          },
          {
            id: TUTORIAL_BOT,
            name: 'Bot 1',
            hand: botHand(),
            calledCambio: false,
            cardCount: 4,
            isBot: true,
          },
        ],
      }),
  },
  {
    id: 'stack_penalty',
    type: 'info',
    title: 'Wrong stack = penalty',
    body: 'Stack the wrong rank and you draw a penalty card into your hand. Only stack when you are sure.',
    highlight: null,
    rulesSection: 'stack',
    state: () => baseState({ phase: 'turns' }),
  },
  {
    id: 'cambio',
    type: 'info',
    title: 'Call Cambio',
    body: 'Think your hand is lowest? Call CAMBIO before drawing. Everyone else gets one last turn, then cards reveal.',
    highlight: 'call-cambio',
    rulesSection: 'cambio',
    state: () => baseState({ phase: 'turns', currentTurn: TUTORIAL_PLAYER }),
  },
  {
    id: 'final_round',
    type: 'info',
    title: 'Final round',
    body: 'After Cambio, play continues one round. All cards flip face up — lowest total wins.',
    highlight: null,
    rulesSection: 'cambio',
    state: () =>
      baseState({
        phase: 'final_round',
        players: [
          {
            id: TUTORIAL_PLAYER,
            name: 'You',
            hand: [
              knownSlot('3♠'),
              knownSlot('2♣'),
              knownSlot('K♥'),
              knownSlot('5♦'),
            ],
            calledCambio: true,
            cardCount: 4,
            isBot: false,
          },
          {
            id: TUTORIAL_BOT,
            name: 'Bot 1',
            hand: [
              { hasCard: true, card: '10♠', revealed: true },
              { hasCard: true, card: '4♣', revealed: true },
              { hasCard: true, card: '7♦', revealed: true },
              { hasCard: true, card: 'Q♥', revealed: true },
            ],
            calledCambio: false,
            cardCount: 4,
            isBot: true,
          },
        ],
      }),
  },
  {
    id: 'practice_ready',
    type: 'info',
    title: 'Ready to practice?',
    body: 'Next: a real solo game with hints. The bot waits — take your time. Open Rules anytime.',
    highlight: null,
    rulesSection: 'scoring',
    state: () => baseState({ phase: 'turns' }),
  },
];

export function getScriptStep(index) {
  return SCRIPT_STEPS[index] ?? null;
}

export function getScriptState(index) {
  const step = getScriptStep(index);
  if (!step?.state) return null;
  return typeof step.state === 'function' ? step.state() : step.state;
}

export function scriptStepCount() {
  return SCRIPT_STEPS.length;
}

export function matchesScriptExpect(step, action, data = {}) {
  if (!step || step.type !== 'action' || !step.expect) return false;
  const exp = step.expect;
  if (exp.action !== action) return false;
  if (exp.slot != null && exp.slot !== data.slot) return false;
  if (exp.targetId != null && exp.targetId !== data.targetId) return false;
  return true;
}

/** Simulate local state change after a scripted action. */
export function applyScriptAction(index, action, data = {}) {
  const step = getScriptStep(index);
  if (!step || step.type !== 'action') return getScriptState(index);

  if (step.id === 'draw_deck') {
    return baseState({
      phase: 'turns',
      hasDrawnCard: true,
      drawnCard: { card: '4♦', points: 4, hasAbility: false, ability: 'none' },
    });
  }
  if (step.id === 'swap') {
    return baseState({ phase: 'turns', topDiscard: '4♦', topDiscardRank: 4 });
  }
  if (step.id === 'peek_0') {
    return getScriptState(index + 1);
  }
  if (step.id === 'peek_1') {
    return baseState({ phase: 'turns', initPeeksLeft: 0, initPeekMask: 3 });
  }
  if (matchesScriptExpect(step, action, data)) {
    return getScriptState(index + 1) ?? getScriptState(index);
  }
  return getScriptState(index);
}
