// Runs every tests/unit/*.test.js in its own process (so a game's tests can't leak into another's).
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'unit');
const only = process.argv[2];
let failed = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.test.js') && (!only || f.includes(only))).sort()) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log(`✗ ${f}`); } else console.log(`✓ ${f}`);
}
if (failed) { console.log(`${failed} test file(s) failed`); process.exit(1); }
