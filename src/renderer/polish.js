'use strict';
// Settings → AI polish: where polish runs (off, Ollama, LM Studio, Foundry Local, the Cloud API or another URL), its
// model, what leaves the PC (said next to the choice), and a Test. Foundry Local is set up here: its models with
// size and licence, a download only after an in-page confirmation that names the size, progress, Cancel, Delete.
// Each mode's level is on the Modes page (modes.js). The main process checks every value (polish.js, polish-ipc.js).
// Loaded after app.js; uses these app.js globals: api, $, el, save, settings, toast, showPage.

const Polish = (() => {
  const PROVIDERS = ['off', 'ollama', 'lmstudio', 'foundry', 'cloud', 'custom'];
  const NAMES = { ollama: 'Ollama', lmstudio: 'LM Studio', foundry: 'Foundry Local' };
  const CLOUD_MODEL = 'llama-3.1-8b-instant';

  let servers = null; // polish:detect, for Ollama and LM Studio
  let finding = false;
  let foundry = null; // { list } | { error } | 'loading'
  let downloading = null; // { id, percent }
  let confirming = null; // model id waiting for the user's OK to download
  let testResult = null; // { ok, text }

  const p = () => settings.polish || { provider: 'off', baseUrl: '', model: '' };
  const hostOf = (url) => { try { return new URL(url).host; } catch { return url || '?'; } };
  const isLoopback = (url) => { try { return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(new URL(url).hostname); } catch { return false; } };
  const size = (mb) => (mb >= 1000
    ? `${I18n.num(mb / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB` : `${I18n.num(Math.round(mb))} MB`);

  /** What leaves the PC with this choice, said next to it. */
  function whereText() {
    const { provider, baseUrl } = p();
    if (provider === 'off') return t('polish.where.off');
    if (provider === 'foundry') return t('polish.where.foundry');
    if (provider === 'cloud') return t('polish.where.cloud', { host: hostOf(settings.cloud.baseUrl) });
    if (provider === 'custom') {
      if (!baseUrl) return t('polish.where.customUnset');
      return isLoopback(baseUrl) ? t('polish.where.local', { name: hostOf(baseUrl), host: hostOf(baseUrl) }) : t('polish.where.cloud', { host: hostOf(baseUrl) });
    }
    return t('polish.where.local', { name: NAMES[provider], host: hostOf(baseUrl || (provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234')) });
  }

  const row = (title, desc, ...control) => el('div', { class: 'row' },
    el('div', {}, el('div', { class: 'title' }, title), desc ? el('div', { class: 'desc' }, desc) : null), ...control);

  function providerRow() {
    const select = el('select', { id: 'polish-provider', 'aria-label': t('polish.provider.title') },
      ...PROVIDERS.map((k) => el('option', { value: k, selected: p().provider === k }, t(`polish.provider.${k}`))));
    select.addEventListener('change', () => {
      const provider = select.value;
      testResult = null;
      const patch = { provider, model: provider === 'cloud' ? CLOUD_MODEL : '', baseUrl: provider === 'custom' ? p().baseUrl : '' };
      save({ polish: patch }).then(() => { if (provider === 'ollama' || provider === 'lmstudio') find(); });
    });
    return row(t('polish.provider.title'), null, select);
  }

  // ---------------------------------------------------------------- Ollama, LM Studio

  async function find() {
    finding = true;
    render();
    try {
      servers = await api.findPolishServers();
    } catch (err) {
      console.error('finding servers failed', err);
      servers = [];
    }
    finding = false;
    const found = (servers || []).find((s) => s.provider === p().provider);
    // Only a server that answers is taken: its address, and its first model when none is chosen yet. One that
    // isn't running changes nothing, so a saved address is never replaced by a default nobody listens on.
    if (found && found.running) {
      const patch = {};
      if (p().baseUrl !== found.baseUrl) patch.baseUrl = found.baseUrl;
      if (!p().model && found.models.length) patch.model = found.models[0];
      if (Object.keys(patch).length) await save({ polish: patch }, null);
    }
    render();
  }

  function serverRows() {
    const { provider, model } = p();
    const found = servers && servers.find((s) => s.provider === provider);
    const status = finding ? t('polish.finding')
      : !found ? ''
        : !found.running ? t('polish.server.off', { name: NAMES[provider], host: hostOf(found.baseUrl) })
          : found.models.length ? t('polish.server.models', { name: NAMES[provider], count: found.models.length })
            : t('polish.server.none', { name: NAMES[provider] });
    const models = found ? found.models : [];
    const pick = models.length
      ? el('select', { id: 'polish-model', 'aria-label': t('polish.model.title') },
        ...(models.includes(model) || !model ? [] : [el('option', { value: model, selected: true }, model)]),
        ...models.map((m) => el('option', { value: m, selected: m === model }, m)))
      : el('input', { id: 'polish-model', value: model, placeholder: provider === 'ollama' ? 'qwen2.5:1.5b' : 'qwen2.5-1.5b-instruct', 'aria-label': t('polish.model.title') });
    pick.addEventListener('change', () => save({ polish: { model: pick.value.trim() } }));
    return [
      row(NAMES[provider], status || t('polish.server.hint', { name: NAMES[provider] }),
        el('button', { class: 'btn', type: 'button', disabled: finding, onclick: find }, t('polish.find'))),
      row(t('polish.model.title'), t('polish.model.desc'), pick),
    ];
  }

  // ---------------------------------------------------------------- Foundry Local

  async function loadFoundry() {
    foundry = 'loading';
    render();
    try {
      const list = await api.foundryCatalog();
      foundry = Array.isArray(list) ? { list } : { error: (list && list.error) || t('foundry.failed', { error: '?' }) };
    } catch (err) {
      foundry = { error: err.message };
    }
    render();
  }

  async function download(m) {
    confirming = null;
    downloading = { id: m.id, percent: 0 };
    render();
    const r = await api.foundryDownload(m.id);
    downloading = null;
    if (r.ok) {
      await save({ polish: { model: m.id } }, t('foundry.ready', { name: m.alias }));
      await loadFoundry();
    } else {
      if (!r.cancelled) toast(t('foundry.failed', { error: r.error }));
      render();
    }
  }

  async function remove(m) {
    const r = await api.foundryRemove(m.id);
    if (!r.ok) return toast(t('foundry.failed', { error: r.error }));
    if (p().model === m.id) await save({ polish: { model: '' } }, null);
    toast(t('foundry.deleted', { name: m.alias }));
    await loadFoundry();
  }

  function foundryModel(m) {
    const inUse = p().model === m.id;
    const info = `${size(m.sizeMb)} · ${m.license || '?'}${m.recommended ? ` · ${t('foundry.recommended')}` : ''}`;
    let action;
    if (downloading && downloading.id === m.id) {
      action = el('div', { class: 'inline' }, el('span', { id: 'foundry-progress', class: 'desc', role: 'status' }, t('foundry.downloading', { percent: downloading.percent })),
        el('button', { id: 'polish-foundry-cancel', class: 'btn', type: 'button', onclick: () => api.foundryCancel() }, t('common.cancel')));
    } else if (confirming === m.id) {
      action = el('div', { class: 'inline' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => download(m) }, t('foundry.confirm.go', { size: size(m.sizeMb) })),
        el('button', { class: 'btn', type: 'button', onclick: () => { confirming = null; render(); } }, t('common.cancel')));
    } else if (!m.cached) {
      action = el('button', { class: 'btn', type: 'button', disabled: !!downloading, onclick: () => { confirming = m.id; render(); } }, t('foundry.download'));
    } else {
      action = el('div', { class: 'inline' },
        inUse ? el('span', { class: 'desc' }, t('foundry.inUse'))
          : el('button', { class: 'btn', type: 'button', onclick: () => save({ polish: { model: m.id } }, t('foundry.chosen', { name: m.alias })) }, t('foundry.use')),
        el('button', { class: 'btn quiet', type: 'button', onclick: () => remove(m) }, t('common.delete')));
    }
    const desc = confirming === m.id ? t('foundry.confirm', { name: m.alias, size: size(m.sizeMb) }) : info;
    return el('div', { class: 'row' }, el('div', {}, el('div', { class: 'title' }, m.alias), el('div', { class: 'desc' }, desc)), action);
  }

  function foundryRows() {
    if (!foundry || foundry === 'loading') {
      return [row(t('foundry.title'), t('foundry.showDesc'),
        el('button', { class: 'btn', type: 'button', disabled: foundry === 'loading', onclick: loadFoundry }, t(foundry === 'loading' ? 'foundry.loading' : 'foundry.show')))];
    }
    if (foundry.error) return [row(t('foundry.title'), foundry.error, el('button', { class: 'btn', type: 'button', onclick: loadFoundry }, t('foundry.retry')))];
    return [
      el('div', { class: 'row' }, el('div', { class: 'desc' }, t('foundry.bigger'))),
      ...foundry.list.map(foundryModel),
    ];
  }

  // ---------------------------------------------------------------- the Cloud API, another server

  function cloudRows() {
    const model = el('input', { id: 'polish-model', value: p().model, placeholder: CLOUD_MODEL, 'aria-label': t('polish.model.title') });
    model.addEventListener('change', () => save({ polish: { model: model.value.trim() || CLOUD_MODEL } }));
    return [row(t('polish.model.title'), t(settings.cloud.hasApiKey ? 'polish.cloud.key' : 'polish.cloud.noKey'), model)];
  }

  function customRows() {
    const url = el('input', { id: 'polish-url', value: p().baseUrl, placeholder: 'http://127.0.0.1:8080/v1', 'aria-label': t('polish.url.title') });
    url.addEventListener('change', () => save({ polish: { baseUrl: url.value.trim() } }));
    const key = el('input', { id: 'polish-key', type: 'password', autocomplete: 'off', placeholder: p().hasApiKey ? '••••••••' : '', 'aria-label': t('polish.key.title') });
    key.addEventListener('change', () => save({ polish: { apiKey: key.value } }, t(key.value ? 'polish.key.saved' : 'polish.key.cleared')));
    const model = el('input', { id: 'polish-model', value: p().model, 'aria-label': t('polish.model.title') });
    model.addEventListener('change', () => save({ polish: { model: model.value.trim() } }));
    return [
      row(t('polish.url.title'), t('polish.url.desc'), url),
      row(t('polish.key.title'), t(p().hasApiKey ? 'polish.key.saved' : 'polish.key.desc'), key),
      row(t('polish.model.title'), null, model),
    ];
  }

  function testRow() {
    const result = testResult ? el('span', { class: 'desc', role: 'status', style: `color:${testResult.ok ? 'var(--ok)' : 'var(--signal)'}` }, testResult.text) : null;
    return el('div', { class: 'row' },
      el('div', {}, el('div', { class: 'desc' }, t('polish.levels')),
        el('button', { class: 'btn quiet', type: 'button', onclick: () => showPage('modes') }, t('polish.openModes'))),
      el('div', { class: 'inline' }, result, el('button', { id: 'polish-test', class: 'btn', type: 'button', onclick: test }, t('common.test'))));
  }

  async function test() {
    testResult = { ok: true, text: t('common.testing') };
    render();
    const r = await api.testPolish();
    testResult = r.ok ? { ok: true, text: t('polish.test.works', { ms: I18n.num(r.ms), output: r.output }) } : { ok: false, text: r.error };
    render();
  }

  // ---------------------------------------------------------------- the panel

  function render() {
    if (!settings || !$('#polish-rows')) return;
    const { provider } = p();
    const focused = document.activeElement && document.activeElement.id;
    const rows = [providerRow(), el('div', { class: 'row' }, el('div', { class: 'desc', id: 'polish-where' }, whereText()))];
    if (provider === 'ollama' || provider === 'lmstudio') rows.push(...serverRows());
    if (provider === 'foundry') rows.push(...foundryRows());
    if (provider === 'cloud') rows.push(...cloudRows());
    if (provider === 'custom') rows.push(...customRows());
    if (provider !== 'off') rows.push(testRow());
    $('#polish-rows').replaceChildren(...rows);
    if (focused && focused.startsWith('polish-') && $(`#${focused}`)) $(`#${focused}`).focus();
  }

  api.onFoundryProgress((progress) => {
    if (!downloading || progress.id !== downloading.id) return;
    downloading.percent = progress.percent;
    // Only the number changes: rebuilding the panel on every percent would swallow clicks on Cancel.
    const status = $('#foundry-progress');
    if (status) status.textContent = t('foundry.downloading', { percent: progress.percent });
    else render();
  });
  api.onSettings(() => render());

  return {
    render,
    /** The window starts: look for Ollama or LM Studio when one of them is chosen (127.0.0.1 only). */
    start() {
      render();
      if (p().provider === 'ollama' || p().provider === 'lmstudio') find();
    },
  };
})();
