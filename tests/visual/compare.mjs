// Proves a CSS change renders the same. Each captured DOM snapshot is drawn with the old and the new
// app.css at three screen sizes; every element's computed style (and ::before/::after) and the
// screenshot pixels must match. Custom properties are left out: what counts is what they resolve to.
//
//   CAPTURE=/tmp/dom npm run test:e2e                  every snap() in the e2e tests also saves its DOM
//   git show main:public/css/app.css > /tmp/old.css
//   node tests/visual/compare.mjs /tmp/old.css public/css/app.css /tmp/dom
//
// ONLY=<part of a name> compares just those snapshots; DUMP=<dir> saves pairs of pictures that differ.
// The snapshots hold the old DOM, so a change that also changes the markup shows up here too.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(import.meta.url)('playwright');
const [oldCss, newCss, dir] = process.argv.slice(2);
if (!dir) { console.error('usage: node tests/visual/compare.mjs <old.css> <new.css> <snapshot dir>'); process.exit(2); }
const css = { old: fs.readFileSync(oldCss, 'utf8'), new: fs.readFileSync(newCss, 'utf8') };
const SIZES = [[390, 844], [320, 640], [1280, 800]];
const FONTS = ['400 16px Caprasimo', '500 16px Caveat', '700 16px Caveat', '500 16px Figtree', '600 16px Figtree', '700 16px Figtree', '800 16px Figtree'];

// serves public/, each snapshot without its scripts and with the chosen stylesheet
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u.startsWith('/__css/')) { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(css[u.slice(7)]); }
  if (u.startsWith('/__snap/')) {
    const [, , which, name] = u.split('/');
    const html = fs.readFileSync(path.join(dir, name), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '')
      .replace('href="/css/app.css"', `href="/__css/${which}"`).replace('<head>', '<head><base href="/">');
    res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html>' + html);
  }
  const f = path.join(ROOT, 'public', u);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
// the headless shell with software, single-threaded raster paints most reproducibly
const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-gpu-rasterization', '--disable-partial-raster', '--force-color-profile=srgb', '--disable-lcd-text', '--num-raster-threads=1', '--disable-threaded-animation', '--disable-checker-imaging', '--run-all-compositor-stages-before-draw'] });

async function render(page, which, name) {
  // load twice: the second load paints with every texture already decoded
  for (let i = 0; i < 2; i++) await page.goto(`${base}/__snap/${which}/${name}`, { waitUntil: 'load' });
  await page.evaluate(async (fonts) => {
    await Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => {})));
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0; }
    for (const svg of document.querySelectorAll('svg')) { try { svg.pauseAnimations(); svg.setCurrentTime(0); } catch (e) {} }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, FONTS);
  const styles = await page.evaluate(() => [document.documentElement, ...document.documentElement.querySelectorAll('*')].flatMap((el) =>
    [null, '::before', '::after'].map((pseudo) => {
      const cs = getComputedStyle(el, pseudo);
      if (pseudo && cs.content === 'none') return null;
      const props = [];
      for (let k = 0; k < cs.length; k++) if (!cs[k].startsWith('--')) props.push(cs[k] + ':' + cs.getPropertyValue(cs[k]));
      return { tag: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().replace(/\s+/g, '.') : '') + (pseudo || ''), props };
    }).filter(Boolean)));
  // for the picture: no animations or transitions at all
  await page.evaluate(async () => {
    const st = document.createElement('style');
    st.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.append(st);
    for (const a of document.getAnimations()) a.cancel();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(300);
  return { styles, png: await page.screenshot({ fullPage: true }) };
}

let bad = 0, compared = 0;
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.html') && (!process.env.ONLY || f.includes(process.env.ONLY))).sort()) {
  for (const [w, hgt] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: hgt } });
    await render(page, 'old', name); // warm-up: a page's first paint can resample textures differently
    const o = await render(page, 'old', name);
    let n = await render(page, 'new', name);
    // rotated textures are now and then resampled differently from one load to the next; a real
    // difference shows up on every try, so the pixels only count as different if they never match
    for (let t = 0; t < 4 && Buffer.compare(o.png, n.png) !== 0; t++) n = await render(page, 'new', name);
    await page.close();
    compared++;
    const diffs = [];
    if (o.styles.length !== n.styles.length) diffs.push(`element count ${o.styles.length} vs ${n.styles.length}`);
    for (let k = 0; k < Math.min(o.styles.length, n.styles.length) && diffs.length < 6; k++) {
      const a = o.styles[k], b = n.styles[k];
      if (a.props.join(';') === b.props.join(';')) continue;
      diffs.push(`${a.tag}: ` + a.props.filter((p, j) => p !== b.props[j]).slice(0, 4).map((p) => `${p}  ->  ${b.props[a.props.indexOf(p)]}`).join(' | '));
    }
    const samePx = Buffer.compare(o.png, n.png) === 0;
    if (!samePx && process.env.DUMP) { fs.writeFileSync(path.join(process.env.DUMP, `${name}-${w}-old.png`), o.png); fs.writeFileSync(path.join(process.env.DUMP, `${name}-${w}-new.png`), n.png); }
    if (diffs.length || !samePx) { bad++; console.log(`DIFF ${name} @${w}x${hgt}${samePx ? '' : ' (pixels differ)'}` + diffs.map((d) => '\n  ' + d).join('')); }
  }
}
console.log(bad ? `\n${bad} of ${compared} renders differ` : `\nall ${compared} renders identical (computed styles and pixels)`);
await browser.close(); server.close();
process.exit(bad ? 1 : 0);
