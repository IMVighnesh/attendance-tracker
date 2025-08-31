// This is the service worker file. It's the key to making your app work offline.

const CACHE_NAME = "attendance-tracker-v1";
// This is the "app shell" - the minimal files needed for the app to run.
const urlsToCache = [
	"/",
	"/index.html",
	"/style.css",
	"/script.js",
	"/manifest.json",
	"/icons/icon-192x192.png",
	"/icons/icon-512x512.png",
	"https://cdn.tailwindcss.com",
	"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
];

// 1. Installation: Open the cache and add the core files to it.
self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			console.log("Opened cache");
			return cache.addAll(urlsToCache);
		})
	);
});

// 2. Fetch: Intercept network requests.
self.addEventListener("fetch", (event) => {
	event.respondWith(
		// Try to find the request in the cache first.
		caches.match(event.request).then((response) => {
			// If it's in the cache, return it.
			if (response) {
				return response;
			}
			// If it's not in the cache, fetch it from the network.
			return fetch(event.request);
		})
	);
});

// 3. Activation: Clean up old caches.
self.addEventListener("activate", (event) => {
	const cacheWhitelist = [CACHE_NAME];
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames.map((cacheName) => {
					if (cacheWhitelist.indexOf(cacheName) === -1) {
						return caches.delete(cacheName);
					}
				})
			);
		})
	);
});
