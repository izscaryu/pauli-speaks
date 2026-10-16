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
  const FIRST_WORDS = "'Hello, this is my first dictation'";

  /** The binding the flow talks about: dictate-1, else the first plain dictate shortcut. */
  const talkBinding = () => (settings.bindings || []).find((b) => b.id === DICTATE_ID)
    || firstBinding('dictate', (b) => b.trigger !== 'doubleTap');

  const joinNames = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
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
        toast("Couldn't save your choice. Try again.");
      }
      if (alive) draw();
    }

    function drawCards() {
      const b = talkBinding();
      const holds = !!b && b.behaviour !== 'toggle';
      const toggles = !!b && b.behaviour === 'toggle';
      const card = (name, hint, extra) => el('button', { class: 'we-card', disabled: !!recording || null, ...extra }, el('b', {}, name), el('small', {}, hint));
      cardsBox.replaceChildren(
        card('Hold to talk', 'Double-tap still locks it hands-free.', {
          'aria-pressed': String(holds),
          onclick: () => b && b.behaviour !== 'both' && setBehaviour('both'),
        }),
        card('Press to start, press to stop', 'Nothing to hold down.', {
          'aria-pressed': String(toggles),
          onclick: () => b && b.behaviour !== 'toggle' && setBehaviour('toggle'),
        }),
        card('Use a mouse button', 'A side button or a pedal.', { onclick: openRecorder }));
    }

    function drawRecorder() {
      recBox.hidden = !recording;
      if (!recording) return recBox.replaceChildren();
      const r = recording;
      const kids = [
        r.keys.length ? el('span', { class: 'chips' }, keyChips(r.keys)) : el('span', { class: 'prompt' }, 'Press keys, a pedal or a mouse button…'),
        el('span', { class: 'spacer' }),
      ];
      if (r.warning) {
        kids.push(
          el('button', { class: 'btn', onclick: () => api.retryShortcut().catch(logFail('retrying the shortcut')) }, 'Try another'),
          el('button', { class: 'btn primary', onclick: () => api.confirmShortcut().catch(logFail('confirming the shortcut')) }, 'Use anyway'),
          el('div', { class: 'msg warn', role: 'alert' }, r.warning));
      } else {
        kids.push(
          el('span', { class: 'hint' }, 'Esc cancels · Backspace clears'),
          el('button', { class: 'btn quiet', onclick: () => closeRecorder(true) }, 'Cancel'));
        if (r.error) kids.push(el('div', { class: 'msg error', role: 'alert' }, r.error));
      }
      recBox.replaceChildren(...kids);
      recBox.focus({ preventScroll: true });
    }

    function draw() {
      if (!alive) return;
      keysBox.replaceChildren(...bindingChips(talkBinding()));
      const broken = hookError === true && !works;
      const text = works ? 'That works.' : broken ? "Pauli Speaks can't see your shortcut." : 'Press it now to check it works.';
      if (status.textContent !== text) status.textContent = text;
      status.className = `wm-status ${works ? 'good' : broken ? 'bad' : ''}`;
      const notes = [];
      if (!works && conflicts.length) notes.push(`${joinNames(conflicts)} ${conflicts.length > 1 ? 'are' : 'is'} running and may use the same shortcut.`);
      if (!works && waited && !broken) notes.push('Nothing arrived. Another app may be using this shortcut.');
      const show = (notes.length > 0 || broken) && !recording;
      hints.replaceChildren(...(show ? [
        ...notes.map((t) => el('p', { class: 'desc' }, t)),
        // Recording another shortcut needs the same hook, so offer the troubleshooting steps instead.
        broken
          ? el('p', { class: 'desc' }, 'Dictation by shortcut will not work until this is fixed. ',
            el('a', { href: HomeNotices.TROUBLESHOOTING_URL, target: '_blank' }, 'Read the troubleshooting steps'))
          : el('button', { class: 'btn', onclick: openRecorder }, 'Record another shortcut'),
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
        cardsBox = el('div', { class: 'we-cards', role: 'group', 'aria-label': 'How you use it' });
        recBox = el('div', { class: 'bind recording', id: 'we-rec-row', tabindex: '-1', 'aria-live': 'polite', hidden: true });
        body.append(title('Your shortcut.'), keysBox, status, hints, recBox, cardsBox);
        f.actions(el('button', { class: 'btn primary', onclick: () => f.next() }, 'Continue'));
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
          ...(b && b.behaviour === 'toggle'
            ? ['Press ', keys, `, say ${FIRST_WORDS}, and press it again.`]
            : ['Hold ', keys, `, say ${FIRST_WORDS}, and let go.`]));
        const box = el('textarea', {
          class: 'we-try',
          rows: '4',
          'aria-label': 'Try dictating here',
          'aria-describedby': 'we-try-line',
          placeholder: 'Your words will appear here.',
          oninput: () => {
            if (alive && !finished && box.value.trim()) tips();
          },
        });
        const tips = () => {
          finished = true;
          body.replaceChildren(
            title("You're ready."),
            el('ul', { class: 'we-tips' },
              ...[
                'Double-tap the shortcut for hands-free.',
                'Esc cancels.',
                "Say 'send it' to press Enter.",
                'Change shortcuts on the Shortcuts page.',
              ].map((t) => el('li', {}, t))));
          f.actions(el('button', { class: 'btn primary', onclick: () => f.finish() }, 'Done'));
          $('#welcome-title')?.focus({ preventScroll: true });
        };
        body.append(title('Try it.'), line, box);
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
