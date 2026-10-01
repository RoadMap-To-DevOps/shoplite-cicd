const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHandler } = require('../src/app');

let server;
let baseUrl;

before(async () => {
  server = http.createServer(createHandler({ version: 'abc123', hostname: 'test-host' }));
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('GET /health returns 200 ok', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /version returns version and hostname', async () => {
  const res = await fetch(`${baseUrl}/version`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { version: 'abc123', hostname: 'test-host' });
});

test('GET / renders the version', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /abc123/);
});

test('unknown path returns 404', async () => {
  const res = await fetch(`${baseUrl}/nope`);
  assert.equal(res.status, 404);
});

test('non-GET returns 405', async () => {
  const res = await fetch(`${baseUrl}/health`, { method: 'POST' });
  assert.equal(res.status, 405);
});
