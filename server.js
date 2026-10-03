// Local admin server for the "90 Days to 2027" tracker.
//
// The hosted site (GitHub Pages / Vercel) is static and read-only: it just
// reads public/data.json. Running this server locally turns on admin mode:
//   - GET/PUT /api/data   read & write public/data.json (+ private keys in data/secrets.json)
//   - GET/POST /api/publish  git commit + push public/data.json so the live site updates
//   - GET /api/yt-feed    proxy for the YouTube playlist RSS feed (no CORS in browsers)
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PORT = Number(process.env.PORT) || 3090;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRIVATE_DIR = path.join(__dirname, 'data'); // gitignored
const PUBLIC_DATA = path.join(PUBLIC_DIR, 'data.json');
const SECRETS_FILE = path.join(PRIVATE_DIR, 'secrets.json');
const LEGACY_FILE = path.join(PRIVATE_DIR, 'tracker.json');
const SECRET_KEYS = ['ytKey', 'tmdbKey'];
const MAX_BODY = 5 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fs.rename(tmp, file);
}

// Block other websites from writing to this local server (CSRF): writes must be
// JSON (forces a CORS preflight, which we never approve) from our own origin.
function isTrustedWrite(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const u = new URL(origin);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || Number(u.port) !== PORT) return false;
    } catch {
      return false;
    }
  }
  return (req.headers['content-type'] || '').startsWith('application/json');
}

async function handleData(req, res) {
  if (req.method === 'GET') {
    const pub = (await readJson(PUBLIC_DATA)) ?? (await readJson(LEGACY_FILE)) ?? {};
    const secrets = (await readJson(SECRETS_FILE)) ?? {};
    pub.settings = { ...(pub.settings || {}), ...secrets };
    return send(res, 200, pub);
  }
  if (req.method === 'PUT') {
    if (!isTrustedWrite(req)) return send(res, 403, { error: 'Forbidden' });
    const data = JSON.parse(await readBody(req));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, { error: 'Expected an object' });
    // API keys never go into the public file.
    const settings = { ...(data.settings || {}) };
    const secrets = {};
    for (const k of SECRET_KEYS) {
      secrets[k] = settings[k] || '';
      delete settings[k];
    }
    await writeJson(SECRETS_FILE, secrets);
    await fs.copyFile(PUBLIC_DATA, path.join(PRIVATE_DIR, 'data.prev.json')).catch(() => {});
    await writeJson(PUBLIC_DATA, { ...data, settings });
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: 'Method not allowed' });
}

function git(...args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: __dirname, windowsHide: true, timeout: 90000 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())
    );
  });
}

async function publishStatus() {
  try {
    await git('rev-parse', '--is-inside-work-tree');
  } catch {
    return { git: false, dirty: false, remote: false };
  }
  const dirty = !!(await git('status', '--porcelain', '--', 'public/data.json'));
  const remote = !!(await git('remote').catch(() => ''));
  return { git: true, dirty, remote };
}

async function handlePublish(req, res) {
  if (req.method === 'GET') return send(res, 200, await publishStatus());
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!isTrustedWrite(req)) return send(res, 403, { error: 'Forbidden' });

  const status = await publishStatus();
  if (!status.git) return send(res, 400, { error: 'This folder is not a git repository yet — see README.' });
  if (status.dirty) {
    await git('add', '--', 'public/data.json');
    const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    await git('commit', '-m', `Update tracker data (${stamp})`, '--', 'public/data.json');
  }
  if (!status.remote) return send(res, 200, { ok: true, message: 'Committed locally — add a GitHub remote to go live.' });
  try {
    await git('push');
  } catch (e) {
    return send(res, 502, { error: `Committed, but push failed: ${e.message.split('\n')[0]}` });
  }
  send(res, 200, { ok: true, message: status.dirty ? 'Published! The site updates in about a minute.' : 'Already up to date — pushed.' });
}

const decodeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

async function handleFeed(url, res) {
  const id = url.searchParams.get('playlist') || '';
  if (!/^[\w-]{10,64}$/.test(id)) return send(res, 400, { error: 'Invalid playlist ID' });
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${id}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return send(res, 502, { error: `YouTube feed returned ${r.status}. Is the playlist public?` });
  const xml = await r.text();
  const pick = (s, re) => (s.match(re) || [])[1] || '';
  const videos = xml
    .split('<entry>')
    .slice(1)
    .map((e, i) => ({
      videoId: pick(e, /<yt:videoId>([^<]+)</),
      title: decodeXml(pick(e, /<title>([^<]*)</)),
      publishedAt: pick(e, /<published>([^<]+)</),
      position: i,
    }));
  send(res, 200, { videos });
}

async function handleStatic(url, res) {
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const body = await fs.readFile(file);
    send(res, 200, body, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/data') return await handleData(req, res);
      if (url.pathname === '/api/publish') return await handlePublish(req, res);
      if (url.pathname === '/api/yt-feed') return await handleFeed(url, res);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      await handleStatic(url, res);
    } catch (e) {
      console.error(e);
      send(res, 500, { error: e.message || 'Server error' });
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`90 Days to 2027 (admin) → http://localhost:${PORT}`);
  });
