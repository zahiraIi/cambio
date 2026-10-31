import { parseCardString, rankLabel } from '../api.js';

export function cardIsRed(cardStr) {
  return cardStr?.includes('♥') || cardStr?.includes('♦');
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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

export function cardFaceHtml(cardStr, opts = {}) {
  const { rankOnly = false, compact = false } = opts;
  const p = parseCardString(cardStr);
  if (rankOnly && p.label !== 'Joker') {
    const rank = p.label || rankLabel(p.rank);
    return `<div class="playing-card memory-rank-only"><span class="pc-rank-only">${escapeHtml(rank)}</span></div>`;
  }
  if (p.label === 'Joker' || cardStr === '🃏') {
    return `<div class="playing-card joker"><span class="pc-joker">🃏</span><span class="pc-joker-text">JOKER</span></div>`;
  }
  const text = p.text || cardStr;
  const parsed = parseCardString(text);
  const color = parsed.red ? 'red' : 'black';
  const rank = parsed.label;
  const suit = ['♠', '♥', '♦', '♣'][parsed.suit] || '♠';
  return `<div class="playing-card ${color}">
    ${cornerHtml(rank, suit, 'tl')}
    ${centerHtml(rank, suit, compact)}
    ${cornerHtml(rank, suit, 'br')}
  </div>`;
}

export function cardBackHtml() {
  return `<div class="playing-card playing-card-back"><div class="pc-back-inner"></div></div>`;
}
