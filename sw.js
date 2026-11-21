// Guarda la aplicación en el móvil para que funcione también sin cobertura.
// Primero se usa siempre lo guardado (abre al instante, con o sin datos) y en segundo plano
// se descarga la versión más reciente. El aviso de «versión nueva» de la app indica cuándo actualizar.
const V = 'partes-v14';
const FICHEROS = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png',
  'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/pdf-lib.min.js', 'lib/parse.js', 'lib/hots.js', 'lib/fill.js',
  'templates/inter.pdf', 'templates/generali.pdf', 'templates/iris.pdf', 'templates/parte.pdf'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(FICHEROS.map(f => c.add(new Request(f, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) return; // el aviso de versión nueva siempre va a la red
  e.respondWith((async () => {
    const cache = await caches.open(V);
    let guardado = await cache.match(req, { ignoreSearch: true });
    if (!guardado && req.mode === 'navigate') guardado = await cache.match('index.html') || await cache.match('./');
    const red = fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; });
    if (guardado) { red.catch(() => { }); return guardado; }   // hay copia: se usa ya, sin esperar a la red
    return red;                                                // sin copia: se pide a la red
  })());
});
