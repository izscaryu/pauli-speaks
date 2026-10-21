'use strict';
// Pauli Speaks website: the Download button and the demo's Pause button. This is the only script on the
// site. It asks GitHub's API once for the latest release, so the button can point straight at the
// installer; if that fails, the button keeps its link to the releases page. No cookies, no trackers.
(function (root) {
  const RELEASE_API = 'https://api.github.com/repos/izscaryu/pauli-speaks/releases/latest';
  const RELEASES_PAGE = 'https://github.com/izscaryu/pauli-speaks/releases/latest';
  const DOWNLOADS = 'https://github.com/izscaryu/pauli-speaks/releases/download/';

  /** The installer in a release from the GitHub API, or null when there isn't a sound one. */
  function pickInstaller(release) {
    if (!release || typeof release !== 'object' || typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) return null;
    const version = release.tag_name.replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(version)) return null;
    const name = `Pauli-Speaks-Setup-${version}.exe`;
    const asset = release.assets.find((a) => a && a.name === name);
    if (!asset || typeof asset.browser_download_url !== 'string') return null;
    if (asset.browser_download_url !== `${DOWNLOADS}v${version}/${name}`) return null;
    const sizeMB = Number.isFinite(asset.size) && asset.size > 0 ? Math.round(asset.size / 1048576) : null;
    return { version, url: asset.browser_download_url, sizeMB };
  }

  function setUpDownload(doc) {
    const buttons = doc.querySelectorAll('[data-download]');
    if (!buttons.length || typeof fetch !== 'function') return;
    fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((res) => (res.ok ? res.json() : null))
      .then((release) => {
        const found = pickInstaller(release);
        if (!found) return;
        buttons.forEach((b) => { b.href = found.url; });
        doc.querySelectorAll('[data-download-note]').forEach((note) => {
          const template = note.getAttribute(found.sizeMB ? 'data-template' : 'data-template-nosize');
          if (template) note.textContent = template.replace('{version}', found.version).replace('{size}', String(found.sizeMB));
        });
      })
      .catch(() => {}); // the button already links to the releases page
  }

  function setUpDemo(doc) {
    doc.querySelectorAll('[data-demo-toggle]').forEach((button) => {
      const demo = button.closest('.demo');
      if (!demo) return;
      button.hidden = false;
      button.addEventListener('click', () => {
        const paused = demo.classList.toggle('paused');
        button.textContent = button.getAttribute(paused ? 'data-play' : 'data-pause');
      });
    });
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { RELEASE_API, RELEASES_PAGE, pickInstaller };
  } else if (root.document) {
    setUpDownload(root.document);
    setUpDemo(root.document);
  }
})(typeof window === 'undefined' ? globalThis : window);
