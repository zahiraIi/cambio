import { RULEBOOK_SECTIONS } from '../content/cambioRules.js';
import { renderSectionBlocks } from './rulesRender.js';

export function createRulesModal() {
  const root = document.createElement('div');
  root.id = 'rulesModal';
  root.className = 'rules-modal hidden';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'rulesModalTitle');
  root.innerHTML = `
    <div class="rules-modal__backdrop" data-rules-close></div>
    <div class="rules-modal__panel">
      <header class="rules-modal__header">
        <h2 id="rulesModalTitle">Cambio Rules</h2>
        <button type="button" class="btn btn-small btn-secondary rules-modal__close" data-rules-close aria-label="Close">Close</button>
      </header>
      <nav class="rules-modal__nav" id="rulesNav"></nav>
      <div class="rules-modal__body" id="rulesBody"></div>
    </div>
  `;
  document.body.appendChild(root);

  const nav = root.querySelector('#rulesNav');
  const body = root.querySelector('#rulesBody');

  nav.innerHTML = RULEBOOK_SECTIONS.map(
    (s) => `<a href="#rule-${s.id}" class="rules-nav-link" data-rule-id="${s.id}">${s.title}</a>`,
  ).join('');

  body.innerHTML = RULEBOOK_SECTIONS.map(
    (s) => `
      <section id="rule-${s.id}" class="rules-section">
        <h3>${s.title}</h3>
        <div class="rules-section__body">${renderSectionBlocks(s.blocks)}</div>
      </section>`,
  ).join('');

  function open(sectionId) {
    root.classList.remove('hidden');
    document.body.classList.add('rules-open');
    if (sectionId) {
      const el = root.querySelector(`#rule-${sectionId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function close() {
    root.classList.add('hidden');
    document.body.classList.remove('rules-open');
  }

  root.querySelectorAll('[data-rules-close]').forEach((el) => {
    el.addEventListener('click', close);
  });

  nav.querySelectorAll('.rules-nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const id = link.dataset.ruleId;
      root.querySelector(`#rule-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !root.classList.contains('hidden')) {
      e.stopPropagation();
      close();
    }
  });

  return { root, open, close };
}
