// Pocket Loupe service worker: an offline shell and the last good state, nothing more.
//
// - Navigations: network first (bounded), falling back to the cached shell.
// - Shell files: cache first; a new VERSION brings a new cache.
// - /api/state and /api/theme: network first, falling back to the last good answer,
//   marked with X-From-Cache so the app can say it's showing old data.
// - Everything else under /api/, /ping and /healthz: network only, never cached.
// Bump VERSION whenever any file in public/ changes (tools/check-version.sh enforces it).
const VERSION = 'pl-0.1.1';
const PREFIX = 'pocket-loupe-';
const SHELL_CACHE = PREFIX + 'shell-' + VERSION;
const API_CACHE = PREFIX + 'api-' + VERSION;
const API_MAX_ENTRIES = 4;
const NAV_TIMEOUT_MS = 2500;
const API_TIMEOUT_MS = 3500;

const SHELL = [
  'index.html',
  'app.css',
  'app.js',
  'vendor/palette.js',
  'vendor/format.js',
  'vendor/icons.js',
  'vendor/store.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // No skipWaiting here: the page shows "Update ready" and the person decides (NW-OFF-009).
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name.startsWith(PREFIX) && name !== SHELL_CACHE && name !== API_CACHE)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage(VERSION);
});

/** fetch with a wall-clock timeout, so a sleeping host can't hang the app. */
function fetchWithin(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function navigation(event) {
  try {
    const response = await fetchWithin(event.request, NAV_TIMEOUT_MS);
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put('index.html', copy)));
    }
    return response;
  } catch (error) {
    if (event.request.mode === 'navigate') {
      const shell = await caches.match('index.html');
      if (shell) return shell;
    }
    throw error;
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - API_MAX_ENTRIES)).map((key) => cache.delete(key)));
}

async function lastGood(event, url) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetchWithin(new Request(url, { cache: 'no-store', headers: { Accept: 'application/json' } }), API_TIMEOUT_MS);
    const control = response.headers.get('Cache-Control') || '';
    // Only a good, same-origin answer that allows storing is kept (NW-OFF-005, NW-OFF-013).
    if (response.ok && response.type === 'basic' && !/no-store|private/i.test(control)) {
      const copy = response.clone();
      event.waitUntil(cache.put(url, copy).then(() => trim(cache)));
    }
    return response;
  } catch (error) {
    const hit = await cache.match(url);
    if (!hit) throw error;
    const headers = new Headers(hit.headers);
    headers.set('X-From-Cache', 'stale');
    return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/ping' || url.pathname === '/healthz' || url.pathname === '/api/events') return;
  if (request.mode === 'navigate') {
    event.respondWith(navigation(event));
    return;
  }
  if (url.pathname === '/api/state' || url.pathname === '/api/theme') {
    event.respondWith(lastGood(event, url.origin + url.pathname));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetchWithin(request, API_TIMEOUT_MS)));
});
