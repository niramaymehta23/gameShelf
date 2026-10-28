// Loads client scripts from public/js/ into a sandbox, outside the browser, with the few util.js
// helpers they need (util.js itself touches the DOM when it loads). Returns the named globals.
//   load(['hues.js'], ['huState', 'HUE_DECK'], { rpsState: () => ({ starter: 'host' }) })
import fs from 'node:fs';
import vm from 'node:vm';

export function load(files, names, extra = {}) {
  const ctx = vm.createContext({
    clone: (x) => JSON.parse(JSON.stringify(x)), sortedKeys: (o) => Object.keys(o || {}).sort(),
    other: (s) => (s === 'host' ? 'guest' : 'host'), pad3: (n) => String(n).padStart(3, '0'),
    ...extra,
  });
  for (const f of files) vm.runInContext(fs.readFileSync('public/js/' + f, 'utf8'), ctx);
  vm.runInContext(`globalThis.__out = { ${names.join(', ')} };`, ctx);
  return ctx.__out;
}
