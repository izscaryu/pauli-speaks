'use strict';
// Welcome flow, step 3: the speech engine. Loaded after welcome.js and app.js; it
// takes over the 'engine' slot with Welcome.register().
//
// Nothing downloads before the primary button is pressed: picking a card only
// changes the selection on this page. The button saves { engine, localModel },
// and the main process starts the download when it sees that setting change.

(() => {
  const CLOUD = 'cloud';
  const REASONS = {
    gpu: 'Best accuracy, and your graphics card makes it fast.',
    english: 'Fast on any PC, and good for English.',
    'other-languages': 'Much better than Base for languages other than English.',
  };

  const { title } = Welcome;
  let alive = false;

  const card = ({ value, checked, title, desc, state, badges = [], onpick }) => el('label', { class: 'model' },
    el('input', { type: 'radio', name: 'welcome-engine', value, checked: checked || null, onchange: () => onpick(value) }),
    el('div', {}, el('div', { class: 'title' }, title, ...badges.filter(Boolean).map((b) => el('span', { class: 'tag' }, b))), el('div', { class: 'desc' }, desc)),
    el('span', { class: 'state' }, state));

  async function render(body, f) {
    alive = true;
    const languages = f.data.languages ?? settings.languages ?? [];
    const [state, rec] = await Promise.all([
      api.getModelState(),
      api.welcomeRecommend(languages).catch((err) => {
        console.error('welcome: model recommendation failed', err);
        return null;
      }),
    ]);
    if (!alive) return;
    const models = state.models;
    const recommended = (rec && models.find((m) => m.id === rec.model)) || models.find((m) => m.id === settings.localModel) || models[0];
    const reason = rec && Object.hasOwn(REASONS, rec.reason) ? REASONS[rec.reason] : 'The default for this PC.';

    // "Run setup again" (or a restart after the download): keep what is set up selected, so the primary
    // button never swaps a working model with one click. The recommendation stays visible as such.
    const onboarded = settings.onboarded === true;
    const current = settings.engine === CLOUD
      ? (onboarded ? CLOUD : null)
      : models.find((m) => m.id === settings.localModel && (m.downloaded || onboarded))?.id ?? null;
    const currentTag = (value) => (value === current ? 'Current' : null);

    let selected = current ?? recommended.id;
    let cloudOk = current === CLOUD && !!settings.cloud?.hasApiKey; // unchanged cloud setup: no new test needed
    let busy = false;

    const go = el('button', { class: 'btn primary', onclick: () => choose() });
    const cloudBox = el('div', { class: 'we-cloud', hidden: true });
    const result = el('span', { class: 'desc', role: 'status', 'aria-live': 'polite' });
    const testBtn = el('button', { class: 'btn', onclick: () => testKey() }, 'Test');
    const keyInput = el('input', {
      type: 'password', autocomplete: 'off', 'aria-label': 'API key', placeholder: 'gsk_…',
      oninput: () => {
        cloudOk = false;
        result.textContent = '';
        refresh();
      },
      onkeydown: (e) => e.key === 'Enter' && testKey(),
    });

    function refresh() {
      cloudBox.hidden = selected !== CLOUD;
      keyInput.placeholder = settings.cloud?.hasApiKey ? '•••••••• saved - type to replace' : 'gsk_…';
      if (selected === CLOUD) {
        go.textContent = 'Continue';
        go.disabled = busy || !cloudOk;
        return;
      }
      const m = models.find((x) => x.id === selected);
      go.textContent = m.downloaded ? 'Continue' : `Download and continue (${m.size})`;
      go.disabled = busy;
    }

    function setResult(text, cls = '') {
      result.textContent = text;
      result.style.color = cls === 'good' ? 'var(--ok)' : cls === 'bad' ? 'var(--signal)' : '';
    }

    // Same calls as the Settings page: save the key (encrypted by the main process), then test it.
    async function testKey() {
      if (busy || testBtn.disabled) return;
      const typed = keyInput.value.trim();
      if (!typed && !settings.cloud?.hasApiKey) return setResult('Paste your API key first.', 'bad');
      cloudOk = false;
      testBtn.disabled = true;
      setResult('Testing…');
      refresh();
      try {
        if (typed) {
          await save({ cloud: { apiKey: typed } }, null);
          keyInput.value = '';
        }
        const r = await api.testCloud();
        if (!alive) return;
        cloudOk = !!r.ok;
        setResult(r.ok ? 'Connected' : r.error, r.ok ? 'good' : 'bad');
      } catch (err) {
        console.error('welcome: testing the cloud key failed', err);
        if (alive) setResult("Couldn't test the key. Try again.", 'bad');
      } finally {
        testBtn.disabled = false;
        if (alive) refresh();
      }
    }

    async function choose() {
      if (busy || (selected === CLOUD && !cloudOk)) return;
      busy = true;
      refresh();
      try {
        // The only place in the flow that saves engine / localModel, which starts the download.
        await save(selected === CLOUD ? { engine: 'cloud' } : { engine: 'local', localModel: selected }, null);
      } catch (err) {
        console.error('welcome: saving the speech engine failed', err);
        toast("Couldn't save your choice. Try again.");
        busy = false;
        if (alive) refresh();
        return;
      }
      if (alive) f.next();
    }

    const onpick = (value) => {
      selected = value;
      refresh();
    };
    const sizeOrDownloaded = (m) => (m.downloaded ? 'Downloaded' : m.size);
    const others = models.filter((m) => m !== recommended);
    const more = el('details', { class: 'we-more', open: selected !== recommended.id || null },
      el('summary', {}, 'Other options'),
      ...others.map((m) => card({
        value: m.id, checked: m.id === selected, title: `Whisper ${m.label}`, badges: [currentTag(m.id)], desc: m.note, state: sizeOrDownloaded(m), onpick,
      })),
      card({
        value: CLOUD, checked: selected === CLOUD, title: 'Cloud (Groq, free key)', badges: [currentTag(CLOUD)],
        desc: 'Your audio is sent to Groq to be transcribed.', state: '', onpick,
      }));

    cloudBox.append(
      el('div', { class: 'row' }, el('div', { class: 'title' }, 'API key'), keyInput),
      el('div', { class: 'row' },
        el('div', { class: 'desc' }, 'Free key at ', el('a', { href: 'https://console.groq.com/keys', target: '_blank', rel: 'noreferrer' }, 'console.groq.com/keys'), '.'),
        el('div', { class: 'inline' }, result, testBtn)));

    body.append(
      title('Pick your speech engine.'),
      el('div', { class: 'we-list', role: 'radiogroup', 'aria-labelledby': 'welcome-title' },
        el('div', { class: 'we-rec' }, card({
          value: recommended.id, checked: selected === recommended.id, title: `Whisper ${recommended.label}`, badges: ['Recommended', currentTag(recommended.id)],
          desc: reason, state: sizeOrDownloaded(recommended), onpick,
        })),
        more,
        cloudBox));
    refresh();
    f.actions(go);
  }

  Welcome.register({
    id: 'engine',
    render,
    leave() {
      alive = false;
    },
  });
})();
