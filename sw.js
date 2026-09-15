"use strict";

const CACHE_NAME = "clean-planner-v11.2.4-app-icon-only-r1";
const APP_SHELL = [
  "./assets/money-favicon-16-v1123.png",
  "./assets/money-favicon-32-v1123.png",
  "./assets/money-apple-touch-180-v1123.png",
  "./assets/money-app-icon-maskable-512-v1123.png",
  "./assets/money-app-icon-512-v1123.png",
  "./assets/money-app-icon-192-v1123.png",
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/icon-512-maskable.png",
  "./assets/apple-touch-icon-180.png",
  "./assets/favicon-32.png",
  "./assets/favicon-16.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("clean-planner-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          const cacheKey = event.request.mode === "navigate" ? "./index.html" : event.request;
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
  );
});
