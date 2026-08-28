/* Service worker: makes the Time Tracker installable and fully offline.
 *
 * Strategy:
 *  - App shell (html/css/js/lib/icons/manifest) is precached on install and
 *    served cache-first, so the app opens with no connection.
 *  - Bump CACHE_VERSION whenever any shell file changes; the old cache is
 *    dropped on activate and clients pick up the new files on next load.
 *
 * User data never touches the service worker - it lives in localStorage.
 */
var CACHE_VERSION = "tt-v1";
var SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./vendor/exceljs.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  // Navigation requests: serve the cached app shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match("./index.html", { ignoreSearch: true });
      })
    );
    return;
  }

  if (!sameOrigin) return; // let cross-origin requests pass straight through

  // Same-origin assets: cache-first, fall back to network, then cache the result.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(req).then(function (resp) {
        if (resp && resp.status === 200 && resp.type === "basic") {
          var copy = resp.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return resp;
      });
    })
  );
});
