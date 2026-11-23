const V = 'cap-v5';
const ASSETS = ['./', 'index.html', 'manifest.webmanifest', 'style.css', 'display.woff2', 'text.woff2',
  'app.js', 'model.js', 'engine.js', 'store.js', 'views.js', 'sheets.js', 'ui.js', 'charts.js', 'chat.js', 'csv.js', 'net.js', 'revpoints.js',
  'icon-192.png', 'icon-512.png', 'maskable-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
// Stale-while-revalidate pour les fichiers de l'appli ; le réseau (CoinGecko, Gemini) passe tel quel.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(V).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
self.addEventListener('notificationclick', (e) => { e.notification.close(); e.waitUntil(clients.openWindow('./')); });
