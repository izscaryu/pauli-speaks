'use strict';
// The names people know for the apps History and Modes show: "Word", not WINWORD.EXE. Pure (CommonJS for the
// tests); in the window it is the global AppNames. Loaded before app.js.

(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.AppNames = core;
})(typeof self !== 'undefined' ? self : this, () => {
  // Process names in lower case, without .exe. Product names, so they are the same in every language.
  const KNOWN = {
    winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint', outlook: 'Outlook', olk: 'Outlook', onenote: 'OneNote',
    msaccess: 'Access', mspub: 'Publisher', 'ms-teams': 'Teams', teams: 'Teams', lync: 'Skype for Business',
    chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi', arc: 'Arc',
    code: 'VS Code', 'code - insiders': 'VS Code Insiders', cursor: 'Cursor', devenv: 'Visual Studio', idea64: 'IntelliJ IDEA',
    pycharm64: 'PyCharm', sublime_text: 'Sublime Text', notepad: 'Notepad', wordpad: 'WordPad', mspaint: 'Paint',
    windowsterminal: 'Terminal', cmd: 'Command Prompt', powershell: 'PowerShell', pwsh: 'PowerShell', explorer: 'File Explorer',
    slack: 'Slack', discord: 'Discord', whatsapp: 'WhatsApp', telegram: 'Telegram', signal: 'Signal', zoom: 'Zoom',
    notion: 'Notion', obsidian: 'Obsidian', thunderbird: 'Thunderbird', spotify: 'Spotify', acrobat: 'Acrobat',
    acrord32: 'Acrobat Reader', claude: 'Claude', chatgpt: 'ChatGPT',
  };

  /** "WINWORD.EXE" → "Word"; an app it doesn't know keeps its name without .exe, with a capital first letter. */
  function appName(exe) {
    const base = String(exe || '').trim().replace(/\.exe$/i, '');
    if (!base) return '';
    const known = KNOWN[base.toLowerCase()];
    if (known) return known;
    const flat = base === base.toUpperCase() || base === base.toLowerCase();
    return base.charAt(0).toUpperCase() + (flat ? base.slice(1).toLowerCase() : base.slice(1));
  }

  return { appName };
});
