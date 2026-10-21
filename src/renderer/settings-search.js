'use strict';
// Settings, split into sections you can jump to, with a search box that keeps only the rows that match.
// The matching is pure (CommonJS for the tests); in the window this sets up the box, the section links and the
// filtering of #page-settings. Loaded after app.js; uses t() from i18n.js.

(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.SettingsSearch = core.setupWindow(root);
})(typeof self !== 'undefined' ? self : this, () => {
  /** "Ključ" → "kljuc": lower case, no accents, so a search works however it is typed. */
  const fold = (s) => String(s || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/\p{M}/gu, '');

  /** Every word of the search is in the text, in any order. An empty search matches everything. */
  function matches(text, query) {
    const hay = fold(text);
    return fold(query).split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
  }

  /**
   * @param {{title: string, rows: string[]}[]} sections
   * @returns {{show: boolean, rows: boolean[]}[]} a matching title shows the whole section
   */
  function filterSections(sections, query) {
    return sections.map(({ title, rows }) => {
      if (matches(title, query)) return { show: true, rows: rows.map(() => true) };
      const shown = rows.map((r) => matches(r, query));
      return { show: shown.some(Boolean), rows: shown };
    });
  }

  function setupWindow() {
    const page = document.getElementById('page-settings');
    if (!page) return { apply() {} };
    const panels = () => [...page.querySelectorAll(':scope > section.panel')];
    const titleOf = (panel) => (panel.querySelector('h2') || {}).textContent || '';
    const rowsOf = (panel) => [...panel.querySelectorAll('.row')];

    const box = document.createElement('input');
    box.type = 'search';
    box.id = 'settings-search';
    box.placeholder = t('settings.search');
    box.setAttribute('aria-label', t('settings.search'));
    const sections = document.createElement('nav');
    sections.className = 'settings-sections';
    sections.setAttribute('aria-label', t('settings.sections'));
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.hidden = true;
    empty.setAttribute('role', 'status');
    empty.textContent = t('settings.search.none');

    function buildSections() {
      sections.replaceChildren(...panels().map((panel, i) => {
        if (!panel.id) panel.id = `settings-section-${i + 1}`;
        const link = document.createElement('a');
        link.href = `#${panel.id}`;
        link.textContent = titleOf(panel);
        link.addEventListener('click', (e) => {
          e.preventDefault();
          panel.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
          panel.querySelector('input, select, textarea, button')?.focus({ preventScroll: true });
        });
        return link;
      }));
    }

    function apply() {
      const list = panels();
      const result = filterSections(list.map((p) => ({ title: titleOf(p), rows: rowsOf(p).map((r) => r.textContent) })), box.value);
      list.forEach((panel, i) => {
        panel.hidden = !result[i].show;
        rowsOf(panel).forEach((row, j) => { row.hidden = !result[i].rows[j]; });
      });
      [...sections.children].forEach((link, i) => { link.hidden = !result[i] || !result[i].show; });
      empty.hidden = result.some((r) => r.show);
    }

    const head = page.querySelector('.topbar');
    head.after(sections);
    head.append(box);
    sections.after(empty);
    buildSections();
    box.addEventListener('input', apply);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.value) { e.stopPropagation(); box.value = ''; apply(); } });
    // Panels that redraw themselves (AI polish, models) keep the filter.
    new MutationObserver(() => { if (box.value) apply(); }).observe(page, { childList: true, subtree: true });
    return { apply };
  }

  return { matches, filterSections, setupWindow };
});
