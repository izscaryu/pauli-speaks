'use strict';
// The website in docs/site (GitHub Pages): every link and file it uses is there, every page exists in
// English and Croatian, every page says what it is, and nothing is loaded from another site except the
// one call to the GitHub API for the latest release. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, '..', 'docs', 'site');
const API = 'https://api.github.com/repos/izscaryu/pauli-speaks/releases/latest';
const REPO = 'https://github.com/izscaryu/pauli-speaks';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

const files = fs.existsSync(SITE) ? walk(SITE) : [];
const rel = (f) => path.relative(SITE, f).split(path.sep).join('/');
const pages = files.filter((f) => f.endsWith('.html'));
const scripts = files.filter((f) => f.endsWith('.js'));
const styles = files.filter((f) => f.endsWith('.css'));
const read = (f) => fs.readFileSync(f, 'utf8');
const isHr = (f) => rel(f).startsWith('hr/');

// Every attribute that names a URL, with the tag it is on.
function urls(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, tag, attrs] = m;
    for (const a of attrs.matchAll(/(?:^|\s)(href|src|srcset|poster|action|data|xlink:href)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      out.push({ tag: tag.toLowerCase(), attr: a[1].toLowerCase(), value: a[3] ?? a[4], attrs });
    }
  }
  return out;
}

const isExternal = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//');
const ids = (html) => new Set([...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]));

/** The file a relative link from `from` points to (a folder means its index.html), or null when outside the site. */
function target(from, link) {
  const clean = decodeURIComponent(link.split('#')[0].split('?')[0]);
  if (!clean) return from;
  let full = path.resolve(path.dirname(from), clean);
  if (clean.endsWith('/') || (fs.existsSync(full) && fs.statSync(full).isDirectory())) full = path.join(full, 'index.html');
  return full.startsWith(SITE + path.sep) ? full : null;
}

test('the site has an English and a Croatian home page and its own styles and script', () => {
  assert.ok(fs.existsSync(path.join(SITE, 'index.html')), 'docs/site/index.html');
  assert.ok(fs.existsSync(path.join(SITE, 'hr', 'index.html')), 'docs/site/hr/index.html');
  assert.ok(styles.length > 0, 'a stylesheet');
  assert.ok(scripts.length > 0, 'a script');
});

test('every internal link and file a page uses is there, anchors included', () => {
  const problems = [];
  for (const page of pages) {
    for (const { value, attr } of urls(read(page))) {
      if (isExternal(value) || value === '') continue;
      const parts = attr === 'srcset' ? value.split(',').map((s) => s.trim().split(/\s+/)[0]) : [value];
      for (const part of parts) {
        const file = target(page, part);
        if (!file || !fs.existsSync(file)) {
          problems.push(`${rel(page)}: ${part}`);
          continue;
        }
        const hash = part.includes('#') ? part.split('#')[1] : '';
        if (hash && file.endsWith('.html') && !ids(read(file)).has(decodeURIComponent(hash))) {
          problems.push(`${rel(page)}: ${part} (no id "${hash}")`);
        }
      }
    }
  }
  for (const css of styles) {
    for (const m of read(css).matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (m[1].startsWith('data:') || m[1].startsWith('#')) continue;
      const file = target(css, m[1]);
      if (!file || !fs.existsSync(file)) problems.push(`${rel(css)}: ${m[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every English page has a Croatian one and the other way round, and each links to the other', () => {
  const en = pages.filter((f) => !isHr(f)).map(rel).sort();
  const hr = pages.filter(isHr).map((f) => rel(f).slice(3)).sort();
  assert.ok(en.length >= 9, `expected the home page and at least 8 more, found ${en.length}`);
  assert.deepEqual(hr, en);
  for (const page of pages) {
    const other = isHr(page) ? path.join(SITE, rel(page).slice(3)) : path.join(SITE, 'hr', rel(page));
    const links = urls(read(page)).filter((u) => u.tag === 'a' && !isExternal(u.value));
    assert.ok(links.some((u) => target(page, u.value) === other && /\bhreflang\s*=/.test(u.attrs)),
      `${rel(page)} links to ${rel(other)} with hreflang`);
  }
});

test('every page has a title, the right lang and a description', () => {
  for (const page of pages) {
    const html = read(page);
    const lang = html.match(/<html\b[^>]*\blang\s*=\s*"([^"]+)"/i);
    assert.equal(lang && lang[1], isHr(page) ? 'hr' : 'en', `${rel(page)} lang`);
    const title = html.match(/<title>([^<]*)<\/title>/i);
    assert.ok(title && title[1].trim().length > 3, `${rel(page)} title`);
    const desc = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
    assert.ok(desc && desc[1].trim().length > 20, `${rel(page)} meta description`);
    assert.match(html, /<meta\s+name="viewport"/i, `${rel(page)} viewport`);
  }
});

test('nothing is loaded from another site, only the GitHub API is called', () => {
  const problems = [];
  for (const page of pages) {
    const html = read(page);
    // A browser enforces this: only this site, and the one API for connections.
    const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
    if (!csp) problems.push(`${rel(page)}: no Content-Security-Policy`);
    else {
      const policy = Object.fromEntries(csp[1].split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));
      if (!["'none'", "'self'"].includes(String(policy['default-src']))) problems.push(`${rel(page)}: default-src`);
      if (String(policy['connect-src']) !== 'https://api.github.com') problems.push(`${rel(page)}: connect-src ${policy['connect-src']}`);
      for (const [k, v] of Object.entries(policy)) {
        if (k !== 'connect-src' && v.some((s) => /^https?:|^\*|^'unsafe-/.test(s))) problems.push(`${rel(page)}: ${k} ${v.join(' ')}`);
      }
    }
    for (const u of urls(html)) {
      const navigation = u.tag === 'a' && u.attr === 'href';
      if (!navigation && isExternal(u.value) && !u.value.startsWith('data:')) problems.push(`${rel(page)}: <${u.tag} ${u.attr}="${u.value}">`);
    }
    if (/<script\b(?![^>]*\bsrc=)[^>]*>[^<]*\S/i.test(html)) problems.push(`${rel(page)}: inline script`);
    if (/\sstyle\s*=/i.test(html)) problems.push(`${rel(page)}: inline style attribute`);
    if (/<(iframe|object|embed)\b/i.test(html)) problems.push(`${rel(page)}: embeds another page`);
  }
  for (const css of styles) {
    const text = read(css);
    if (/@import|url\(\s*['"]?(https?:)?\/\//i.test(text)) problems.push(`${rel(css)}: loads something`);
  }
  for (const js of scripts) {
    const text = read(js);
    for (const m of text.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      if (m[0] !== API && !m[0].startsWith(`${REPO}/`) && m[0] !== REPO) problems.push(`${rel(js)}: ${m[0]}`);
    }
    if (/XMLHttpRequest|sendBeacon|WebSocket|EventSource|import\s*\(|importScripts|document\.write/.test(text)) problems.push(`${rel(js)}: other network or script loading`);
    for (const m of text.matchAll(/\bfetch\s*\(\s*([^,)]+)/g)) {
      if (m[1].trim() !== 'RELEASE_API') problems.push(`${rel(js)}: fetch(${m[1].trim()})`);
    }
  }
  assert.deepEqual(problems, []);
});

test('nothing from the private folders is on the site', () => {
  for (const f of files) {
    if (!/\.(html|css|js|svg|txt|md)$/.test(f)) continue;
    assert.doesNotMatch(read(f), /docs\/plans|research_notes|\breports\/|\banalysis\//, rel(f));
  }
});

test('the download button picks the installer from the latest release, else the releases page', () => {
  const site = require(path.join(SITE, 'assets', 'site.js'));
  assert.equal(site.RELEASE_API, API);
  assert.equal(site.RELEASES_PAGE, `${REPO}/releases/latest`);
  const dl = (name) => `${REPO}/releases/download/v1.6.0/${name}`;
  const release = {
    tag_name: 'v1.6.0',
    assets: [
      { name: 'Pauli-Speaks-Portable-1.6.0.exe', browser_download_url: dl('Pauli-Speaks-Portable-1.6.0.exe'), size: 1 },
      { name: 'Pauli-Speaks-Setup-1.6.0.exe.blockmap', browser_download_url: dl('Pauli-Speaks-Setup-1.6.0.exe.blockmap'), size: 1 },
      { name: 'Pauli-Speaks-Setup-1.6.0.exe', browser_download_url: dl('Pauli-Speaks-Setup-1.6.0.exe'), size: 182452224 },
      { name: 'latest.yml', browser_download_url: dl('latest.yml'), size: 1 },
    ],
  };
  assert.deepEqual(site.pickInstaller(release), { version: '1.6.0', url: dl('Pauli-Speaks-Setup-1.6.0.exe'), sizeMB: 174 });
  // Only this project's installer, for the version the release is.
  assert.equal(site.pickInstaller({ ...release, tag_name: 'v1.5.1' }), null);
  const elsewhere = { ...release.assets[2], browser_download_url: 'https://example.com/Pauli-Speaks-Setup-1.6.0.exe' };
  assert.equal(site.pickInstaller({ ...release, assets: [elsewhere] }), null);
  assert.equal(site.pickInstaller({ ...release, assets: release.assets.slice(0, 2) }), null);
  for (const bad of [null, undefined, 'x', {}, { assets: 'x' }, { tag_name: 'v1.6.0' }]) assert.equal(site.pickInstaller(bad), null);
});
