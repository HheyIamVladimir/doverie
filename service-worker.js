// === ДОВЕРИЕ — SERVICE WORKER v1 ===
const STATIC_CACHE = 'doverie-static-v1';
const API_CACHE    = 'doverie-api-v1';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.svg', '/icon-512.svg'];

// ── INSTALL ──────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(c => c.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(
        ks.filter(k => k !== STATIC_CACHE && k !== API_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Статика HTML — сеть, при оффлайн кэш
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname.endsWith('.html'))) {
    e.respondWith(
      fetch(request).then(res => {
        caches.open(STATIC_CACHE).then(c => c.put(request, res.clone()));
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // API GET (чаты, сообщения) — stale-while-revalidate
  if (request.method === 'GET' && isApiCacheable(url.pathname)) {
    e.respondWith(
      caches.open(API_CACHE).then(async cache => {
        const cached = await cache.match(request);
        const fresh = fetch(request).then(res => {
          cache.put(request, res.clone());
          return res;
        }).catch(() => null);
        return cached || fresh || emptyJson(url.pathname);
      })
    );
    return;
  }

  // POST сообщений — пробуем отправить; при оффлайн → в очередь
  if (request.method === 'POST' && isMsgEndpoint(url.pathname)) {
    e.respondWith(
      fetch(request.clone()).catch(async () => {
        const body = await request.clone().json().catch(() => ({}));
        await outboxAdd({ url: url.pathname, body });
        if (self.registration.sync) {
          self.registration.sync.register('flush-outbox').catch(() => {});
        }
        return new Response(JSON.stringify({ success: false, queued: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
});

function isApiCacheable(p) {
  return p.startsWith('/api/chats/')     ||
         p.startsWith('/api/messages/')  ||
         p.startsWith('/api/group-messages/') ||
         p.startsWith('/api/groups/')    ||
         p.startsWith('/api/channels/') ||
         p.startsWith('/api/feed');
}
function isMsgEndpoint(p) {
  return p === '/api/messages' || p === '/api/group-messages';
}
function emptyJson(p) {
  return new Response(JSON.stringify(p.includes('message') ? [] : {}), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ── BACKGROUND SYNC ──────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'flush-outbox') e.waitUntil(outboxFlush());
});

// ── IndexedDB outbox ─────────────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('doverie-outbox', 1);
    r.onupgradeneeded = ev =>
      ev.target.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = ev => res(ev.target.result);
    r.onerror = () => rej(r.error);
  });
}
async function outboxAdd(item) {
  try {
    const db = await openDB();
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').add({ ...item, ts: Date.now() });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(e) {}
}
async function outboxFlush() {
  try {
    const db = await openDB();
    const tx = db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    const items = await new Promise((res, rej) => {
      const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = rej;
    });
    for (const item of items) {
      try {
        const r = await fetch(item.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.body)
        });
        if (r.ok) {
          store.delete(item.id);
          const cls = await self.clients.matchAll();
          cls.forEach(c => c.postMessage({ type: 'MSG_SENT', item }));
        }
      } catch(e) {}
    }
  } catch(e) {}
}

// ── PUSH ─────────────────────────────────────────────────
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || 'Доверие', {
    body: d.body || 'Новое сообщение',
    icon: '/icon-192.svg',
    vibrate: [200, 100, 200],
    data: { url: '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
