/** Full Cambio rule reference — visual blocks aligned with internal/game rules. */
export const RULEBOOK_SECTIONS = [
  {
    id: 'goal',
    title: 'Goal',
    blocks: [
      { type: 'caption', text: 'Four face-down cards. Lowest total wins.' },
      {
        type: 'hand',
        slots: ['back', 'back', 'back', 'back'],
      },
      { type: 'pill', text: 'Lowest score wins', variant: 'gold' },
      { type: 'caption', text: 'Card values' },
      {
        type: 'cards',
        items: [
          { card: 'A♠', label: '1' },
          { card: '5♥', label: '5' },
          { card: 'K♣', label: '10' },
          { card: 'K♥', label: '−1' },
          { card: '🃏', label: '0' },
        ],
      },
      {
        type: 'callout',
        variant: 'info',
        text: 'You only see cards when you peek — starting peek, abilities, or end of round.',
      },
    ],
  },
  {
    id: 'setup',
    title: 'Setup',
    blocks: [
      { type: 'caption', text: 'Deal four cards face down. Peek slots 1 & 2 only.' },
      {
        type: 'hand',
        slots: ['3♠', '7♥', 'back', 'back'],
        peek: [0, 1],
      },
      {
        type: 'flow',
        steps: [
          { icon: '👁', label: 'Peek 1 & 2', hint: 'once each' },
          { icon: '🔄', label: 'Face down', hint: 'memory fades' },
          { icon: '▶', label: 'Play begins' },
        ],
      },
    ],
  },
  {
    id: 'turn',
    title: 'Your Turn',
    blocks: [
      {
        type: 'flow',
        steps: [
          { icon: '🎴', label: 'Draw', hint: 'deck or discard' },
          { icon: '↔', label: 'Swap', hint: 'with hand card' },
          { icon: '🗑', label: 'Discard', hint: 'use ability' },
        ],
      },
      {
        type: 'versus',
        left: {
          icon: '↔',
          title: 'Swap',
          text: 'Replace a hand card — old card goes to discard.',
          variant: 'good',
        },
        right: {
          icon: '✨',
          title: 'Discard',
          text: 'Return drawn card face up — triggers ability if any.',
          variant: 'info',
        },
      },
      {
        type: 'callout',
        variant: 'warn',
        text: 'Finish any pending ability before drawing, Cambio, or stacking.',
      },
    ],
  },
  {
    id: 'abilities',
    title: 'Abilities',
    blocks: [
      { type: 'caption', text: 'Discard (not swap) to use these effects:' },
      {
        type: 'ability',
        cards: ['7♠', '8♥'],
        icon: '👁',
        title: '7 or 8',
        desc: 'Peek one opponent card',
      },
      {
        type: 'ability',
        cards: ['9♦', '10♣'],
        icon: '👁',
        title: '9 or 10',
        desc: 'Peek one of your cards',
      },
      {
        type: 'ability',
        card: 'J♠',
        icon: '🔀',
        title: 'J or Q',
        desc: 'Blind swap with an opponent',
      },
      {
        type: 'ability',
        cards: ['K♠', 'K♣'],
        icon: '👁↔',
        title: 'Black King',
        desc: 'Peek yours + theirs — swap optional',
      },
    ],
  },
  {
    id: 'stack',
    title: 'Stack',
    blocks: [
      { type: 'caption', text: 'After a discard, matching ranks can stack on the pile.' },
      {
        type: 'stack-demo',
        from: '8♥',
        discard: '8♠',
      },
      {
        type: 'ability',
        card: '8♥',
        icon: '⚡',
        title: 'Snap',
        desc: 'Stack your matching card from hand',
      },
      {
        type: 'ability',
        card: 'back',
        icon: '🎯',
        title: 'Stack opponent',
        desc: 'Stack a peeked opponent card — give them one of yours',
      },
      {
        type: 'versus',
        left: {
          icon: '✓',
          title: 'Right rank',
          text: 'Card leaves your hand — points dumped.',
          variant: 'good',
        },
        right: {
          icon: '✗',
          title: 'Wrong rank',
          text: 'Penalty card drawn to your hand.',
          variant: 'bad',
        },
      },
    ],
  },
  {
    id: 'cambio',
    title: 'Cambio',
    blocks: [
      { type: 'pill', text: 'CAMBIO', variant: 'cambio' },
      { type: 'caption', text: 'Call before drawing when you think you are winning.' },
      {
        type: 'flow',
        steps: [
          { icon: '📣', label: 'Call Cambio' },
          { icon: '🔁', label: 'One last turn', hint: 'each player' },
          { icon: '🃏', label: 'Reveal all' },
        ],
      },
      {
        type: 'callout',
        variant: 'info',
        text: 'Lowest revealed total wins the round.',
      },
    ],
  },
  {
    id: 'scoring',
    title: 'Scoring',
    blocks: [
      { type: 'caption', text: 'All cards flip face up — sum your values.' },
      {
        type: 'scoreboard',
        players: [
          {
            name: 'You',
            hand: ['3♠', '2♣', 'K♥', '5♦'],
            total: '9',
            winner: true,
          },
          {
            name: 'Opponent',
            hand: ['10♠', '4♣', '7♦', 'Q♥'],
            total: '31',
          },
        ],
      },
      {
        type: 'callout',
        variant: 'warn',
        text: 'Failed stacks add a penalty card (extra slot if hand is full).',
      },
    ],
  },
];
