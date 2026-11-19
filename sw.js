//Curios Lang sa part na this HAHAHA
const CACHE_NAME = "emergency-card-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/login.html",
  "/register.html",
  "/dashboard.html",
  "/emergency-card.html",
  "/emergency-mode.html",
  "/contacts.html",
  "/medical-info.html",
  "/personal-info.html",
  "/qr.html",
  "/settings.html",
  "/share.html",
  "/css/style.css",
  "/js/script.js",
  "/js/firebase-config.js",
  "/js/qrcode.min.js",
  "/manifest.json",
  "/assets/icon-192.png",
  "/assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
