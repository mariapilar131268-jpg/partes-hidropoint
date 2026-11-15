// Guarda la aplicación en el móvil para que funcione también sin cobertura.
const V = 'partes-v4';
const FICHEROS = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png',
  'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/pdf-lib.min.js', 'lib/parse.js', 'lib/hots.js', 'lib/fill.js',
  'templates/inter.pdf', 'templates/generali.pdf', 'templates/iris.pdf', 'templates/parte.pdf'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FICHEROS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Primero la red (para recibir mejoras); si no hay cobertura, lo guardado.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(ch => ch.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
