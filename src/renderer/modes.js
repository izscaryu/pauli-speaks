'use strict';
// The Modes page (docs/design/redesign-concept.html): the modes on the left, the chosen one's editor on the right -
// name, colour, language, translation, style, voice commands, the apps that switch it on (with recent apps from
// History to pick from) and the shortcuts and link that open it. The main process checks every change (modes.js).
// Loaded after app.js; uses these app.js globals: api, $, el, save, settings, toast, ICONS, LANGUAGES, LANG_NAME,
// STYLES, bindingChips, recentApps, modelState, showPage.

const Modes = (() => {
  const BUILTIN = new Set(['default', 'chat', 'code', 'formal', 'translate']);
  const PALETTE = ['#8b867b', '#2f6db3', '#2e7d9a', '#7c5a8a', '#c8553d', '#b7741a', '#3d8b5a', '#a33d6b'];
  const MAX_MODES = 20;
  let selected = 'default';
  let protocol = 'pauli-speaks';

  /** The name to show: the one given, or a built-in mode's name in the UI language. */
  function label(m) {
    if (!m) return '';
    if (m.name) return m.name;
    if (m.id === 'translate') return t('modes.builtin.translate', { language: I18n.languageName(m.translateTo || 'en') });
    return BUILTIN.has(m.id) ? t(`modes.builtin.${m.id}`) : m.id;
  }

  const find = (id) => (settings.modes || []).find((m) => m.id === id) || null;
  const appName = (exe) => exe.replace(/\.exe$/i, '');

  /** "Translate → English · Formal · outlook, olk" */
  function summary(m) {
    const language = m.translateTo
      ? t('modes.summary.translate', { language: LANG_NAME[m.translateTo] || m.translateTo.toUpperCase() })
      : m.language ? LANG_NAME[m.language] || m.language.toUpperCase() : t('modes.language.yours');
    const apps = m.id === 'default' ? t('modes.summary.fallback')
      : m.apps.length ? m.apps.slice(0, 2).map(appName).join(', ') + (m.apps.length > 2 ? ' …' : '') : t('modes.summary.manual');
    return [language, t(`modes.style.${m.style}`), apps].join(' · ');
  }

  /** Dictate shortcuts that open a mode. */
  const bindingsFor = (id) => (settings.bindings || []).filter((b) => b.action === 'dictate' && b.mode === id);

  function update(patch, message) {
    return save({ modes: settings.modes.map((m) => (m.id === selected ? { ...m, ...patch } : m)) }, message);
  }

  /** "Bilješke (HR)" → "biljeske-hr", as modes.js makes ids. */
  const slug = (s) => String(s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  /**
   * A new mode keeps the id from its first name ("new-mode") until it is named; then the id follows the name,
   * so its link reads ?mode=croatian-chat. Shortcuts already pointing to it move along.
   */
  function rename(m, name) {
    const fresh = new RegExp(`^${slug(t('modes.newName'))}(-\\d+)?$`).test(m.id) && (!m.name || m.name === t('modes.newName')) && name && slug(name);
    if (!fresh) return update({ name });
    // The new id is chosen here, before saving, so a re-render on the way never loses the selection.
    const used = new Set(settings.modes.filter((x) => x.id !== m.id).map((x) => x.id));
    const base = slug(name).slice(0, 36).replace(/-+$/, '') || 'mode';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    selected = id;
    return save({
      modes: settings.modes.map((x) => (x.id === m.id ? { ...x, id, name } : x)),
      bindings: settings.bindings.map((b) => (b.mode === m.id ? { ...b, mode: id } : b)),
    });
  }

  // ---------------------------------------------------------------- the editor's fields

  const field = (title, hint, ...control) => el('div', { class: 'field' },
    el('div', { class: 'lbl' }, title, hint ? el('small', {}, hint) : null), el('div', { class: 'ctl' }, ...control));

  function nameField(m) {
    const input = el('input', { id: 'mode-name', type: 'text', maxlength: '40', value: m.name, placeholder: label({ ...m, name: '' }), 'aria-label': t('modes.name') });
    input.addEventListener('change', () => rename(m, input.value.trim()));
    return field(t('modes.name'), null, input);
  }

  function colourField(m) {
    return field(t('modes.colour'), null, el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': t('modes.colour') },
      ...PALETTE.map((c, i) => el('button', {
        class: 'swatch', type: 'button', role: 'radio', style: `background:${c}`, 'aria-checked': String(m.color === c),
        'aria-label': t('modes.colourN', { n: i + 1 }), onclick: () => m.color !== c && update({ color: c }),
      }))));
  }

  function languageField(m) {
    const select = el('select', { id: 'mode-language', 'aria-label': t('modes.language') },
      el('option', { value: '' }, t('modes.language.yours')),
      ...LANGUAGES.map(([c, n]) => el('option', { value: c, selected: m.language === c }, n)));
    select.addEventListener('change', () => update({ language: select.value || null }));
    return field(t('modes.language'), t('modes.language.hint'), select);
  }

  function translateField(m) {
    const supported = modelState?.translator?.languages || LANGUAGES.map(([c]) => c);
    const select = el('select', { id: 'mode-translate', 'aria-label': t('translation.target.title') },
      el('option', { value: '' }, t('modes.translate.off')),
      ...LANGUAGES.filter(([c]) => supported.includes(c)).map(([c, n]) => el('option', { value: c, selected: m.translateTo === c }, n)));
    select.addEventListener('change', () => update({ translateTo: select.value || null }));
    return field(t('translation.target.title'), t('modes.translate.hint'), select);
  }

  function styleField(m) {
    const select = el('select', { id: 'mode-style', 'aria-label': t('modes.styleLabel') },
      ...STYLES.map((k) => el('option', { value: k, selected: m.style === k }, t(`styles.option.${k}`))));
    select.addEventListener('change', () => update({ style: select.value }));
    return field(t('modes.styleLabel'), t('modes.style.hint'), select);
  }

  function voiceField(m) {
    const input = el('input', { id: 'mode-voice', type: 'checkbox', checked: m.voiceCommands, 'aria-label': t('voice.title') });
    input.addEventListener('change', () => update({ voiceCommands: input.checked }));
    return field(t('voice.title'), t(settings.voiceCommandsEnabled ? 'modes.voice.hint' : 'modes.voice.off'), el('label', { class: 'switch' }, input, el('span')));
  }

  function appsField(m) {
    if (m.id === 'default') return field(t('modes.apps'), null, el('span', { class: 'desc' }, t('modes.apps.default')));
    const add = (raw) => {
      const name = raw.trim().toLowerCase();
      if (!name) return;
      const exe = name.endsWith('.exe') ? name : `${name}.exe`;
      if (m.apps.includes(exe)) return toast(t('modes.apps.already', { name: exe }));
      update({ apps: [...m.apps, exe] }, t('common.addedItem', { name: exe }));
    };
    const input = el('input', { id: 'mode-app', type: 'text', list: 'mode-recent-apps', placeholder: t('styles.appFile'), 'aria-label': t('modes.apps.add') });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(input.value); } });
    const recent = recentApps.filter((a) => !m.apps.includes(a.toLowerCase())).slice(0, 6);
    return field(t('modes.apps'), t('modes.apps.hint'), el('div', { class: 'app-chips' },
      ...m.apps.map((a) => el('span', { class: 'app-chip' }, a, el('button', {
        type: 'button', title: t('common.remove'), 'aria-label': t('common.removeItem', { name: a }), html: ICONS.x,
        onclick: () => update({ apps: m.apps.filter((x) => x !== a) }, t('common.removedItem', { name: a })),
      }))),
      el('span', { class: 'app-add' }, input, el('button', { class: 'btn', type: 'button', onclick: () => add(input.value) }, t('common.add'))),
      el('datalist', { id: 'mode-recent-apps' }, ...recent.map((a) => el('option', { value: a }))),
      recent.length ? el('div', { class: 'recent-apps' }, el('span', { class: 'desc' }, t('modes.apps.recent')),
        ...recent.map((a) => el('button', { class: 'btn quiet small', type: 'button', 'aria-label': t('modes.apps.addRecent', { name: a }), onclick: () => add(a) }, `+ ${a}`))) : null));
  }

  function startField(m) {
    const binds = bindingsFor(m.id);
    const link = `${protocol}://dictate/toggle?mode=${m.id}`;
    return field(t('modes.start'), t('modes.start.hint'), el('div', { class: 'start-with' },
      el('div', { class: 'app-chips' },
        ...(binds.length ? binds.map((b) => el('span', { class: 'chips' }, bindingChips(b))) : [el('span', { class: 'desc' }, t('modes.start.none'))]),
        el('button', { class: 'btn quiet', type: 'button', onclick: () => showPage('shortcuts') }, t(binds.length ? 'modes.start.change' : 'modes.start.add'))),
      el('div', { class: 'link' }, el('code', {}, link),
        el('button', { class: 'icon-btn', type: 'button', title: t('common.copy'), 'aria-label': t('common.copyItem', { name: link }), html: ICONS.copy,
          onclick: async () => { await api.copy(link); toast(t('common.copied')); } }))));
  }

  // ---------------------------------------------------------------- the page

  function render() {
    if (!settings || !settings.modes) return;
    const modes = settings.modes;
    if (!find(selected)) selected = 'default';
    $('#mode-count').textContent = I18n.num(modes.length);
    $('#mode-new').disabled = modes.length >= MAX_MODES;
    $('#mode-list').replaceChildren(...modes.map((m) => el('li', {},
      el('button', { class: 'mode-item', type: 'button', 'aria-current': String(m.id === selected), onclick: () => { selected = m.id; render(); } },
        el('span', { class: 'dot', style: `background:${m.color}` }),
        el('span', {}, el('b', {}, label(m)), el('span', { class: 'sub' }, summary(m)))))));
    const m = find(selected);
    const focused = document.activeElement && document.activeElement.id;
    $('#mode-detail').replaceChildren(
      el('div', { class: 'mode-head' }, el('span', { class: 'dot big', style: `background:${m.color}` }), el('h2', {}, label(m)),
        m.id === 'default' ? null : el('button', { class: 'btn danger quiet', type: 'button', onclick: () => remove(m) }, t('modes.delete'))),
      nameField(m), colourField(m), startField(m), appsField(m), languageField(m), translateField(m), styleField(m), voiceField(m));
    if (focused && focused.startsWith('mode-') && $(`#${focused}`)) $(`#${focused}`).focus();
  }

  async function remove(m) {
    if (!confirm(t('modes.deleteConfirm', { name: label(m) }))) return;
    selected = 'default';
    // Shortcuts that opened it go back to Automatic.
    const bindings = settings.bindings.map((b) => (b.mode === m.id ? (({ mode, ...rest }) => rest)(b) : b));
    await save({ modes: settings.modes.filter((x) => x.id !== m.id), bindings }, t('common.removedItem', { name: label(m) }));
  }

  $('#mode-new').addEventListener('click', async () => {
    const before = new Set(settings.modes.map((m) => m.id));
    await save({ modes: [...settings.modes, { name: t('modes.newName'), color: PALETTE[settings.modes.length % PALETTE.length] }] }, null);
    selected = (settings.modes.find((m) => !before.has(m.id)) || settings.modes.at(-1)).id;
    render();
    $('#mode-name')?.focus();
    $('#mode-name')?.select();
  });

  /** The mode dropdown on a Dictate shortcut: Automatic (the app in front decides) or one mode. */
  function bindingSelect(b, keysLabel) {
    const select = el('select', { class: 'mode-select', 'aria-label': t('shortcuts.modeFor', { keys: keysLabel }) },
      el('option', { value: '' }, t('shortcuts.modeAuto')),
      ...(settings.modes || []).map((m) => el('option', { value: m.id, selected: b.mode === m.id }, label(m))));
    select.addEventListener('change', () => {
      const pick = select.value;
      const bindings = settings.bindings.map((x) => (x.id !== b.id ? x : pick ? { ...x, mode: pick } : (({ mode, ...rest }) => rest)(x)));
      save({ bindings }, t('shortcuts.modeSaved', { keys: keysLabel, mode: pick ? label(find(pick)) : t('shortcuts.modeAuto') }));
    });
    return select;
  }

  return {
    render, label, bindingSelect, find,
    /** The link scheme (app info), for the "Start with" link. */
    setProtocol(p) { protocol = p || protocol; },
  };
})();
