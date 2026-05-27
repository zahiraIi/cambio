/** Guided practice hints — non-blocking coach text from live gameState. */

export function resolveGuidedHint(gameState, myPlayerId) {
  if (!gameState || !myPlayerId) return null;

  const phase = gameState.phase;
  const isMyTurn = gameState.currentTurn === myPlayerId;
  const pa = gameState.pendingAbility;
  const hasDrawn = gameState.hasDrawnCard || gameState.drawnCard?.card;

  if (phase === 'init_peek') {
    const left = gameState.initPeeksLeft ?? 2;
    const mask = gameState.initPeekMask ?? 0;
    if (left <= 0) return null;
    const slot = (mask & 1) === 0 ? 0 : 1;
    return {
      title: 'Starting peek',
      body: `Tap slot ${slot + 1} to peek your card.`,
      highlight: `hero-slot-${slot}`,
      rulesSection: 'setup',
    };
  }

  if (gameState.pendingStackGive) {
    return {
      title: 'Give a card',
      body: 'Pick one of your cards to give the opponent after your stack.',
      highlight: 'hero-hand',
      rulesSection: 'stack',
    };
  }

  if (pa && pa !== 'none' && isMyTurn) {
    const hints = {
      peek_opponent: {
        title: 'Peek opponent',
        body: 'Tap an opponent card to peek.',
        highlight: 'opponent-hand',
      },
      peek_own: {
        title: 'Peek your card',
        body: 'Tap one of your cards to look at it.',
        highlight: 'hero-hand',
      },
      blind_switch: {
        title: 'Blind switch',
        body: 'Tap your card, then an opponent card to swap blindly.',
        highlight: 'hero-hand',
      },
      look_and_switch: {
        title: 'Black King',
        body: 'Pick your card, then an opponent card. Swap or keep.',
        highlight: 'hero-hand',
      },
    };
    const h = hints[pa] || {
      title: 'Ability',
      body: 'Resolve the ability prompt on screen.',
      highlight: null,
    };
    return { ...h, rulesSection: 'abilities' };
  }

  if (
    phase === 'turns' &&
    gameState.openStackRank > 0 &&
    !gameState.stackRankClaimed
  ) {
    return {
      title: 'Stack open',
      body: `Rank ${gameState.openStackRank} was discarded — stack a match if you can.`,
      highlight: 'hero-hand',
      rulesSection: 'stack',
    };
  }

  if (hasDrawn && isMyTurn) {
    return {
      title: 'Your draw',
      body: 'Swap with a hand card or discard to the pile (use ability if shown).',
      highlight: 'hero-hand',
      rulesSection: 'turn',
    };
  }

  if (phase === 'turns' && isMyTurn && !hasDrawn && (!pa || pa === 'none')) {
    return {
      title: 'Your turn',
      body: 'Draw from deck or discard. Call Cambio if you think you are winning.',
      highlight: 'draw-deck',
      rulesSection: 'turn',
    };
  }

  if (phase === 'final_round') {
    return {
      title: 'Final round',
      body: 'One last turn each — then all cards reveal. Lowest score wins.',
      highlight: null,
      rulesSection: 'cambio',
    };
  }

  if (phase === 'scoring') {
    return {
      title: 'Round over',
      body: 'Compare totals. Exit tutorial or play again from the menu.',
      highlight: null,
      rulesSection: 'scoring',
    };
  }

  return {
    title: 'Practice mode',
    body: 'Explore at your pace. The bot will not act. Open Rules anytime.',
    highlight: null,
    rulesSection: 'goal',
  };
}
