/** Step coach overlay with spotlight on tutorial targets. */
export function createTutorialCoach() {
  const root = document.createElement('div');
  root.id = 'tutorialCoach';
  root.className = 'tutorial-coach hidden';
  root.innerHTML = `
    <div class="tutorial-coach__spotlight" id="tutorialSpotlight" aria-hidden="true"></div>
    <div class="tutorial-coach__card">
      <p class="tutorial-coach__progress" id="tutorialProgress"></p>
      <h3 class="tutorial-coach__title" id="tutorialTitle"></h3>
      <p class="tutorial-coach__body" id="tutorialBody"></p>
      <div class="tutorial-coach__actions">
        <button type="button" class="btn btn-small btn-secondary" id="tutorialBackBtn">Back</button>
        <button type="button" class="btn btn-small btn-secondary" id="tutorialRulesBtn">Rules</button>
        <button type="button" class="btn btn-small btn-secondary" id="tutorialSkipBtn">Skip</button>
        <button type="button" class="btn btn-small btn-primary hidden" id="tutorialContinueBtn">Continue</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const els = {
    spotlight: root.querySelector('#tutorialSpotlight'),
    progress: root.querySelector('#tutorialProgress'),
    title: root.querySelector('#tutorialTitle'),
    body: root.querySelector('#tutorialBody'),
    backBtn: root.querySelector('#tutorialBackBtn'),
    rulesBtn: root.querySelector('#tutorialRulesBtn'),
    skipBtn: root.querySelector('#tutorialSkipBtn'),
    continueBtn: root.querySelector('#tutorialContinueBtn'),
  };

  let onBack = null;
  let onSkip = null;
  let onContinue = null;
  let onRules = null;
  let highlightEl = null;

  els.backBtn.addEventListener('click', () => onBack?.());
  els.skipBtn.addEventListener('click', () => onSkip?.());
  els.continueBtn.addEventListener('click', () => onContinue?.());
  els.rulesBtn.addEventListener('click', () => onRules?.());

  function clearHighlight() {
    if (highlightEl) {
      highlightEl.classList.remove('tutorial-highlight');
      highlightEl = null;
    }
    els.spotlight.classList.remove('tutorial-coach__spotlight--active');
    els.spotlight.style.cssText = '';
  }

  function highlight(target) {
    clearHighlight();
    if (!target) return;
    const el =
      typeof target === 'string'
        ? document.querySelector(`[data-tutorial-id="${target}"]`) ||
          document.querySelector(target)
        : target;
    if (!el) return;
    highlightEl = el;
    el.classList.add('tutorial-highlight');
    const rect = el.getBoundingClientRect();
    const pad = 6;
    els.spotlight.classList.add('tutorial-coach__spotlight--active');
    els.spotlight.style.top = `${rect.top - pad}px`;
    els.spotlight.style.left = `${rect.left - pad}px`;
    els.spotlight.style.width = `${rect.width + pad * 2}px`;
    els.spotlight.style.height = `${rect.height + pad * 2}px`;
  }

  function show(step, { index, total, mode = 'script' }) {
    root.classList.remove('hidden');
    document.body.classList.add('tutorial-active');
    els.progress.textContent = `Step ${index + 1} of ${total}${mode === 'guided' ? ' · Practice' : ''}`;
    els.title.textContent = step.title || '';
    els.body.textContent = step.body || '';
    els.backBtn.classList.toggle('hidden', index <= 0);
    els.continueBtn.classList.toggle('hidden', step.type !== 'info' || mode === 'guided');
    els.skipBtn.textContent = mode === 'guided' ? 'Exit tutorial' : 'Skip tutorial';
    requestAnimationFrame(() => highlight(step.highlight));
  }

  function hide() {
    clearHighlight();
    root.classList.add('hidden');
    document.body.classList.remove('tutorial-active');
  }

  function setHandlers({ back, skip, continueFn, rules }) {
    onBack = back;
    onSkip = skip;
    onContinue = continueFn;
    onRules = rules;
  }

  window.addEventListener('resize', () => {
    if (!root.classList.contains('hidden') && highlightEl) {
      const rect = highlightEl.getBoundingClientRect();
      const pad = 6;
      els.spotlight.style.top = `${rect.top - pad}px`;
      els.spotlight.style.left = `${rect.left - pad}px`;
      els.spotlight.style.width = `${rect.width + pad * 2}px`;
      els.spotlight.style.height = `${rect.height + pad * 2}px`;
    }
  });

  return { root, els, show, hide, highlight, clearHighlight, setHandlers };
}
