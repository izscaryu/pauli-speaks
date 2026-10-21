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
    // Rows that their own code hides (a part of the panel that doesn't apply) are left out of the search, and the
    // search hides with its own class, so it never shows what that code hid.
    const rowsOf = (panel) => [...panel.querySelectorAll('.row')].filter((row) => !row.parentElement.closest('[hidden]') && !row.hidden);
    const miss = (node, on) => node.classList.toggle('search-miss', on);

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
          jump(panel);
        });
        return link;
      }));
    }

    /**
     * Brings a section to the top of the window and focuses its heading, so a screen reader starts there. The last
     * sections are shorter than the window: room is added below them (until the page is left) so they reach the top.
     */
    function jump(panel) {
      const main = page.closest('main');
      if (!panel || !main) return;
      const below = page.getBoundingClientRect().bottom - panel.getBoundingClientRect().top - (parseFloat(page.style.paddingBottom) || 0);
      page.style.paddingBottom = below < main.clientHeight ? `${Math.ceil(main.clientHeight - below)}px` : '';
      panel.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      const heading = panel.querySelector('h2');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
    // The added room goes once the page is left.
    new MutationObserver(() => { if (page.hidden) page.style.paddingBottom = ''; }).observe(page, { attributes: true, attributeFilter: ['hidden'] });

    function apply() {
      const list = panels();
      const result = filterSections(list.map((p) => ({ title: titleOf(p), rows: rowsOf(p).map((r) => r.textContent) })), box.value);
      list.forEach((panel, i) => {
        miss(panel, !result[i].show);
        panel.querySelectorAll('.row.search-miss').forEach((row) => miss(row, false));
        rowsOf(panel).forEach((row, j) => miss(row, !result[i].rows[j]));
      });
      [...sections.children].forEach((link, i) => miss(link, !result[i] || !result[i].show));
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
    return { apply, jump: (id) => jump(document.getElementById(id)) };
  }

  return { matches, filterSections, setupWindow };
});
