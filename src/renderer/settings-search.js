'use strict';
// Settings in two panes: a list of sections (General, Speech & microphone, … About & updates) with a search box on
// top, and the chosen section beside it; on a narrow window the list is a page of its own and a section opens with
// "‹ Settings". The search looks through every section, and through the other pages' settings too.
// The matching is pure (CommonJS for the tests); in the window this sets up the box, the section list and the
// filtering of #page-settings. Loaded after app.js; uses t() from i18n.js and showPage and ACTION_INFO from app.js.

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

  /**
   * The other pages' settings that a search can find, as { label: "Shortcuts › Read aloud", page }.
   * @param {{page: string, pageName: string, items: string[]}[]} pages
   */
  function otherMatches(pages, query) {
    if (!String(query || '').trim()) return [];
    return pages.flatMap(({ page, pageName, items }) => items
      .filter((item) => matches(`${pageName} ${item}`, query))
      .map((item) => ({ label: `${pageName} › ${item}`, page })));
  }

  function setupWindow() {
    const page = document.getElementById('page-settings');
    if (!page) return { apply() {}, jump() {} };
    const nav = page.querySelector('.settings-nav');
    const links = [...nav.querySelectorAll('a[data-section]')];
    const sectionsOf = () => [...page.querySelectorAll('.settings-section')];
    const panels = () => [...page.querySelectorAll('.settings-section > .panel')];
    const titleOf = (panel) => (panel.querySelector('h3') || {}).textContent || '';
    // Rows that their own code hides (a part of the panel that doesn't apply) are left out of the search, and the
    // search hides with its own class, so it never shows what that code hid.
    const rowsOf = (panel) => [...panel.querySelectorAll('.row')].filter((row) => !row.parentElement.closest('[hidden]') && !row.hidden);
    const miss = (node, on) => node.classList.toggle('search-miss', on);
    const empty = document.getElementById('settings-none');
    const other = document.getElementById('settings-other');

    const box = document.createElement('input');
    box.type = 'search';
    box.id = 'settings-search';
    box.placeholder = t('settings.search');
    box.setAttribute('aria-label', t('settings.search'));
    nav.prepend(box);

    // ---- one section at a time

    let current = 'general';
    /** Shows a section (and, on a narrow window, opens it from the list); `focus` puts a screen reader on its title. */
    function open(name, { focus = false } = {}) {
      current = name;
      sectionsOf().forEach((s) => s.classList.toggle('current', s.dataset.section === name));
      links.forEach((a) => {
        if (a.dataset.section === name) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      page.dataset.view = 'section';
      page.closest('main').scrollTop = 0;
      if (focus) {
        const title = page.querySelector(`.settings-section[data-section="${name}"] .section-title`);
        if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
      }
    }
    links.forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      if (box.value) { box.value = ''; apply(); }
      open(a.dataset.section, { focus: true });
    }));
    // Narrow: "‹ Settings" goes back to the list of sections.
    document.getElementById('settings-back').addEventListener('click', () => {
      page.dataset.view = 'list';
      nav.querySelector(`a[data-section="${current}"]`)?.focus();
    });

    /**
     * Opens the section that holds `target` (a card or a part of one), brings it to the top and focuses its
     * heading, so a screen reader starts there. A short last card gets room below it (until the page is left) so it
     * can reach the top.
     */
    function jump(target) {
      const main = page.closest('main');
      const section = target && target.closest('.settings-section');
      if (!section || !main) return;
      if (box.value) { box.value = ''; apply(); }
      open(section.dataset.section);
      if (target.tagName === 'DETAILS') target.open = true;
      const panel = target.closest('.panel') || target;
      const below = page.getBoundingClientRect().bottom - panel.getBoundingClientRect().top - (parseFloat(page.style.paddingBottom) || 0);
      page.style.paddingBottom = below < main.clientHeight ? `${Math.ceil(main.clientHeight - below)}px` : '';
      panel.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      const heading = panel === section ? section.querySelector('.section-title') : panel.querySelector('h3');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
    // The added room goes once the page is left.
    new MutationObserver(() => { if (page.hidden) page.style.paddingBottom = ''; }).observe(page, { attributes: true, attributeFilter: ['hidden'] });

    // ---- search: every section at once, and the other pages

    /** What a search can find on the other pages: the shortcuts, the parts of a mode, Dictionary, History, Files. */
    function otherPages() {
      const name = (p) => (document.querySelector(`.nav[data-page="${p}"] .nav-label`) || {}).textContent || p;
      const actions = typeof ACTION_INFO !== 'undefined' ? ACTION_INFO.map((a) => t(`action.${a.action}.title`)) : [];
      return [
        { page: 'shortcuts', pageName: name('shortcuts'), items: [...actions, t('voice.title'), t('shortcuts.test')] },
        { page: 'modes', pageName: name('modes'), items: [t('modes.name'), t('modes.language'), t('modes.styleLabel'), t('modes.apps'), t('modes.polish')] },
        { page: 'dictionary', pageName: name('dictionary'), items: [t('dictionary.title'), t('snippets.title')] },
        { page: 'files', pageName: name('files'), items: [t('files.title')] },
      ];
    }

    function apply() {
      const query = box.value;
      const searching = Boolean(query.trim());
      page.classList.toggle('searching', searching);
      const list = panels();
      const result = filterSections(list.map((p) => ({ title: titleOf(p), rows: rowsOf(p).map((r) => r.textContent) })), query);
      list.forEach((panel, i) => {
        miss(panel, !result[i].show);
        panel.querySelectorAll('.row.search-miss').forEach((row) => miss(row, false));
        rowsOf(panel).forEach((row, j) => miss(row, !result[i].rows[j]));
        if (searching && result[i].show && panel.tagName === 'DETAILS') panel.open = true;
      });
      sectionsOf().forEach((s) => miss(s, searching && ![...s.querySelectorAll(':scope > .panel')].some((p) => !p.classList.contains('search-miss'))));
      links.forEach((a) => miss(a, searching && page.querySelector(`.settings-section[data-section="${a.dataset.section}"]`).classList.contains('search-miss')));
      const elsewhere = otherMatches(otherPages(), query);
      other.hidden = !elsewhere.length;
      document.getElementById('settings-other-list').replaceChildren(...elsewhere.map((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn link';
        b.textContent = m.label;
        b.addEventListener('click', () => showPage(m.page)); // app.js
        const row = document.createElement('div');
        row.className = 'row';
        row.append(b);
        return row;
      }));
      empty.hidden = !searching || result.some((r) => r.show) || elsewhere.length > 0;
    }

    box.addEventListener('input', apply);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.value) { e.stopPropagation(); box.value = ''; apply(); } });
    // Panels that redraw themselves (AI polish, models) keep the filter.
    new MutationObserver((records) => {
      if (box.value && records.some((r) => !other.contains(r.target))) apply();
    }).observe(page, { childList: true, subtree: true });
    open('general');
    page.dataset.view = 'list'; // on a narrow window, Settings starts at its list
    return { apply, jump: (id) => jump(document.getElementById(id)), open };
  }

  return { matches, filterSections, otherMatches, setupWindow };
});
