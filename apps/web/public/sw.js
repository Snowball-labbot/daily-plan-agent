const CACHE = 'daily-plan-shell-v1';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html','/icon.svg','/mobile.css']))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('daily-plan-shell-') && key !== CACHE).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache credentials or server responses containing personal records.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate' && url.pathname === '/') event.respondWith(caches.open(CACHE).then(async cache => {
    try { const response = await fetch(event.request); if (response.ok) await cache.put('/', response.clone()); return response; }
    catch { return await cache.match('/') || await cache.match('/offline.html'); }
  }));
  else if(url.pathname==='/mobile.css') event.respondWith(caches.open(CACHE).then(async cache=> {try {const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response}catch{return cache.match(event.request)}}));
  else if (url.pathname.startsWith('/_next/static/')) event.respondWith(caches.open(CACHE).then(async cache => { const hit = await cache.match(event.request); if (hit) return hit; const response = await fetch(event.request); if (response.ok) await cache.put(event.request, response.clone()); return response; }));
});
