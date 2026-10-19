'use strict';
// Welcome flow, steps 4 and 5: the talk shortcut and the first dictation. Loaded after
// welcome.js and app.js; it takes over the 'shortcut' and 'try' slots with Welcome.register().
//
// Uses these app.js globals: keyChips, bindingChips, firstBinding, startRec, cancelRec.
//
// Step 4 turns the key test on while it is visible (the shortcuts do nothing then, they are only
// reported) and off again when it is left or the recorder opens. Step 5 leaves it off, so the real
// shortcut works and pastes into the box in the step. The text that arrives is never logged.

(() => {
  const { title } = Welcome;
  const DICTATE_ID = 'dictate-1';
  const WAIT_MS = 10000; // no shortcut event for this long: say so

  /** The binding the flow talks about: dictate-1, else the first plain dictate shortcut. */
  const talkBinding = () => (settings.bindings || []).find((b) => b.id === DICTATE_ID)
    || firstBinding('dictate', (b) => b.trigger !== 'doubleTap');

  const logFail = (what) => (err) => console.error(`welcome: ${what} failed`, err);

  // ---------------------------------------------------------------- step 4: shortcut

  function shortcutStep() {
    let alive = false;
    let works = false; // a dictate shortcut was seen
    let waited = false; // WAIT_MS passed without one
    let recording = null; // { keys, error, warning } while the recorder is open
    let hookError = null; // null until health:state answers; true when the keyboard hook did not start (no key test then)
    let conflicts = [];
    let timer = null;
    let offKeyTest = null;
    let offRecording = null;
    let offSettings = null;
    let keysBox;
    let status;
    let hints;
    let cardsBox;
    let recBox;

    // ----- key test

    // The test switches the shortcuts off app-wide, and main only switches it off again on blur:
    // never turn it on while the window is hidden or unfocused. onFocus turns it on when we are back.
    const canTest = () => document.hasFocus() && !document.hidden;

    function startTest() {
      if (!alive || recording || hookError !== false || !canTest()) return;
      offKeyTest ||= api.onKeyTest((d) => d.action === 'dictate' && succeed());
      api.setKeyTest(true).catch(logFail('turning the key test on'));
      clearTimeout(timer);
      timer = works ? null : setTimeout(() => {
        waited = true;
        draw();
      }, WAIT_MS);
    }

    function stopTest() {
      clearTimeout(timer);
      timer = null;
      offKeyTest?.();
      offKeyTest = null;
      api.setKeyTest(false).catch(logFail('turning the key test off'));
    }

    function succeed() {
      if (!alive || works) return;
      works = true;
      waited = false;
      clearTimeout(timer);
      timer = null;
      draw();
    }

    // The main process switches the test off when the window loses focus: switch it on again on return.
    const onFocus = () => startTest();
    // The recorder records through the global hook: never let it pick up typing in another app.
    const onBlur = () => {
      clearTimeout(timer);
      timer = null;
      if (recording) closeRecorder(true);
    };

    // ----- recorder (the Shortcuts page's: startRec / cancelRec in app.js, same IPC)

    function openRecorder() {
      if (recording) return;
      stopTest();
      recording = { keys: [], error: null, warning: null };
      startRec('dictate', talkBinding()?.id ?? null);
      draw();
    }

    function closeRecorder(cancelled) {
      if (cancelled) cancelRec();
      recording = null;
      works = false;
      waited = false;
      draw();
      startTest();
    }

    function onRecording(e) {
      if (!recording || (e.action && e.action !== 'dictate')) return;
      if (e.done) return closeRecorder(false);
      if (e.cleared) recording = { keys: [], error: null, warning: null };
      else if (e.warning) recording = { keys: e.keys || [], error: null, warning: e.warning };
      else if (e.error) recording = { keys: [], error: e.error, warning: null };
      else recording = { keys: e.keys || [], error: null, warning: null };
      draw();
    }

    // ----- drawing

    async function setBehaviour(value) {
      const b = talkBinding();
      if (!b || recording) return;
      try {
        await save({ bindings: settings.bindings.map((x) => (x.id === b.id ? { ...x, behaviour: value } : x)) }, null);
      } catch (err) {
        console.error('welcome: saving the shortcut behaviour failed', err);
        toast(t('welcome.saveFailed'));
      }
      if (alive) draw();
    }

    function drawCards() {
      const b = talkBinding();
      const holds = !!b && b.behaviour !== 'toggle';
      const toggles = !!b && b.behaviour === 'toggle';
      const card = (name, hint, extra) => el('button', { class: 'we-card', disabled: !!recording || null, ...extra }, el('b', {}, name), el('small', {}, hint));
      cardsBox.replaceChildren(
        card(t('welcome.shortcut.hold'), t('welcome.shortcut.holdHint'), {
          'aria-pressed': String(holds),
          onclick: () => b && b.behaviour !== 'both' && setBehaviour('both'),
        }),
        card(t('welcome.shortcut.toggle'), t('welcome.shortcut.toggleHint'), {
          'aria-pressed': String(toggles),
          onclick: () => b && b.behaviour !== 'toggle' && setBehaviour('toggle'),
        }),
        card(t('welcome.shortcut.mouse'), t('welcome.shortcut.mouseHint'), { onclick: openRecorder }));
    }

    function drawRecorder() {
      recBox.hidden = !recording;
      if (!recording) return recBox.replaceChildren();
      const r = recording;
      const kids = [
        r.keys.length ? el('span', { class: 'chips' }, keyChips(r.keys)) : el('span', { class: 'prompt' }, t('shortcuts.rec.prompt')),
        el('span', { class: 'spacer' }),
      ];
      if (r.warning) {
        kids.push(
          el('button', { class: 'btn', onclick: () => api.retryShortcut().catch(logFail('retrying the shortcut')) }, t('shortcuts.rec.tryAnother')),
          el('button', { class: 'btn primary', onclick: () => api.confirmShortcut().catch(logFail('confirming the shortcut')) }, t('shortcuts.rec.useAnyway')),
          el('div', { class: 'msg warn', role: 'alert' }, shortcutMessage(r.warning)));
      } else {
        kids.push(
          el('span', { class: 'hint' }, t('shortcuts.rec.hint')),
          el('button', { class: 'btn quiet', onclick: () => closeRecorder(true) }, t('common.cancel')));
        if (r.error) kids.push(el('div', { class: 'msg error', role: 'alert' }, shortcutMessage(r.error)));
      }
      recBox.replaceChildren(...kids);
      recBox.focus({ preventScroll: true });
    }

    function draw() {
      if (!alive) return;
      keysBox.replaceChildren(...bindingChips(talkBinding()));
      const broken = hookError === true && !works;
      const text = t(works ? 'welcome.shortcut.works' : broken ? 'notices.hook.title' : 'welcome.shortcut.pressNow');
      if (status.textContent !== text) status.textContent = text;
      status.className = `wm-status ${works ? 'good' : broken ? 'bad' : ''}`;
      const notes = [];
      if (!works && conflicts.length) notes.push(t('welcome.shortcut.conflict', { names: I18n.list(conflicts), count: conflicts.length }));
      if (!works && waited && !broken) notes.push(t('welcome.shortcut.nothing'));
      const show = (notes.length > 0 || broken) && !recording;
      hints.replaceChildren(...(show ? [
        ...notes.map((t) => el('p', { class: 'desc' }, t)),
        // Recording another shortcut needs the same hook, so offer the troubleshooting steps instead.
        broken
          ? el('p', { class: 'desc' }, ...I18n.nodes('notices.hook.desc', { link: el('a', { href: HomeNotices.TROUBLESHOOTING_URL, target: '_blank' }, t('notices.hook.link')) }))
          : el('button', { class: 'btn', onclick: openRecorder }, t('welcome.shortcut.record')),
      ] : []));
      drawCards();
      drawRecorder();
    }

    return {
      id: 'shortcut',
      render(body, f) {
        alive = true;
        works = false;
        waited = false;
        recording = null;
        hookError = null;
        conflicts = [];
        keysBox = el('div', { class: 'we-keys' });
        status = el('p', { class: 'wm-status', role: 'status', 'aria-live': 'polite' });
        hints = el('div', { class: 'we-hints', role: 'status', 'aria-live': 'polite' });
        cardsBox = el('div', { class: 'we-cards', role: 'group', 'aria-label': t('welcome.shortcut.how') });
        recBox = el('div', { class: 'bind recording', id: 'we-rec-row', tabindex: '-1', 'aria-live': 'polite', hidden: true });
        body.append(title(t('welcome.shortcut.title')), keysBox, status, hints, recBox, cardsBox);
        f.actions(el('button', { class: 'btn primary', onclick: () => f.next() }, t('welcome.continue')));
        offRecording = api.onShortcutRecording(onRecording);
        offSettings = api.onSettings(() => draw());
        window.addEventListener('focus', onFocus);
        window.addEventListener('blur', onBlur);
        draw();
        // A hook that did not start reports nothing: say so instead of waiting for a key that cannot arrive.
        api.healthState().catch(() => null).then((health) => {
          if (!alive) return;
          hookError = !!(health && health.hookError);
          draw();
          startTest();
        });
        // The check ran when the flow started: it is normally done by now.
        f.system.then((sys) => {
          if (!alive || !sys || !Array.isArray(sys.conflicts)) return;
          conflicts = sys.conflicts.filter((n) => typeof n === 'string');
          draw();
        });
      },
      leave() {
        if (!alive) return;
        alive = false;
        if (recording) cancelRec();
        recording = null;
        offRecording?.();
        offSettings?.();
        offRecording = null;
        offSettings = null;
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        stopTest();
      },
    };
  }

  // ---------------------------------------------------------------- step 5: try it

  function tryStep() {
    let alive = false;
    let finished = false;
    return {
      id: 'try',
      render(body, f) {
        alive = true;
        finished = false;
        const b = talkBinding();
        const keys = el('span', { class: 'chips' }, bindingChips(b));
        const line = el('p', { class: 'sub we-line', id: 'we-try-line' },
          ...I18n.nodes(b && b.behaviour === 'toggle' ? 'welcome.try.toggle' : 'welcome.try.hold', { keys }, { words: t('welcome.try.words') }));
        const box = el('textarea', {
          class: 'we-try',
          rows: '4',
          'aria-label': t('welcome.try.label'),
          'aria-describedby': 'we-try-line',
          placeholder: t('welcome.try.placeholder'),
          oninput: () => {
            if (alive && !finished && box.value.trim()) tips();
          },
        });
        const tips = () => {
          finished = true;
          body.replaceChildren(
            title(t('welcome.try.ready')),
            el('ul', { class: 'we-tips' },
              ...['welcome.try.tip.handsFree', 'welcome.try.tip.cancel', 'welcome.try.tip.send', 'welcome.try.tip.shortcuts'].map((key) => el('li', {}, t(key)))));
          f.actions(el('button', { class: 'btn primary', onclick: () => f.finish() }, t('welcome.done')));
          $('#welcome-title')?.focus({ preventScroll: true });
        };
        body.append(title(t('welcome.try.title')), line, box);
        f.actions();
        // The shell moves focus to the heading once render() is done; the box needs it for the paste.
        setTimeout(() => alive && !finished && box.focus({ preventScroll: true }), 0);
      },
      leave() {
        alive = false;
      },
    };
  }

  Welcome.register(shortcutStep());
  Welcome.register(tryStep());
})();
