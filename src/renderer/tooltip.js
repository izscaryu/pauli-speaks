'use strict';
// Tooltips: one small label that names an icon button (or anything with data-tooltip) after half a second of
// hover, at once on keyboard focus, and goes on Esc, a click, scrolling or moving away. It replaces the
// browser's own title tooltip, which is slow, can't be styled and never shows for the keyboard: the title moves
// into data-tooltip, and into aria-label when the button has no name of its own. Loaded before app.js.

const Tooltip = (() => {
  const DELAY = 500;
  const GAP = 6;
  const SELECTOR = '[data-tooltip], .icon-btn[title], .icon-btn[aria-label]';
  let box = null;
  let owner = null;
  let timer = null;

  /** The text for a control, taking its title over the first time it is seen. */
  function text(node) {
    const title = node.getAttribute('title');
    if (title) {
      node.dataset.tooltip = title;
      if (!node.hasAttribute('aria-label')) node.setAttribute('aria-label', title);
      node.removeAttribute('title');
    }
    return node.dataset.tooltip || node.getAttribute('aria-label') || '';
  }

  function hide() {
    clearTimeout(timer);
    owner = null;
    if (box) box.hidden = true;
  }

  /** Below the control and centred on it, kept inside the window; above it when there is no room below. */
  function show(node) {
    const label = text(node);
    if (!label || !node.isConnected) return;
    if (!box) {
      box = document.createElement('div');
      box.className = 'tooltip';
      box.id = 'tooltip';
      box.setAttribute('role', 'tooltip');
      document.body.append(box);
    }
    owner = node;
    box.textContent = label;
    box.hidden = false;
    const r = node.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.min(Math.max(4, r.left + r.width / 2 - w / 2), innerWidth - w - 4);
    const top = r.bottom + GAP + h > innerHeight ? r.top - GAP - h : r.bottom + GAP;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  }

  function later(node) {
    clearTimeout(timer);
    text(node); // the title goes now, so the browser's own tooltip never shows
    owner = node;
    timer = setTimeout(() => show(node), DELAY);
  }

  document.addEventListener('pointerover', (e) => {
    const node = e.target.closest?.(SELECTOR);
    if (node === owner) return;
    hide();
    if (node) later(node);
  });
  document.addEventListener('pointerout', (e) => {
    const node = e.target.closest?.(SELECTOR);
    if (node && !node.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const node = e.target.closest?.(SELECTOR);
    if (node && node.matches(':focus-visible')) show(node);
    else if (owner) hide();
  });
  document.addEventListener('focusout', () => { if (owner && !owner.matches(':hover')) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && owner) hide(); }, true);
  document.addEventListener('pointerdown', hide, true);
  // Scrolling moves the control: a shown tooltip follows a focused one (Tab scrolls it into view) and goes
  // otherwise; one that is still waiting to show is placed when it shows.
  document.addEventListener('scroll', () => {
    if (!box || box.hidden) return;
    if (owner && owner === document.activeElement) show(owner);
    else hide();
  }, true);

  return { hide };
})();
