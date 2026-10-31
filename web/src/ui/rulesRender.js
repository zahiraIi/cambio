import { cardBackHtml, cardFaceHtml } from './cards.js';

function miniCard(card, { faceDown = false, highlight = false, compact = true } = {}) {
  const inner =
    faceDown || card === 'back'
      ? cardBackHtml()
      : cardFaceHtml(card, { compact });
  const cls = ['rules-mini-card', highlight && 'rules-mini-card--hi'].filter(Boolean).join(' ');
  return `<div class="${cls}">${inner}</div>`;
}

function renderBlock(block) {
  switch (block.type) {
    case 'caption':
      return `<p class="rules-caption">${block.text}</p>`;

    case 'callout':
      return `<div class="rules-callout rules-callout--${block.variant || 'info'}">${block.text}</div>`;

    case 'cards':
      return `<div class="rules-card-row">${block.items
        .map(
          (item) => `
          <div class="rules-card-item">
            ${miniCard(item.card, { faceDown: item.faceDown, highlight: item.highlight })}
            ${item.label ? `<span class="rules-card-label">${item.label}</span>` : ''}
          </div>`,
        )
        .join('')}</div>`;

    case 'hand':
      return `<div class="rules-hand">${block.slots
        .map((slot, i) => {
          const faceDown = slot === 'back';
          const card = faceDown ? null : slot;
          const peek = block.peek?.includes(i);
          return `
          <div class="rules-hand-slot${peek ? ' rules-hand-slot--peek' : ''}">
            <span class="rules-slot-num">${i + 1}</span>
            ${miniCard(card || 'A♠', { faceDown, highlight: peek })}
          </div>`;
        })
        .join('')}</div>`;

    case 'flow':
      return `<div class="rules-flow">${block.steps
        .map(
          (step, i) => `
          <div class="rules-flow-step">
            <span class="rules-flow-icon" aria-hidden="true">${step.icon}</span>
            <span class="rules-flow-label">${step.label}</span>
            ${step.hint ? `<span class="rules-flow-hint">${step.hint}</span>` : ''}
          </div>
          ${i < block.steps.length - 1 ? '<span class="rules-flow-arrow" aria-hidden="true">→</span>' : ''}`,
        )
        .join('')}</div>`;

    case 'ability':
      return `<div class="rules-ability">
        <div class="rules-ability-cards">${(block.cards || [block.card])
          .map((c) => miniCard(c, { faceDown: c === 'back' }))
          .join('')}</div>
        <div class="rules-ability-body">
          <span class="rules-ability-icon" aria-hidden="true">${block.icon}</span>
          <div>
            <strong class="rules-ability-title">${block.title}</strong>
            <span class="rules-ability-desc">${block.desc}</span>
          </div>
        </div>
      </div>`;

    case 'stack-demo':
      return `<div class="rules-stack-demo">
        <div class="rules-stack-col">
          <span class="rules-stack-label">Your hand</span>
          ${miniCard(block.from, { highlight: true })}
        </div>
        <span class="rules-stack-arrow" aria-hidden="true">⬇ stack</span>
        <div class="rules-stack-col">
          <span class="rules-stack-label">Discard</span>
          <div class="rules-stack-pile">${miniCard(block.discard)}</div>
        </div>
      </div>`;

    case 'versus':
      return `<div class="rules-versus">
        <div class="rules-versus-side rules-versus-side--${block.left.variant || 'neutral'}">
          ${block.left.icon ? `<span class="rules-versus-icon">${block.left.icon}</span>` : ''}
          <strong>${block.left.title}</strong>
          <span>${block.left.text}</span>
        </div>
        <div class="rules-versus-side rules-versus-side--${block.right.variant || 'neutral'}">
          ${block.right.icon ? `<span class="rules-versus-icon">${block.right.icon}</span>` : ''}
          <strong>${block.right.title}</strong>
          <span>${block.right.text}</span>
        </div>
      </div>`;

    case 'scoreboard':
      return `<div class="rules-scoreboard">
        ${block.players
          .map(
            (p) => `
          <div class="rules-score-row${p.winner ? ' rules-score-row--win' : ''}">
            <span class="rules-score-name">${p.name}${p.winner ? ' ★' : ''}</span>
            <div class="rules-score-hand">${p.hand.map((c) => miniCard(c)).join('')}</div>
            <span class="rules-score-total">${p.total}</span>
          </div>`,
          )
          .join('')}
      </div>`;

    case 'pill':
      return `<span class="rules-pill rules-pill--${block.variant || 'gold'}">${block.text}</span>`;

    default:
      return '';
  }
}

export function renderSectionBlocks(blocks) {
  return `<div class="rules-viz">${blocks.map(renderBlock).join('')}</div>`;
}
