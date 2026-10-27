import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, deepMerge, validPath } from '../server/store.js';

test('only table and match paths are allowed', () => {
  assert.ok(validPath('tables/ABCD'));
  assert.ok(validPath('tables/ABCD/matches/mvppsznttp27'));
  assert.ok(!validPath('tables/abcd'));
  assert.ok(!validPath('tables/ABCD/../x'));
  assert.ok(!validPath('users/ABCD'));
  assert.ok(!validPath(null));
});

test('update deep-merges objects and replaces everything else', () => {
  const s = new Store(null);
  s.set('tables/ABCD', { host: { name: 'N', dev: 'd1' }, results: {}, current: 'x' });
  s.update('tables/ABCD', { guest: { name: 'P', dev: 'd2' }, results: { m1: { g: 'c4', w: 'host' } }, current: null });
  assert.deepEqual(s.get('tables/ABCD'), {
    host: { name: 'N', dev: 'd1' }, guest: { name: 'P', dev: 'd2' }, results: { m1: { g: 'c4', w: 'host' } }, current: null,
  });
});

test('update on a missing document is refused', () => {
  const s = new Store(null);
  assert.throws(() => s.update('tables/ZZZZ', { a: 1 }), { code: 'invalid_argument' });
});

test('deepMerge ignores prototype keys', () => {
  const t = deepMerge({}, JSON.parse('{"__proto__": {"polluted": true}}'));
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(Object.keys(t), []);
});

test('deleting a table removes its matches and notifies listeners', () => {
  const s = new Store(null);
  const seen = [];
  s.onChange((p, d) => seen.push([p, d === undefined]));
  s.set('tables/ABCD', { a: 1 });
  s.set('tables/ABCD/matches/abcd1234', { b: 2 });
  s.delete('tables/ABCD');
  assert.equal(s.get('tables/ABCD/matches/abcd1234'), undefined);
  assert.deepEqual(seen.slice(-2), [['tables/ABCD/matches/abcd1234', true], ['tables/ABCD', true]]);
});

test('documents survive a restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-')), 'db.json');
  const a = new Store(file);
  a.set('tables/ABCD', { code: 'ABCD' });
  a.flush();
  const b = new Store(file);
  assert.deepEqual(b.get('tables/ABCD'), { code: 'ABCD' });
});

test('oversized documents are refused', () => {
  const s = new Store(null);
  assert.throws(() => s.set('tables/ABCD', { big: 'x'.repeat(70 * 1024) }), { code: 'invalid_argument' });
});
