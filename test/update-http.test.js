'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../src/main/update-http.js');

const BODY = Buffer.alloc(300000, 7);
const SHA = crypto.createHash('sha512').update(BODY).digest('base64');
let server;
let base;
let dir;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/file' }); return res.end(); }
    if (req.url === '/file') { res.writeHead(200, { 'content-length': BODY.length }); return res.end(BODY); }
    if (req.url === '/stall') {
      // Headers and a little data, then nothing: a stalled download.
      res.writeHead(200, { 'content-length': BODY.length });
      res.write(BODY.subarray(0, 1000));
      return undefined;
    }
    if (req.url === '/text') { res.writeHead(200); return res.end('version: 1.3.0'); }
    if (req.url === '/json') { res.writeHead(200); return res.end('[{"tag_name":"v1.3.0"}]'); }
    res.writeHead(404);
    return res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-upd-'));
});

after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fetchText and fetchJson read an answer', async () => {
  assert.strictEqual(await H.fetchText(`${base}/text`), 'version: 1.3.0');
  assert.deepStrictEqual(await H.fetchJson(`${base}/json`), [{ tag_name: 'v1.3.0' }]);
});

test('a missing file is reported as not_found', async () => {
  await assert.rejects(() => H.fetchText(`${base}/nope`), (e) => e.code === 'not_found');
});

test('only http and https addresses are fetched', async () => {
  await assert.rejects(() => H.fetchText('ftp://127.0.0.1/x'), (e) => e.code === 'bad_url');
});

test('downloadVerified follows a redirect, reports progress and keeps a good file', async () => {
  const dest = path.join(dir, 'sub', 'good.exe');
  const seen = [];
  await H.downloadVerified(`${base}/redirect`, dest, { sha512: SHA, size: BODY.length, onProgress: (p) => seen.push(p) });
  assert.ok(fs.readFileSync(dest).equals(BODY));
  assert.strictEqual(seen[seen.length - 1], 1);
});

test('a checksum mismatch deletes the file and never keeps it', async () => {
  const dest = path.join(dir, 'bad.exe');
  await assert.rejects(
    () => H.downloadVerified(`${base}/file`, dest, { sha512: 'not-it', size: BODY.length }),
    (e) => e.code === 'damaged'
  );
  assert.strictEqual(fs.existsSync(dest), false);
});

test('a size mismatch is damage too', async () => {
  const dest = path.join(dir, 'short.exe');
  await assert.rejects(
    () => H.downloadVerified(`${base}/file`, dest, { sha512: SHA, size: BODY.length + 1 }),
    (e) => e.code === 'damaged'
  );
  assert.strictEqual(fs.existsSync(dest), false);
});

test('a stalled download times out and deletes the partial file', async () => {
  const dest = path.join(dir, 'stall.exe');
  await assert.rejects(
    () => H.downloadVerified(`${base}/stall`, dest, { sha512: SHA, size: BODY.length, stallMs: 300 }),
    (e) => e.code === 'timeout'
  );
  assert.strictEqual(fs.existsSync(dest), false);
});
