// Our Game Shelf server: serves the web app and keeps both players in sync over one WebSocket.
//
//   HTTP  GET /…      static files from ../public
//         GET /healthz
//   WS    /ws         JSON messages, see PROTOCOL below
//
// PROTOCOL (client → server, every request carries an `id` that the reply echoes)
//   {id, op:'get',    path}            → {id, ok, exists, data}
//   {id, op:'set',    path, data}      → {id, ok}
//   {id, op:'update', path, data}      → {id, ok}        deep-merges into an existing doc
//   {id, op:'delete', path}            → {id, ok}
//   {id, op:'sub',    path}            → {id, ok} then pushes {t:'doc', path, exists, data} now and on every change
//   {id, op:'unsub',  path}            → {id, ok}
//   {id, op:'join',   code, pres}      → {id, ok, me} joins a table's presence room (one room per connection)
//   {id, op:'pres',   patch}           → {id, ok}        merges into your presence; null removes a key
//   {id, op:'leave'}                   → {id, ok}
//   {op:'ping'}                        → {t:'pong'}
// Server pushes
//   {t:'doc', path, exists, data}      a subscribed document changed
//   {t:'peers', peers:[{id, pres, at}]} everyone else in your room (sent on any join/leave/presence change)
// Errors reply {id, ok:false, code, message}; codes: invalid_argument, rate_limited, unknown_op.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store, StoreError, validPath } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE === 'memory' ? null : (process.env.DATA_FILE || path.resolve(__dirname, '../data/db.json'));

const store = new Store(DATA_FILE);

// ---------------- static files ----------------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // unknown paths fall back to the app (so /join/ABCD style links can be added later)
      if (!path.extname(rel)) return sendFile(res, path.join(PUBLIC, 'index.html'), 'no-cache');
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const cache = rel.startsWith('/art/') || rel.startsWith('/icons/') ? 'public, max-age=604800' : 'no-cache';
    sendFile(res, file, cache);
  });
}
function sendFile(res, file, cache) {
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  serveStatic(req, res);
});

// ---------------- realtime ----------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 96 * 1024 });
const rooms = new Map(); // code -> Set<Conn>
let nextId = 1;

function send(conn, msg) { if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify(msg)); }

function broadcastPeers(code) {
  const members = rooms.get(code);
  if (!members) return;
  for (const c of members) {
    const peers = [...members].filter((o) => o !== c).map((o) => ({ id: o.id, pres: o.pres, at: o.presAt }));
    send(c, { t: 'peers', peers });
  }
}
function leaveRoom(conn) {
  if (!conn.room) return;
  const code = conn.room;
  const set = rooms.get(code);
  conn.room = null;
  if (set) { set.delete(conn); if (!set.size) rooms.delete(code); else broadcastPeers(code); }
}

store.onChange((p, data) => {
  for (const c of wss.clients) {
    const conn = c.conn;
    if (conn && conn.subs.has(p)) send(conn, { t: 'doc', path: p, exists: data !== undefined, data: data ?? null });
  }
});

wss.on('connection', (ws) => {
  const conn = { id: 'p' + (nextId++).toString(36), ws, subs: new Set(), room: null, pres: {}, presAt: Date.now(), alive: true, bucket: 60, last: Date.now() };
  ws.conn = conn;
  ws.on('pong', () => { conn.alive = true; });
  ws.on('close', () => leaveRoom(conn));
  ws.on('message', (buf) => {
    // token bucket: ~30 messages a second sustained, bursts of 60
    const now = Date.now();
    conn.bucket = Math.min(60, conn.bucket + ((now - conn.last) / 1000) * 30);
    conn.last = now;
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.op === 'ping') { send(conn, { t: 'pong' }); return; }
    const reply = (extra) => send(conn, { id: msg.id, ok: true, ...extra });
    const fail = (code, message) => send(conn, { id: msg.id, ok: false, code, message });
    if (conn.bucket < 1) return fail('rate_limited', 'slow down');
    conn.bucket -= 1;
    try {
      switch (msg.op) {
        case 'get': {
          if (!validPath(msg.path)) return fail('invalid_argument', 'bad path');
          const d = store.get(msg.path);
          return reply({ exists: d !== undefined, data: d ?? null });
        }
        case 'set': store.set(msg.path, msg.data); return reply();
        case 'update': store.update(msg.path, msg.data); return reply();
        case 'delete': store.delete(msg.path); return reply();
        case 'sub': {
          if (!validPath(msg.path)) return fail('invalid_argument', 'bad path');
          if (conn.subs.size >= 32 && !conn.subs.has(msg.path)) return fail('invalid_argument', 'too many subscriptions');
          conn.subs.add(msg.path);
          reply();
          const d = store.get(msg.path);
          return send(conn, { t: 'doc', path: msg.path, exists: d !== undefined, data: d ?? null });
        }
        case 'unsub': conn.subs.delete(msg.path); return reply();
        case 'join': {
          const code = String(msg.code || '').toUpperCase();
          if (!/^[A-Z]{4}$/.test(code)) return fail('invalid_argument', 'bad code');
          leaveRoom(conn);
          conn.room = code;
          conn.pres = sanitizePres(msg.pres || {});
          conn.presAt = Date.now();
          if (!rooms.has(code)) rooms.set(code, new Set());
          rooms.get(code).add(conn);
          reply({ me: conn.id });
          return broadcastPeers(code);
        }
        case 'pres': {
          if (!conn.room) return reply();
          const next = { ...conn.pres };
          for (const [k, v] of Object.entries(msg.patch || {})) { if (v === null) delete next[k]; else next[k] = v; }
          conn.pres = sanitizePres(next);
          conn.presAt = Date.now();
          reply();
          return broadcastPeers(conn.room);
        }
        case 'leave': leaveRoom(conn); return reply();
        default: return fail('unknown_op', 'unknown op');
      }
    } catch (e) {
      if (e instanceof StoreError) return fail(e.code, e.message);
      console.error(e);
      return fail('invalid_argument', 'could not do that');
    }
  });
});

function sanitizePres(p) {
  const s = JSON.stringify(p);
  if (!s || s.length > 2048) return {};
  return JSON.parse(s);
}

// drop dead sockets (phones that went to sleep without closing)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.conn.alive) { ws.terminate(); continue; }
    ws.conn.alive = false;
    ws.ping();
  }
}, 15000).unref();

function shutdown() {
  console.log('saving and shutting down');
  try { store.flush(); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Our Game Shelf on http://localhost:${PORT}  (data: ${DATA_FILE || 'in memory only'})`);
});
