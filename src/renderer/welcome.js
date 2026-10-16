'use strict';
// First-run welcome flow. Loaded after app.js and uses its globals:
// api, $, el, save, settings, LANGUAGES, LANG_NAME, toast, showPage.
//
// The shell owns the progress dots, "Skip", "Finish later" and moving between
// steps. A step is an object in STEPS:
//
//   {
//     id: 'languages',                 // unique, used for the dot and data-step
//     render(body, flow) {},           // fill `body` (an empty element); may be async
//     leave() {},                      // free everything render() started: streams, timers, listeners
//   }
//
// `flow` (the same object for every step):
//   flow.next()            go to the next step; after the last one, finish the flow
//   flow.finish()          api.finishWelcome(), then Home ("Finish later" and the last step)
//   flow.actions(...nodes) put the step's own buttons (e.g. "Continue") next to Skip
//   flow.system            Promise of api.welcomeSystem(), fetched once per start()
//   flow.data              plain object shared by steps (step 1 sets data.languages)
//
// Steps 1-2 must never save engine, localModel or acceleration: that starts a
// model download, which only step 3 may do once the user confirms it.

const Welcome = (() => {
  const NO_SYSTEM = Object.freeze({ languages: [], gpu: { usable: false, vendor: null }, conflicts: [], recommendation: null });
  const MIC_PRIVACY_URL = 'ms-settings:privacy-microphone';

  let active = false;
  let index = 0;
  let current = null;
  let busy = false;
  let flow = null;

  const title = (text) => el('h1', { id: 'welcome-title', tabindex: '-1' }, text);

  // ---------------------------------------------------------------- step 1: languages

  function languagesStep() {
    let alive = false;
    return {
      id: 'languages',
      async render(body, f) {
        alive = true;
        const saved = (settings.languages || []).filter((c) => Object.hasOwn(LANG_NAME, c));
        const system = saved.length ? [] : (await f.system).languages || [];
        if (!alive) return;
        // Saved languages win (the user quit mid-flow); otherwise the Windows display languages we know.
        const chosen = saved.length ? saved : system.filter((c) => typeof c === 'string' && Object.hasOwn(LANG_NAME, c));
        const chips = el('div', { class: 'lang-chips', role: 'group', 'aria-labelledby': 'welcome-title' });
        const draw = () => chips.replaceChildren(...LANGUAGES.map(([c, name]) => el('button', {
          class: chosen.includes(c) ? 'active' : '',
          'aria-pressed': String(chosen.includes(c)),
          onclick: () => {
            const i = chosen.indexOf(c);
            if (i >= 0) chosen.splice(i, 1);
            else chosen.push(c);
            draw();
            chips.querySelector(`[data-lang="${c}"]`)?.focus();
          },
          'data-lang': c,
        }, name)));
        draw();
        body.append(
          title('Which languages do you speak?'),
          el('p', { class: 'sub' }, 'One language is fastest. With several, Pauli Speaks detects which one you used.'),
          chips);
        f.actions(el('button', {
          class: 'btn primary',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await save({ languages: [...chosen] }, null);
            } catch (err) {
              console.error('welcome: saving languages failed', err);
            }
            f.data.languages = [...chosen];
            if (alive) f.next();
          },
        }, 'Continue'));
      },
      leave() {
        alive = false;
      },
    };
  }

  // ---------------------------------------------------------------- step 2: microphone

  const HEARD_AT = 8; // meter width in %: the level counts as "heard" above this
  const HEARD_MS = 300;
  const SILENT_BELOW = 0.5; // meter width in %: below this the level counts as zero
  const MUTED_MS = 8000;
  const TICK_MS = 50;

  async function listMics() {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    } catch {
      return [];
    }
  }

  function micStep() {
    let gen = 0; // bumped on every (re)open and on leave: stale async results are dropped
    let stream = null;
    let ctx = null;
    let timer = null;
    let state = 'idle';
    let select;
    let meter;
    let status;
    let fix;

    const setStatus = (next, text, cls = '') => {
      state = next;
      status.textContent = text;
      status.className = `wm-status ${cls}`;
      fix.hidden = next !== 'blocked';
    };

    const close = () => {
      clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      ctx?.close().catch(() => {});
      ctx = null;
      meter.firstElementChild.style.width = '0%';
    };

    const fill = (devices) => {
      const opts = [el('option', { value: 'default' }, 'System default')];
      for (const d of devices) {
        if (d.deviceId === 'default' || d.deviceId === 'communications' || !d.deviceId) continue;
        opts.push(el('option', { value: d.deviceId }, d.label || 'Microphone'));
      }
      const keep = select.value || settings.microphoneId;
      select.replaceChildren(...opts);
      select.value = devices.some((d) => d.deviceId === keep) ? keep : 'default';
    };

    async function open() {
      const my = ++gen;
      close();
      const devices = await listMics();
      if (my !== gen) return;
      fill(devices);
      if (!devices.length) return setStatus('none', 'Plug in a microphone or headset.', 'bad');
      setStatus('opening', 'Say something');
      let s;
      try {
        const id = select.value;
        s = await navigator.mediaDevices.getUserMedia({ audio: id !== 'default' ? { deviceId: { exact: id } } : true });
      } catch (err) {
        if (my !== gen) return;
        if (err && err.name === 'NotAllowedError') return setStatus('blocked', 'Windows is blocking the microphone.', 'bad');
        if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) return setStatus('none', 'Plug in a microphone or headset.', 'bad');
        return setStatus('error', `Couldn't open the microphone: ${(err && err.message) || err}`, 'bad');
      }
      if (my !== gen) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      stream.getAudioTracks()[0]?.addEventListener('ended', () => my === gen && open());
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      setStatus('listening', 'Say something');
      fill(await listMics()); // labels are only known once the microphone is open
      if (my !== gen) return;
      let loudSince = 0;
      let lastSound = performance.now();
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const level = Math.min(100, Math.sqrt(sum / buf.length) * 600); // same scale as the Settings meter
        meter.firstElementChild.style.width = `${level}%`;
        const now = performance.now();
        if (level >= SILENT_BELOW) lastSound = now;
        if (level > HEARD_AT) {
          loudSince ||= now;
          if (state !== 'heard' && now - loudSince >= HEARD_MS) setStatus('heard', 'We can hear you.', 'good');
        } else loudSince = 0;
        if (state === 'listening' && now - lastSound >= MUTED_MS) {
          setStatus('muted', 'Your mic may be muted. Check its mute switch or Windows sound settings.', 'bad');
        } else if (state === 'muted' && level >= SILENT_BELOW) setStatus('listening', 'Say something');
      }, TICK_MS);
    }

    // Devices come and go (USB, Bluetooth): reopen only if the one in use is gone or none was there.
    const onDeviceChange = async () => {
      const my = gen;
      const devices = await listMics();
      if (my !== gen) return;
      const using = select.value;
      if (state === 'none' || (using !== 'default' && !devices.some((d) => d.deviceId === using))) open();
      else fill(devices);
    };
    // Coming back from Windows Settings: try again if access was blocked.
    const onFocus = () => state === 'blocked' && open();

    return {
      id: 'microphone',
      render(body, f) {
        select = el('select', {
          'aria-label': 'Microphone',
          onchange: () => {
            save({ microphoneId: select.value }, null).catch((err) => console.error('welcome: saving the microphone failed', err));
            open();
          },
        });
        meter = el('div', { class: 'meter big', role: 'presentation' }, el('i'));
        status = el('p', { class: 'wm-status', role: 'status', 'aria-live': 'polite' });
        fix = el('button', { class: 'btn', hidden: true, onclick: () => api.openExternal(MIC_PRIVACY_URL) }, 'Open microphone settings');
        body.append(title('Your microphone.'), select, meter, el('div', { class: 'inline' }, status, fix));
        f.actions(el('button', { class: 'btn primary', onclick: () => f.next() }, 'Continue'));
        navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
        window.addEventListener('focus', onFocus);
        open();
      },
      leave() {
        gen++;
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
        window.removeEventListener('focus', onFocus);
        if (meter) close();
      },
    };
  }

  // ---------------------------------------------------------------- steps 3-5: placeholders

  // PLACEHOLDER: Task 5 replaces 'engine' (speech engine), Task 6 'shortcut' and 'try'.
  function placeholderStep(id, name) {
    return {
      id,
      render(body) {
        body.append(title('Coming next'), el('p', { class: 'sub' }, `${name} - this step is still being built. Skip for now.`));
      },
      leave() {},
    };
  }

  const STEPS = [
    languagesStep(),
    micStep(),
    placeholderStep('engine', 'Speech engine'),
    placeholderStep('shortcut', 'Your shortcut'),
    placeholderStep('try', 'Try it'),
  ];

  // ---------------------------------------------------------------- shell

  function leaveCurrent() {
    try {
      current?.leave();
    } catch (err) {
      console.error('welcome: leaving a step failed', err);
    }
    current = null;
  }

  function drawDots() {
    $('#welcome-dots').setAttribute('aria-label', `Step ${index + 1} of ${STEPS.length}`);
    $('#welcome-dots').replaceChildren(...STEPS.map((s, i) => el('li', {
      class: i < index ? 'done' : i === index ? 'current' : '',
      'aria-current': i === index ? 'step' : null,
      'data-step': s.id,
    })));
  }

  function show(i) {
    leaveCurrent();
    index = i;
    const step = STEPS[i];
    current = step;
    drawDots();
    const body = $('#welcome-step');
    body.replaceChildren();
    body.dataset.step = step.id;
    $('#welcome-step-actions').replaceChildren();
    Promise.resolve()
      .then(() => step.render(body, flow))
      .then(() => {
        if (current === step) $('#welcome-title')?.focus({ preventScroll: true });
      })
      .catch((err) => {
        console.error(`welcome: step ${step.id} failed`, err);
        if (current === step) toast('Something went wrong on this step. Skip it for now.');
      });
  }

  function showWelcomePage() {
    document.querySelector('.sidebar').hidden = true;
    document.querySelectorAll('main > .page').forEach((p) => (p.hidden = p.id !== 'page-welcome'));
  }

  function next() {
    if (!active || busy) return;
    if (index + 1 < STEPS.length) show(index + 1);
    else finish();
  }

  async function finish() {
    if (!active || busy) return;
    busy = true;
    try {
      await api.finishWelcome();
    } catch (err) {
      console.error('welcome: finish failed', err);
      toast("Couldn't save that setup is done. The welcome flow shows again next time.");
    } finally {
      busy = false;
    }
    stop();
  }

  function start() {
    if (active) return;
    active = true;
    flow = {
      next,
      finish,
      actions: (...nodes) => $('#welcome-step-actions').replaceChildren(...nodes),
      system: api.welcomeSystem().catch((err) => {
        console.error('welcome: system check failed', err);
        return NO_SYSTEM;
      }),
      data: {},
    };
    showWelcomePage();
    show(0);
  }

  function stop() {
    if (!active) return;
    leaveCurrent();
    active = false;
    $('#welcome-step').replaceChildren();
    delete $('#welcome-step').dataset.step;
    $('#welcome-step-actions').replaceChildren();
    document.querySelector('.sidebar').hidden = false;
    showPage('home');
  }

  $('#welcome-skip').addEventListener('click', next);
  $('#welcome-later').addEventListener('click', finish);
  // The tray can ask for another page while the flow is open: keep the flow in front.
  api.onNavigate(() => active && showWelcomePage());

  return { start, stop };
})();
window.Welcome = Welcome;
