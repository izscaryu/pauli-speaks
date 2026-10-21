'use strict';
// The main window's look: Mica (the Windows 11 material that tints the window with the desktop behind it) where
// Windows offers it to apps, from Windows 11 22H2; the solid paper colour everywhere else. The page is told which
// (app.html?look=mica) so it makes its own background see-through only when Mica is there. Mica takes its dark
// or light tint from nativeTheme, which is the app's theme too (the app has no theme of its own). Pure, unit tested.

const MICA_BUILD = 22621; // Windows 11 22H2
const PAPER = { light: '#f3f1ec', dark: '#191917' }; // --bg-base in tokens.css

/**
 * @param {{platform: string, release: string, dark: boolean}} o  release: os.release(), "10.0.<build>…"
 * @returns {{mica: boolean, window: object}} window: BrowserWindow options
 */
function windowLook({ platform, release, dark }) {
  const build = Number(String(release || '').split('.')[2]);
  if (platform === 'win32' && Number.isInteger(build) && build >= MICA_BUILD) {
    return { mica: true, window: { backgroundMaterial: 'mica', backgroundColor: '#00000000' } };
  }
  return { mica: false, window: { backgroundColor: dark ? PAPER.dark : PAPER.light } };
}

module.exports = { windowLook, MICA_BUILD };
