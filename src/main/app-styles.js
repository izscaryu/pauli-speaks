'use strict';
// The apps the default modes switch on in (modes.js), by the focused window's executable name (no text or
// screenshots leave the PC). Until 1.5 these were the "App styles" rules; settings v7 turns saved rules into modes.

const DEFAULT_APP_RULES = [
  ['code.exe', 'code'], ['cursor.exe', 'code'], ['windowsterminal.exe', 'code'], ['powershell.exe', 'code'],
  ['pwsh.exe', 'code'], ['cmd.exe', 'code'], ['idea64.exe', 'code'], ['devenv.exe', 'code'], ['notepad++.exe', 'code'],
  ['slack.exe', 'casual'], ['discord.exe', 'casual'], ['whatsapp.exe', 'casual'], ['telegram.exe', 'casual'],
  ['ms-teams.exe', 'casual'], ['messenger.exe', 'casual'], ['signal.exe', 'casual'],
  ['outlook.exe', 'formal'], ['olk.exe', 'formal'], ['winword.exe', 'formal'], ['thunderbird.exe', 'formal'],
].map(([app, style]) => ({ app, style }));

module.exports = { DEFAULT_APP_RULES };
