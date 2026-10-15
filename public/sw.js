/* МЁРТВЫЙ ГОРОД — устойчивый офлайн-кэш PWA */
const CACHE = 'mertvy-gorod-v3-bootfix';
const SCOPE_URL = (path) => new URL(path, self.registration.scope).href;
const PRECACHE = [SCOPE_URL('./'), SCOPE_URL('index.html'), SCOPE_URL('manifest.json')];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) =>
        cache.add(url).catch((error) => console.warn('Не удалось добавить в кэш:', url, error))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // HTML and executable assets are network-first so a deployment cannot get
  // stuck on an older cached boot script. Fall back to the current cache offline.
  const isBootAsset = request.mode === 'navigate' || /\.(?:js|mjs|css|html)$/.test(url.pathname);
  if (isBootAsset) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response && response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch (error) {
        const cache = await caches.open(CACHE);
        return (await cache.match(request)) || (request.mode === 'navigate' ? await cache.match(SCOPE_URL('index.html')) : null) ||
          new Response('Нет подключения и сохранённой версии игры. Откройте игру онлайн и обновите страницу.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch (error) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
