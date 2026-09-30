// CerGeMA service worker: offline shell for public pages; never caches admin or API.
const CACHE = 'cergema-v1';
const SHELL = ['/', '/claim', '/static/icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/admin') || u.pathname.startsWith('/api') || u.pathname.startsWith('/pay') || u.pathname.startsWith('/certificate')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (u.pathname === '/' || u.pathname.startsWith('/static') || u.pathname.startsWith('/pass'))) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('/'))));
});
