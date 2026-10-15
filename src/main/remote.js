'use strict';
// Remote control from outside the app: Stream Deck, AutoHotkey, foot-pedal
// software, scripts. Two ways in, both read in main.js at startup and when a
// second instance is launched (Electron's "launch app from URL" pattern):
//   pauli-speaks://dictate/toggle | start | stop | cancel   (?mode=... is kept for Modes)
//   "Pauli Speaks.exe" --toggle | --start | --stop | --cancel | --paste-last
//                      | --copy-last | --undo-last | --press-enter
// Any web page can open a link, so links only control dictation. Pasting or
// pressing keys needs a command line, i.e. something already running on this PC.
// Pure (no Electron) so it can be unit tested.

const PROTOCOL = 'pauli-speaks';

const LINK_COMMANDS = {
  'dictate/toggle': 'toggle',
  'dictate/start': 'start',
  'dictate/stop': 'stop',
  'dictate/cancel': 'cancel',
  toggle: 'toggle',
  start: 'start',
  stop: 'stop',
  cancel: 'cancel',
  open: 'open',
};

const FLAGS = {
  '--toggle': 'toggle',
  '--start': 'start',
  '--stop': 'stop',
  '--cancel': 'cancel',
  '--paste-last': 'pasteLast',
  '--copy-last': 'copyLast',
  '--undo-last': 'undoLast',
  '--press-enter': 'pressEnter',
};

// Links come from any web page: only our own command names, and a mode that is a plain name.
const own = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : null);
const MODE_NAME = /^[A-Za-z0-9_-]{1,40}$/;
const withMode = (command, mode) => (mode && MODE_NAME.test(mode) ? { command, mode } : { command });

/** @returns {{command: string, mode?: string} | null} */
function parseDeepLink(link) {
  if (typeof link !== 'string' || !link.toLowerCase().startsWith(`${PROTOCOL}://`)) return null;
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const route = `${url.host}${url.pathname}`.toLowerCase().replace(/\/+$/, '');
  const command = own(LINK_COMMANDS, route);
  return command ? withMode(command, url.searchParams.get('mode')) : null;
}

/** @param {string[]} argv process.argv, or the commandLine of a second instance */
function parseCommandLine(argv) {
  if (!Array.isArray(argv)) return null;
  const link = argv.find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${PROTOCOL}://`));
  if (link) return parseDeepLink(link);
  const flag = argv.find((a) => own(FLAGS, a));
  if (!flag) return null;
  const mode = argv.find((a) => typeof a === 'string' && a.startsWith('--mode='));
  return withMode(own(FLAGS, flag), mode && mode.slice(7));
}

module.exports = { PROTOCOL, parseDeepLink, parseCommandLine };
