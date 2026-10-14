/* Service Worker mínimo (Spec 008): la app instalada abre al instante y
   tolera cortes de red. Solo actúa servido por http(s); con doble clic
   (file://) el navegador lo ignora. Al cambiar CSS/JS, subir CACHE_NOMBRE. */
const CACHE_NOMBRE = "proyeccion-qxp-v7";
const LOCALES = [
  "./", "./index.html", "./styles.css", "./app.js",
  "./manifest.webmanifest",
  "./data/catalogo.js", "./data/proyeccion.js", "./data/clusters.js",
  "./data/provincias_geo.js", "./data/analitico.js",
  "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NOMBRE).then(c => c.addAll(LOCALES))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE_NOMBRE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => {
        const copia = res.clone();
        caches.open(CACHE_NOMBRE).then(c => c.put(e.request, copia));
        return res;
      }).catch(() => caches.match("./index.html")))
  );
});
