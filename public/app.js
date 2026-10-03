'use strict';

// ---- Constants -----------------------------------------------------------
const START = new Date(2026, 9, 3); // Day 1 = Oct 3, 2026 (local time)
const TOTAL = 90;
const DAY_MS = 864e5;
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const STATUSES = [
  { id: 'todo', label: 'Not started', pct: 0 },
  { id: 'planning', label: 'Planning', pct: 20 },
  { id: 'filming', label: 'Filming', pct: 45 },
  { id: 'editing', label: 'Editing', pct: 70 },
  { id: 'published', label: 'Published', pct: 100 },
];
const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

// ---- Helpers -------------------------------------------------------------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const dateFor = (n) => new Date(2026, 9, 2 + n);
const dayNumberFor = (d) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - START) / DAY_MS) + 1;
const todayN = () => dayNumberFor(new Date());
const fmtDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => d.toLocaleDateString(undefined, opts);
const statusOf = (id) => STATUS_BY_ID[id] || STATUSES[0];
const isPublished = (n) => state.days[n]?.status === 'published';

const videoIdFrom = (url) => (String(url || '').match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/) || [])[1] || '';
const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

function playlistIdFrom(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  try {
    return new URL(s).searchParams.get('list') || '';
  } catch {
    return /^[\w-]{10,64}$/.test(s) ? s : '';
  }
}

let toastTimer;
function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---- State & persistence -------------------------------------------------
const defaults = () => ({
  version: 1,
  updatedAt: 0,
  settings: { playlist: '', ytKey: '', matchBy: 'date', tmdbKey: '' },
  days: {},
  movies: {},
});
let state = defaults();
// 'admin' when the local server is running; 'public' on the static hosted site (read-only).
let mode = 'public';
const isAdmin = () => mode === 'admin';

function normalize(d) {
  const base = defaults();
  if (!d || typeof d !== 'object') return base;
  return {
    ...base,
    ...d,
    settings: { ...base.settings, ...(d.settings || {}) },
    days: { ...(d.days || {}) },
    movies: { ...(d.movies || {}) },
  };
}

async function load() {
  // The admin API only exists on the local server; static hosts 404 (or serve HTML).
  try {
    const r = await fetch('api/data', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      state = normalize(await r.json());
      mode = 'admin';
      return;
    }
  } catch {}
  try {
    const r = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) state = normalize(await r.json());
  } catch {}
}

let saveTimer = null;
function save() {
  if (!isAdmin()) return;
  state.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushServer, 250);
}

async function pushServer({ keepalive = false } = {}) {
  saveTimer = null;
  try {
    const r = await fetch('api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      keepalive,
    });
    if (!r.ok) throw new Error();
    setSaveState('Saved');
    refreshPublish();
  } catch {
    setSaveState('Not saved — is the local server running?');
  }
}

function setSaveState(text) {
  const el = $('#saveState');
  el.textContent = text;
  if (text === 'Saved') setTimeout(() => el.textContent === 'Saved' && (el.textContent = ''), 1800);
}

window.addEventListener('pagehide', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    pushServer({ keepalive: true });
  }
});

// ---- Publish (admin): commit + push public/data.json -----------------------
const publishBtn = $('#publishBtn');

async function refreshPublish() {
  if (!isAdmin()) return;
  try {
    const s = await (await fetch('api/publish', { cache: 'no-store' })).json();
    publishBtn.disabled = !s.git || !s.dirty;
    publishBtn.textContent = !s.git ? 'Publish' : s.dirty ? 'Publish changes' : 'Live ✓';
    publishBtn.title = !s.git
      ? 'Set up git + GitHub first (see README)'
      : s.dirty
        ? 'Commit and push your changes to the live site'
        : 'The live site has your latest changes';
  } catch {}
}

publishBtn.addEventListener('click', async () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    await pushServer();
  }
  publishBtn.disabled = true;
  publishBtn.textContent = 'Publishing…';
  try {
    const r = await fetch('api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json();
    toast(j.message || j.error, 5000);
  } catch {
    toast('Publish failed — is the local server running?');
  }
  refreshPublish();
});

// ---- Rendering -----------------------------------------------------------
let filter = 'all';
let didScroll = false;

function renderStats() {
  const t = todayN();
  $('#statToday').textContent =
    t < 1 ? `In ${1 - t} day${t === 0 ? '' : 's'}` : t > TOTAL ? 'Done 🎉' : `Day ${t}/${TOTAL}`;

  let published = 0;
  let pct = 0;
  for (let n = 1; n <= TOTAL; n++) {
    const s = statusOf(state.days[n]?.status);
    if (s.id === 'published') published++;
    pct += s.pct;
  }
  $('#statPublished').textContent = `${published}/${TOTAL}`;
  $('#progressBar').style.width = `${pct / TOTAL}%`;

  // Streak counts back from today; today not being published yet doesn't break it.
  let n = Math.min(t, TOTAL);
  if (n >= 1 && !isPublished(n)) n--;
  let streak = 0;
  while (n >= 1 && isPublished(n)) streak++, n--;
  $('#statStreak').textContent = `${streak} day${streak === 1 ? '' : 's'}`;

  $('#statMovies').textContent = `${Object.keys(state.movies).length}/${TOTAL}`;
}

function renderJourney() {
  const t = todayN();
  const rows = [];
  for (let n = 1; n <= TOTAL; n++) {
    const d = state.days[n] || {};
    const s = statusOf(d.status);
    if (filter === 'done' && s.id !== 'published') continue;
    if (filter === 'open' && s.id === 'published') continue;
    const cls = n === t ? 'is-today' : n > t ? 'is-future' : '';
    // Admin: tap to edit. Public: tap to watch (if there's a video).
    const [open, close] = isAdmin()
      ? [`<button type="button" class="day-btn" data-day="${n}">`, '</button>']
      : d.url
        ? [`<a class="day-btn" href="${esc(d.url)}" target="_blank" rel="noopener">`, '</a>']
        : ['<div class="day-btn static">', '</div>'];
    rows.push(`<li class="${cls}" data-day="${n}">
      ${open}
        <div class="day-num"><span>Day</span><strong>${n}</strong></div>
        <div class="thumb">${d.thumb ? `<img src="${esc(d.thumb)}" alt="" loading="lazy">` : ''}</div>
        <div class="day-main">
          <div class="day-meta">${fmtDate(dateFor(n))}${n === t ? ' · <b>Today</b>' : ''}</div>
          <div class="day-title ${d.title ? '' : 'empty'}">${esc(d.title || 'No video yet')}</div>
          ${d.note ? `<div class="day-note">${esc(d.note)}</div>` : ''}
        </div>
        <div class="day-status st-${s.id}">
          <span class="pill">${s.label}</span>
          <div class="mini-bar"><i style="width:${s.pct}%"></i></div>
        </div>
      ${close}
    </li>`);
  }
  $('#dayList').innerHTML = rows.join('') || '<li class="empty-state">Nothing here yet.</li>';

  if (!didScroll && t >= 1 && t <= TOTAL && filter === 'all') {
    didScroll = true;
    if (t > 3) $(`#dayList li[data-day="${t}"]`)?.scrollIntoView({ block: 'center' });
  }
}

function renderMovies() {
  const t = todayN();
  const cards = [];
  for (let n = 1; n <= TOTAL; n++) {
    const m = state.movies[n];
    const poster = m?.poster
      ? `<img src="${TMDB_IMG}w342${esc(m.poster)}" alt="" loading="lazy">`
      : `<span class="poster-ph ${m ? 'text' : ''}">${m ? esc(m.title) : isAdmin() ? '+' : ''}</span>`;
    const label = `Day ${n}${m ? `: ${esc(m.title)}` : isAdmin() ? ', pick a movie' : ''}`;
    const [open, close] = isAdmin()
      ? [`<button type="button" class="movie-card" data-day="${n}" aria-label="${label}">`, '</button>']
      : m?.tmdbId
        ? [`<a class="movie-card" href="https://www.themoviedb.org/movie/${encodeURIComponent(m.tmdbId)}" target="_blank" rel="noopener" aria-label="${label}">`, '</a>']
        : [`<div class="movie-card static" aria-label="${label}">`, '</div>'];
    cards.push(`<li class="${n === t ? 'is-today' : ''}">
      ${open}
        <div class="poster">${poster}<span class="poster-day">Day ${n}</span></div>
        <div class="movie-meta">${
          m
            ? `<strong>${esc(m.title)}</strong><span>${esc(m.year || '—')}</span>`
            : `<span>${fmtDate(dateFor(n), { month: 'short', day: 'numeric' })}${n === t ? ' · Today' : ''}</span>`
        }</div>
        ${m?.note ? `<p class="movie-note">${esc(m.note)}</p>` : ''}
      ${close}
    </li>`);
  }
  $('#movieGrid').innerHTML = cards.join('');
}

function renderAll() {
  renderStats();
  renderJourney();
  renderMovies();
}

// ---- Tabs & filters ------------------------------------------------------
function showTab(name) {
  if (!['journey', 'movies'].includes(name)) name = 'journey';
  $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $('#tab-journey').hidden = name !== 'journey';
  $('#tab-movies').hidden = name !== 'movies';
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
}

window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
$('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) showTab(b.dataset.tab);
});

function setFilter(f) {
  filter = f;
  $$('#journeyFilter [data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
  renderJourney();
}
$('#journeyFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (b) setFilter(b.dataset.filter);
});

// Generic close buttons and backdrop clicks for all dialogs
$$('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === dlg) dlg.close();
  });
});

// ---- Day editor ----------------------------------------------------------
const dayDialog = $('#dayDialog');
const dayForm = $('#dayForm');
let editingDay = 0;

$('#statusSeg').innerHTML = STATUSES.map(
  (s) => `<label class="st-${s.id}"><input type="radio" name="status" value="${s.id}"><span>${s.label}</span></label>`
).join('');

function updateDayPreview() {
  const id = videoIdFrom(dayForm.url.value);
  const a = $('#dayPreview');
  a.hidden = !id;
  if (id) {
    a.href = `https://youtu.be/${id}`;
    $('img', a).src = ytThumb(id);
  }
}
dayForm.url.addEventListener('input', updateDayPreview);

function openDay(n) {
  editingDay = n;
  const d = state.days[n] || {};
  $('#dayEyebrow').textContent = fmtDate(dateFor(n), { weekday: 'long', month: 'long', day: 'numeric' });
  $('#dayHeading').textContent = `Day ${n}`;
  dayForm.title.value = d.title || '';
  dayForm.url.value = d.url || '';
  dayForm.note.value = d.note || '';
  dayForm.status.value = statusOf(d.status).id;
  updateDayPreview();
  dayDialog.showModal();
}

dayForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const prev = state.days[editingDay] || {};
  const url = dayForm.url.value.trim();
  const videoId = videoIdFrom(url);
  const next = {
    ...prev,
    title: dayForm.title.value.trim(),
    url,
    videoId,
    thumb: videoId ? ytThumb(videoId) : '',
    status: dayForm.status.value || 'todo',
    note: dayForm.note.value.trim(),
    updatedAt: Date.now(),
  };
  if (!next.title && !next.url && !next.note && next.status === 'todo') delete state.days[editingDay];
  else state.days[editingDay] = next;
  save();
  renderStats();
  renderJourney();
  dayDialog.close();
});

$('#dayList').addEventListener('click', (e) => {
  const b = isAdmin() && e.target.closest('button.day-btn');
  if (b) openDay(Number(b.dataset.day));
});

// ---- Movie picker (TMDB) -------------------------------------------------
const movieDialog = $('#movieDialog');
const movieForm = $('#movieForm');
const searchInput = $('#movieSearch');
const resultsEl = $('#movieResults');
let movieDay = 0;
let draftMovie = null;
let lastResults = [];
let searchTimer;
let searchSeq = 0;

async function tmdb(pathname, params = {}) {
  const key = state.settings.tmdbKey.trim();
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  // v4 "read access tokens" are long JWTs; v3 API keys are 32 hex chars.
  if (key.length > 40) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  const r = await fetch(url, { headers });
  if (r.status === 401) throw new Error('TMDB rejected the API key — check it in Settings.');
  if (!r.ok) throw new Error(`TMDB error ${r.status}`);
  return r.json();
}

const yearOf = (m) => (m.release_date || '').slice(0, 4);

function renderPicked() {
  const el = $('#moviePicked');
  el.hidden = !draftMovie;
  $('#movieSearchWrap').hidden = !!draftMovie || !state.settings.tmdbKey;
  if (!draftMovie) return;
  const m = draftMovie;
  el.innerHTML = `
    ${m.poster ? `<img src="${TMDB_IMG}w185${esc(m.poster)}" alt="">` : '<div class="noimg"></div>'}
    <div>
      <h4>${esc(m.title)} ${m.year ? `<span class="muted">(${esc(m.year)})</span>` : ''}</h4>
      ${m.overview ? `<p>${esc(m.overview)}</p>` : ''}
      ${state.settings.tmdbKey ? '<button type="button" class="btn small" id="changeMovie">Change movie</button>' : ''}
    </div>`;
}

$('#moviePicked').addEventListener('click', (e) => {
  if (!e.target.closest('#changeMovie')) return;
  draftMovie = null;
  renderPicked();
  searchInput.focus();
  searchInput.select();
});

function openMovie(n) {
  movieDay = n;
  const m = state.movies[n];
  draftMovie = m ? { ...m } : null;
  $('#movieEyebrow').textContent = `Day ${n} · ${fmtDate(dateFor(n), { weekday: 'short', month: 'short', day: 'numeric' })}`;
  $('#tmdbMissing').hidden = !!state.settings.tmdbKey;
  $('#movieRemove').hidden = !m;
  movieForm.note.value = m?.note || '';
  searchInput.value = '';
  resultsEl.innerHTML = '';
  renderPicked();
  movieDialog.showModal();
  if (!draftMovie && state.settings.tmdbKey) searchInput.focus();
}

async function runSearch() {
  const q = searchInput.value.trim();
  const seq = ++searchSeq;
  if (q.length < 2) {
    resultsEl.innerHTML = '';
    return;
  }
  resultsEl.innerHTML = '<li class="msg">Searching…</li>';
  try {
    const data = await tmdb('/search/movie', { query: q, include_adult: 'false' });
    if (seq !== searchSeq) return;
    lastResults = (data.results || []).slice(0, 12);
    resultsEl.innerHTML = lastResults.length
      ? lastResults
          .map(
            (m, i) => `<li><button type="button" data-i="${i}">
              ${m.poster_path ? `<img src="${TMDB_IMG}w92${esc(m.poster_path)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
              <span><b>${esc(m.title)}</b><small>${esc(yearOf(m) || 'Year unknown')}</small></span>
            </button></li>`
          )
          .join('')
      : '<li class="msg">No movies found.</li>';
  } catch (err) {
    if (seq === searchSeq) resultsEl.innerHTML = `<li class="msg">${esc(err.message)}</li>`;
  }
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 350);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault(); // don't submit the form
    clearTimeout(searchTimer);
    runSearch();
  }
});

resultsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const m = lastResults[Number(b.dataset.i)];
  draftMovie = {
    tmdbId: m.id,
    title: m.title,
    year: yearOf(m),
    poster: m.poster_path || '',
    overview: m.overview || '',
  };
  resultsEl.innerHTML = '';
  renderPicked();
  movieForm.note.focus();
});

movieForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!draftMovie) return toast('Search and pick a movie first.');
  state.movies[movieDay] = { ...draftMovie, note: movieForm.note.value.trim(), updatedAt: Date.now() };
  save();
  renderStats();
  renderMovies();
  movieDialog.close();
});

$('#movieRemove').addEventListener('click', () => {
  delete state.movies[movieDay];
  save();
  renderStats();
  renderMovies();
  movieDialog.close();
  toast(`Removed the movie for Day ${movieDay}.`);
});

$('#movieGrid').addEventListener('click', (e) => {
  const b = isAdmin() && e.target.closest('button.movie-card');
  if (b) openMovie(Number(b.dataset.day));
});

// ---- YouTube playlist sync -----------------------------------------------
async function fetchPlaylistApi(id, key) {
  const out = [];
  let pageToken = '';
  do {
    const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    u.search = new URLSearchParams({
      part: 'snippet,contentDetails',
      maxResults: '50',
      playlistId: id,
      key,
      ...(pageToken ? { pageToken } : {}),
    });
    const r = await fetch(u);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message?.replace(/<[^>]+>/g, '') || `YouTube error ${r.status}`);
    for (const it of j.items || []) {
      const sn = it.snippet || {};
      out.push({
        videoId: it.contentDetails?.videoId || sn.resourceId?.videoId,
        title: sn.title,
        publishedAt: it.contentDetails?.videoPublishedAt || sn.publishedAt,
        position: sn.position,
      });
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken && out.length < 500);
  return out;
}

async function fetchPlaylistFeed(id) {
  let r;
  try {
    r = await fetch(`api/yt-feed?playlist=${encodeURIComponent(id)}`);
  } catch {
    throw new Error('Sync without an API key needs the local server (npm start).');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Feed error ${r.status}`);
  return j.videos || [];
}

function applyVideos(videos, matchBy) {
  const items = videos.filter((v) => v.videoId && !/^(Private|Deleted) video$/.test(v.title || ''));
  const placedAt = new Map(); // videoId -> day it already lives on
  for (let n = 1; n <= TOTAL; n++) if (state.days[n]?.videoId) placedAt.set(state.days[n].videoId, n);

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const assign = (n, v) => {
    const prev = state.days[n] || {};
    const changed = prev.videoId !== v.videoId || prev.title !== v.title || prev.status !== 'published';
    if (!changed) return;
    prev.videoId === v.videoId ? updated++ : added++;
    state.days[n] = {
      ...prev,
      videoId: v.videoId,
      title: v.title,
      url: `https://youtu.be/${v.videoId}`,
      thumb: ytThumb(v.videoId),
      publishedAt: v.publishedAt,
      status: 'published',
      updatedAt: Date.now(),
    };
  };

  if (matchBy === 'order') {
    items.sort((a, b) => a.position - b.position);
    items.forEach((v, i) => (i < TOTAL ? assign(i + 1, v) : skipped++));
  } else {
    items.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
    const taken = new Set();
    for (const v of items) {
      let n = placedAt.get(v.videoId) ?? dayNumberFor(new Date(v.publishedAt));
      if (n < 1 || n > TOTAL) {
        skipped++;
        continue;
      }
      // Two uploads on one day? Push the extra one to the next free day.
      const busy = (d) => taken.has(d) || (state.days[d]?.videoId && state.days[d].videoId !== v.videoId);
      while (n <= TOTAL && busy(n)) n++;
      if (n > TOTAL) {
        skipped++;
        continue;
      }
      taken.add(n);
      assign(n, v);
    }
  }
  return { added, updated, skipped };
}

let syncing = false;
async function syncPlaylist({ quiet = false } = {}) {
  const id = playlistIdFrom(state.settings.playlist);
  if (!id) {
    if (!quiet) {
      toast('Add your playlist link in Settings first.');
      openSettings();
    }
    return;
  }
  if (syncing) return;
  syncing = true;
  const status = $('#syncStatus');
  status.textContent = 'Syncing…';
  $$('#syncBtn, #syncQuick').forEach((b) => (b.disabled = true));
  try {
    const key = state.settings.ytKey.trim();
    const videos = key ? await fetchPlaylistApi(id, key) : await fetchPlaylistFeed(id);
    const matchBy = key ? state.settings.matchBy : 'date'; // the feed has no stable order
    const { added, updated, skipped } = applyVideos(videos, matchBy);
    state.settings.lastSync = Date.now();
    save();
    renderStats();
    renderJourney();
    const parts = [];
    if (added) parts.push(`${added} new`);
    if (updated) parts.push(`${updated} updated`);
    if (skipped) parts.push(`${skipped} outside Day 1–90`);
    const msg = `Synced ${videos.length} video${videos.length === 1 ? '' : 's'}${parts.length ? ` · ${parts.join(', ')}` : ' · up to date'}`;
    status.textContent = msg;
    if (!quiet || added || updated) toast(msg);
  } catch (err) {
    status.textContent = err.message;
    if (!quiet) toast(err.message, 5000);
  } finally {
    syncing = false;
    $$('#syncBtn, #syncQuick').forEach((b) => (b.disabled = false));
  }
}

$('#syncQuick').addEventListener('click', () => syncPlaylist());

// ---- Settings ------------------------------------------------------------
const settingsDialog = $('#settingsDialog');
const settingsForm = $('#settingsForm');

function openSettings() {
  for (const k of ['playlist', 'ytKey', 'matchBy', 'tmdbKey']) settingsForm[k].value = state.settings[k] || '';
  const last = state.settings.lastSync;
  $('#syncStatus').textContent = last ? `Last synced ${new Date(last).toLocaleString()}` : '';
  if (movieDialog.open) movieDialog.close();
  settingsDialog.showModal();
}

function readSettingsForm() {
  const playlist = settingsForm.playlist.value.trim();
  if (playlist && !playlistIdFrom(playlist)) {
    toast("That doesn't look like a playlist link — it should contain “list=”.");
    return false;
  }
  Object.assign(state.settings, {
    playlist,
    ytKey: settingsForm.ytKey.value.trim(),
    matchBy: settingsForm.matchBy.value,
    tmdbKey: settingsForm.tmdbKey.value.trim(),
  });
  save();
  return true;
}

$('#settingsBtn').addEventListener('click', openSettings);
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-settings]')) openSettings();
});

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!readSettingsForm()) return;
  settingsDialog.close();
  toast('Settings saved.');
});

$('#syncBtn').addEventListener('click', () => {
  if (readSettingsForm()) syncPlaylist();
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `90-days-to-2027-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || (!data.days && !data.movies)) throw new Error();
    if (!confirm('Replace all current data with this backup?')) return;
    state = normalize(data);
    save();
    renderAll();
    settingsDialog.close();
    toast('Backup imported.');
  } catch {
    toast("Couldn't read that file — is it a tracker backup?");
  }
});

// ---- Boot ----------------------------------------------------------------
(async function init() {
  await load();
  document.body.classList.toggle('is-admin', isAdmin());
  $('#moviesHint').textContent = isAdmin()
    ? 'One recommendation per day. Tap a day to pick a movie.'
    : 'One movie recommendation for every day of the challenge.';
  const pl = playlistIdFrom(state.settings.playlist);
  if (pl) {
    const a = $('#playlistLink');
    a.href = `https://www.youtube.com/playlist?list=${encodeURIComponent(pl)}`;
    a.hidden = false;
  }
  showTab(location.hash.slice(1));
  setFilter('all');
  renderAll();
  if (isAdmin()) {
    refreshPublish();
    if (state.settings.playlist) syncPlaylist({ quiet: true });
  }

  // Roll "today" over at midnight if the tab stays open.
  let lastDay = todayN();
  setInterval(() => {
    if (todayN() !== lastDay) {
      lastDay = todayN();
      renderAll();
    }
  }, 60000);
})();
