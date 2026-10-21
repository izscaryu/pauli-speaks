// Pauli Speaks for Stream Deck. Each button opens a pauli-speaks:// link or runs the app's
// exe with a flag (see lib/commands.js); nothing else. No network, and no state is read back
// from the app: the keys show fixed images.
import streamDeck, { SingletonAction } from '@elgato/streamdeck';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import commands from '../lib/commands.js';

const { ACTIONS, UUID_PREFIX, commandFor, launchFor, isAppExe, exeCandidates, exeFromProtocolCommand, parseRegQuery } =
  commands;

const LINK_KEY = 'HKCU\\Software\\Classes\\pauli-speaks\\shell\\open\\command';

/** The command Windows runs for pauli-speaks:// links, or null. */
function readLinkHandler() {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', LINK_KEY, '/ve'], { windowsHide: true, timeout: 3000 }, (err, stdout) =>
      resolve(err ? null : parseRegQuery(stdout)),
    );
  });
}

/** @returns {Promise<{exePath: string | null, chosen: boolean}>} */
async function findApp() {
  const { exePath } = await streamDeck.settings.getGlobalSettings();
  if (typeof exePath === 'string' && exePath.trim()) {
    const file = exePath.trim();
    return { exePath: isAppExe(file) && fs.existsSync(file) ? file : null, chosen: true };
  }
  const fromLink = exeFromProtocolCommand(await readLinkHandler());
  const found = exeCandidates(process.env, fromLink).find((file) => fs.existsSync(file));
  return { exePath: found ?? null, chosen: false };
}

/**
 * Starts the process and lets it go; resolves once Windows has started it. Not windowsHide:
 * if the app isn't running yet, this starts it, and its windows must show normally.
 */
function launch({ file, args }) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

class PauliAction extends SingletonAction {
  constructor(name) {
    super();
    this.name = name;
    this.manifestId = UUID_PREFIX + ACTIONS[name];
  }

  async onKeyDown(ev) {
    const settings = { mode: ev.payload.settings.mode };
    if (this.name === 'pasteLast') settings.exePath = (await findApp()).exePath;
    const command = commandFor(this.name, settings);
    const run = launchFor(command);
    if (!run) {
      streamDeck.logger.warn(`${this.name}: ${command.error ?? 'nothing to run'}`);
      await ev.action.showAlert();
      return;
    }
    try {
      await launch(run);
    } catch (err) {
      streamDeck.logger.error(`${this.name}: could not start (${err.code ?? err.message})`);
      await ev.action.showAlert();
    }
  }

  // The settings page asks where the app is; answer with what this plugin would use.
  async onSendToPlugin(ev) {
    if (ev.payload?.event !== 'findApp') return;
    await streamDeck.ui.sendToPropertyInspector({ event: 'app', ...(await findApp()) });
  }
}

for (const name of Object.keys(ACTIONS)) streamDeck.actions.registerAction(new PauliAction(name));
streamDeck.connect();
