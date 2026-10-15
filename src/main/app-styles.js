'use strict';
// Per-app writing style: simple local rules keyed on the focused window's
// executable name (no text or screenshots leave the PC).

const STYLES = {
  normal: { label: 'Normal', desc: 'Sentences as dictated' },
  casual: { label: 'Casual', desc: 'No full stop at the end - for chat' },
  formal: { label: 'Formal', desc: 'Always ends with punctuation - for email and documents' },
  code: { label: 'Code', desc: 'No capitals, no full stop at the end - for editors and terminals' },
};

const DEFAULT_APP_RULES = [
  ['code.exe', 'code'], ['cursor.exe', 'code'], ['windowsterminal.exe', 'code'], ['powershell.exe', 'code'],
  ['pwsh.exe', 'code'], ['cmd.exe', 'code'], ['idea64.exe', 'code'], ['devenv.exe', 'code'], ['notepad++.exe', 'code'],
  ['slack.exe', 'casual'], ['discord.exe', 'casual'], ['whatsapp.exe', 'casual'], ['telegram.exe', 'casual'],
  ['ms-teams.exe', 'casual'], ['messenger.exe', 'casual'], ['signal.exe', 'casual'],
  ['outlook.exe', 'formal'], ['olk.exe', 'formal'], ['winword.exe', 'formal'], ['thunderbird.exe', 'formal'],
].map(([app, style]) => ({ app, style }));

/** @param {string|null} exe e.g. "Code.exe" */
function resolveStyle(exe, appStyles) {
  if (!exe || !appStyles || !appStyles.enabled) return 'normal';
  const name = exe.toLowerCase();
  const rule = (appStyles.rules || []).find((r) => r.app.toLowerCase() === name);
  return rule && STYLES[rule.style] ? rule.style : 'normal';
}

module.exports = { STYLES, DEFAULT_APP_RULES, resolveStyle };
