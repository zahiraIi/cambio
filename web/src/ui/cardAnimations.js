import { cardBackHtml, cardFaceHtml, cardIsRed } from './cards.js';

const CARD_FLIGHT = { holdMs: 420, flyMs: 720 };

let activeFlights = 0;

export function hasActiveFlight() {
  return activeFlights > 0;
}

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

function measureDrawnCardLanding(drawnArea) {
  const card = drawnArea?.querySelector('.drawn-card-display');
  if (!drawnArea || !card) return null;

  const wasHidden = drawnArea.classList.contains('hidden');
  const prevVis = drawnArea.style.visibility;
  drawnArea.classList.remove('hidden');
  drawnArea.style.visibility = 'hidden';
  drawnArea.style.pointerEvents = 'none';
  const rect = card.getBoundingClientRect();
  if (wasHidden) drawnArea.classList.add('hidden');
  drawnArea.style.visibility = prevVis;
  drawnArea.style.pointerEvents = '';
  if (rect.width > 0 && rect.height > 0) return rect;

  const { w, h } = playerCardSize();
  const hand = document.getElementById('ptPlayerHand')?.getBoundingClientRect();
  const float = drawnArea.getBoundingClientRect();
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

function animateCardFlight(cardText, refs, opts = {}) {
  const layer = refs.flyLayer;
  if (!layer || !cardText) return false;

  const {
    fromEl,
    toEl,
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
  activeFlights += 1;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.add('is-holding');
      flip.style.transform = `rotateY(${startFace}deg) scale(1.14) translateZ(24px)`;
    });
  });

  const finish = () => {
    activeFlights = Math.max(0, activeFlights - 1);
    onComplete?.();
  };

  const flyTimer = setTimeout(() => {
    root.classList.remove('is-holding');
    root.classList.add('is-flying');

    const easing = 'cubic-bezier(0.33, 1, 0.38, 1)';
    track.style.transition = `transform ${flyMs}ms ${easing}`;
    flip.style.transition = `transform ${flyMs}ms ${easing}`;

    track.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    flip.style.transform = `rotateY(${endFace}deg) scale(0.96) translateZ(0)`;
  }, holdMs);

  setTimeout(() => {
    root.classList.add('is-done');
    setTimeout(() => {
      clearTimeout(flyTimer);
      root.remove();
      finish();
    }, 160);
  }, holdMs + flyMs);

  return true;
}

export function createCardAnimations(refs) {
  function flyToDiscard(cardText, opts = {}) {
    return animateCardFlight(cardText, refs, {
      fromEl: opts.fromEl,
      toEl: refs.discard,
      startFace: 0,
      endFace: 180,
      ...opts,
    });
  }

  function revealDrawnCardUI() {
    refs.onRevealDrawn?.();
  }

  function flyToDrawnSlot(cardText, fromEl, opts = {}) {
    refs.drawnArea?.classList.add('hidden');
    requestAnimationFrame(() => {
      const landing = measureDrawnCardLanding(refs.drawnArea);
      const started = animateCardFlight(cardText, refs, {
        fromEl,
        toRect: landing,
        onComplete: revealDrawnCardUI,
        ...opts,
      });
      if (!started) revealDrawnCardUI();
    });
  }

  return {
    hasActiveFlight,
    flyFromDeck(cardText, opts = {}) {
      flyToDrawnSlot(cardText, refs.deck, { startFace: 180, endFace: 0, ...opts });
    },
    flyFromDiscardToDrawn(cardText, opts = {}) {
      flyToDrawnSlot(cardText, refs.discard, { startFace: 0, endFace: 0, ...opts });
    },
    flyToDiscard(cardText, opts = {}) {
      flyToDiscard(cardText, opts);
    },
    flyToHandSlot(cardText, fromEl, slot, opts = {}) {
      const toEl = refs.hand?.querySelector(`[data-slot="${slot}"]`);
      return animateCardFlight(cardText, refs, {
        fromEl,
        toEl: toEl || refs.hand,
        startFace: 0,
        endFace: 360,
        ...opts,
      });
    },
  };
}
