'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
  ACTIONS,
  UUID_PREFIX,
  commandFor,
  launchFor,
  isAppExe,
  exeFromProtocolCommand,
  parseRegQuery,
  exeCandidates,
} = require('../integrations/streamdeck/lib/commands');
const { parseDeepLink, parseCommandLine } = require('../src/main/remote');

const EXE = 'C:\\Users\\ana\\AppData\\Local\\Programs\\Pauli Speaks\\Pauli Speaks.exe';

test('the five buttons', () => {
  assert.deepEqual(ACTIONS, {
    toggle: 'toggle',
    start: 'start',
    stop: 'stop',
    cancel: 'cancel',
    pasteLast: 'paste-last',
  });
});

test('dictation buttons open a link', () => {
  assert.deepEqual(commandFor('toggle', {}), { kind: 'link', url: 'pauli-speaks://dictate/toggle' });
  assert.deepEqual(commandFor('start', {}), { kind: 'link', url: 'pauli-speaks://dictate/start' });
  assert.deepEqual(commandFor('stop', {}), { kind: 'link', url: 'pauli-speaks://dictate/stop' });
  assert.deepEqual(commandFor('cancel', {}), { kind: 'link', url: 'pauli-speaks://dictate/cancel' });
});

test('toggle and start take a mode; stop and cancel ignore it', () => {
  assert.deepEqual(commandFor('toggle', { mode: 'email' }), { kind: 'link', url: 'pauli-speaks://dictate/toggle?mode=email' });
  assert.deepEqual(commandFor('start', { mode: ' code_2 ' }), { kind: 'link', url: 'pauli-speaks://dictate/start?mode=code_2' });
  assert.deepEqual(commandFor('start', { mode: '' }), { kind: 'link', url: 'pauli-speaks://dictate/start' });
  assert.deepEqual(commandFor('stop', { mode: 'email' }), { kind: 'link', url: 'pauli-speaks://dictate/stop' });
  assert.deepEqual(commandFor('cancel', { mode: 'not a mode!' }), { kind: 'link', url: 'pauli-speaks://dictate/cancel' });
});

test('a mode must be a plain name, as the app accepts it', () => {
  for (const bad of ['two words', 'a&b=c', 'é', 'x'.repeat(41), '../x', 'a?mode=b', 42, ['email']]) {
    assert.deepEqual(commandFor('start', { mode: bad }), { error: 'bad-mode' }, String(bad));
  }
  assert.equal(commandFor('toggle', { mode: 'x'.repeat(40) }).kind, 'link');
});

test('every link is one the app understands, with the same command and mode', () => {
  for (const name of ['toggle', 'start', 'stop', 'cancel']) {
    const { url } = commandFor(name, {});
    assert.deepEqual(parseDeepLink(url), { command: name });
  }
  assert.deepEqual(parseDeepLink(commandFor('start', { mode: 'email' }).url), { command: 'start', mode: 'email' });
});

test('Paste last runs the app with --paste-last', () => {
  assert.deepEqual(commandFor('pasteLast', { exePath: EXE }), { kind: 'exe', file: EXE, args: ['--paste-last'] });
  assert.deepEqual(parseCommandLine([EXE, '--paste-last']), { command: 'pasteLast' });
  assert.equal(commandFor('pasteLast', { exePath: EXE, mode: 'not a mode!' }).kind, 'exe', 'mode is not used');
});

test('Paste last needs the app', () => {
  assert.deepEqual(commandFor('pasteLast', {}), { error: 'no-app' });
  assert.deepEqual(commandFor('pasteLast', { exePath: 'Pauli Speaks.exe' }), { error: 'no-app' });
  assert.deepEqual(commandFor('pasteLast', { exePath: 'C:\\Windows\\notepad.txt' }), { error: 'no-app' });
});

test('unknown actions do nothing', () => {
  assert.deepEqual(commandFor('pressEnter', {}), { error: 'unknown-action' });
  assert.deepEqual(commandFor('__proto__', {}), { error: 'unknown-action' });
  assert.deepEqual(commandFor('toString', {}), { error: 'unknown-action' });
  assert.deepEqual(commandFor(undefined), { error: 'unknown-action' });
});

test('settings may be missing', () => {
  assert.deepEqual(commandFor('toggle'), { kind: 'link', url: 'pauli-speaks://dictate/toggle' });
  assert.deepEqual(commandFor('toggle', null), { kind: 'link', url: 'pauli-speaks://dictate/toggle' });
});

test('how a command is started', () => {
  assert.deepEqual(launchFor({ kind: 'link', url: 'pauli-speaks://dictate/stop' }), {
    file: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', 'pauli-speaks://dictate/stop'],
  });
  assert.deepEqual(launchFor({ kind: 'exe', file: EXE, args: ['--paste-last'] }), { file: EXE, args: ['--paste-last'] });
  assert.equal(launchFor({ error: 'no-app' }), null);
  assert.equal(launchFor({ kind: 'link', url: 'https://example.com' }), null, 'only our own links');
  assert.equal(launchFor({ kind: 'exe', file: 'notepad.exe', args: [] }), null);
});

test('what counts as the app', () => {
  assert.equal(isAppExe(EXE), true);
  assert.equal(isAppExe('D:\\Apps\\Pauli Speaks\\Pauli Speaks.EXE'), true);
  assert.equal(isAppExe('\\\\server\\share\\Pauli Speaks.exe'), true);
  assert.equal(isAppExe('Pauli Speaks.exe'), false, 'not a full path');
  assert.equal(isAppExe('C:\\Apps\\Pauli Speaks'), false, 'a folder');
  assert.equal(isAppExe('"C:\\Apps\\Pauli Speaks.exe"'), false, 'quotes');
  assert.equal(isAppExe('C:\\Apps\\a.exe\n--start'), false);
  assert.equal(isAppExe(''), false);
  assert.equal(isAppExe(null), false);
});

test('the exe behind the pauli-speaks link (registry command)', () => {
  assert.equal(exeFromProtocolCommand(`"${EXE}" "%1"`), EXE);
  assert.equal(exeFromProtocolCommand(`"${EXE}" --allow-file-access-from-files "%1"`), EXE);
  assert.equal(
    exeFromProtocolCommand('"C:\\dev\\pauli-speaks\\node_modules\\electron\\dist\\electron.exe" "C:\\dev\\pauli-speaks" "%1"'),
    null,
    'a development checkout runs electron.exe',
  );
  assert.equal(exeFromProtocolCommand(''), null);
  assert.equal(exeFromProtocolCommand(undefined), null);
});

test('reading the reg.exe answer', () => {
  const out = [
    '',
    'HKEY_CURRENT_USER\\Software\\Classes\\pauli-speaks\\shell\\open\\command',
    `    (Default)    REG_SZ    "${EXE}" "%1"`,
    '',
  ].join('\r\n');
  assert.equal(parseRegQuery(out), `"${EXE}" "%1"`);
  assert.equal(parseRegQuery('ERROR: The system was unable to find the specified registry key or value.'), null);
  assert.equal(parseRegQuery(undefined), null);
});

test('where to look for the app', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  assert.deepEqual(exeCandidates(env, null), [
    'C:\\Users\\ana\\AppData\\Local\\Programs\\Pauli Speaks\\Pauli Speaks.exe',
    'C:\\Program Files\\Pauli Speaks\\Pauli Speaks.exe',
  ]);
  assert.equal(exeCandidates(env, 'D:\\Apps\\Pauli Speaks\\Pauli Speaks.exe')[0], 'D:\\Apps\\Pauli Speaks\\Pauli Speaks.exe', 'the link handler first');
  assert.equal(exeCandidates(env, EXE).length, 2, 'no duplicates');
  assert.deepEqual(exeCandidates({}, null), []);
});

test('the default folder matches the installer (per-user NSIS, named after the product)', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.nsis.oneClick, false);
  const name = pkg.build.productName;
  assert.match(name, /^[-_+0-9a-zA-Z .]+$/, 'electron-builder then names the folder after the product');
  assert.equal(exeCandidates({ LOCALAPPDATA: 'L:' }, null)[0], `L:\\Programs\\${name}\\${name}.exe`);
});

test('the manifest lists exactly these actions and loads nothing from the web', () => {
  const dir = path.join(__dirname, '..', 'integrations', 'streamdeck');
  const sdPlugin = fs.readdirSync(dir).find((f) => f.endsWith('.sdPlugin'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, sdPlugin, 'manifest.json'), 'utf8'));
  assert.equal(sdPlugin, `${manifest.UUID}.sdPlugin`);
  assert.equal(`${manifest.UUID}.`, UUID_PREFIX);
  assert.deepEqual(
    manifest.Actions.map((a) => a.UUID).sort(),
    Object.values(ACTIONS).map((id) => UUID_PREFIX + id).sort(),
  );
  for (const file of [JSON.stringify(manifest), fs.readFileSync(path.join(dir, sdPlugin, 'ui', 'inspector.html'), 'utf8')]) {
    assert.doesNotMatch(file, /https?:\/\//, 'nothing loaded from the web');
  }
});
