'use strict';
// The tray icon's menu and its hint text, in the UI language. Pure: main builds the Electron Menu from
// the template and passes in what each item does.

const { t } = require('./strings');

/**
 * @param {{busy: boolean, hasLast: boolean, updateVersion: string|null}} state
 * @param {{open, files, toggle, pasteLast, copyLast, install, quit}} actions
 */
function trayTemplate({ busy, hasLast, updateVersion }, actions) {
  return [
    { label: t('tray.open'), click: actions.open },
    { label: t('tray.files'), click: actions.files },
    { type: 'separator' },
    { label: t(busy ? 'tray.stop' : 'tray.start'), click: actions.toggle },
    { label: t('action.pasteLast.title'), click: actions.pasteLast, enabled: hasLast },
    { label: t('action.copyLast.title'), click: actions.copyLast, enabled: hasLast },
    { type: 'separator' },
    ...(updateVersion ? [{ label: t('tray.update', { version: updateVersion }), click: actions.install }] : []),
    { label: t('tray.quit'), click: actions.quit },
  ];
}

/**
 * The tooltip and the "still running" balloon, naming the shortcut to use.
 * @param {{hold: string, any: string}} keys formatted shortcuts: the first hold-to-talk one, the first dictate one ('' for none)
 */
function trayHints({ hold, any }) {
  const how = hold ? 'hold' : any ? 'press' : 'click';
  const keys = hold || any;
  return {
    tooltip: `Pauli Speaks - ${t(`tray.hint.${how}`, { keys })}`,
    balloon: t(`tray.balloon.${how}`, { keys }),
  };
}

module.exports = { trayTemplate, trayHints };
