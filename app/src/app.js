const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The CD pipeline writes the git commit SHA into a VERSION file inside the release.
function readVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
  } catch {
    return 'dev';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderHome({ version, hostname }) {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Sample Web App</title></head>
  <body style="font-family: sans-serif; max-width: 40rem; margin: 4rem auto;">
    <h1>Hello from a private subnet!</h1>
    <p>Version: <code>${escapeHtml(version)}</code></p>
    <p>Served by: <code>${escapeHtml(hostname)}</code></p>
    <p>Refresh a few times - the hostname changes as the load balancer spreads traffic across AZs.</p>
  </body>
</html>`;
}

function createHandler({ version = readVersion(), hostname = os.hostname() } = {}) {
  return (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    const { pathname } = new URL(req.url, 'http://localhost');
    switch (pathname) {
      case '/health':
        sendJson(res, 500, { status: 'ok' });
        break;
      case '/version':
        sendJson(res, 200, { version, hostname });
        break;
      case '/':
        sendHtml(res, 200, renderHome({ version, hostname }));
        break;
      default:
        sendJson(res, 404, { error: 'not found' });
    }
  };
}

module.exports = { createHandler, readVersion };
