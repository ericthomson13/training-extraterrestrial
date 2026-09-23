/* Offline cache. Network first (2.5 s) so program updates arrive; cached copy when the gym has no signal. */
const CACHE = "ssl-v1";
const FILES = ["./", "index.html", "app.js", "program.js", "sync.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    // fonts: cache after first load
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; }).catch(() => hit)));
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const timeout = new Promise(r => setTimeout(r, 2500));
    try {
      const res = await Promise.race([fetch(req), timeout.then(() => { throw new Error("slow"); })]);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      return fetch(req);
    }
  })());
});
