// Cache version should be updated when content changes
// This line will be replaced during build with git hash and timestamp
const CACHE_VERSION = 'dev';
const CACHE_NAME = `capture-${CACHE_VERSION}`;
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/src/app.js',
  '/manifest.json',
  '/icons/apple-touch-icon.png',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  '/splash/apple-splash-2048-2732.png',
  '/splash/apple-splash-1668-2388.png',
  '/splash/apple-splash-1536-2048.png',
  '/splash/apple-splash-1125-2436.png',
  '/splash/apple-splash-828-1792.png'
];

// Check if we're in development mode
const isDev = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// Helper to check if a response should be cached
const shouldCache = (response) => {
  // Only cache successful responses
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return false;
  }

  // Check cache control headers
  const cacheControl = response.headers.get('Cache-Control');
  if (cacheControl) {
    // Don't cache if explicitly told not to
    if (cacheControl.includes('no-store') || cacheControl.includes('no-cache')) {
      return false;
    }
  }

  return true;
};

// Helper to check if a cached response is stale
const isStale = (cachedResponse) => {
  if (!cachedResponse) return true;

  // Check if the cached response has expired
  const cacheControl = cachedResponse.headers.get('Cache-Control');
  if (cacheControl) {
    const maxAge = parseInt(cacheControl.match(/max-age=(\d+)/)?.[1]);
    if (maxAge) {
      const dateHeader = cachedResponse.headers.get('date');
      if (dateHeader) {
        const cacheDate = new Date(dateHeader).getTime();
        const now = new Date().getTime();
        return (now - cacheDate) > (maxAge * 1000);
      }
    }
  }

  // If no cache control headers, consider it stale
  // This will make the service worker always fetch a fresh copy
  return true;
};

// Install event - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Only cache assets in production
        if (!isDev) {
          // Fetch and cache with proper headers
          return Promise.all(
            ASSETS_TO_CACHE.map(url => 
              fetch(url).then(response => {
                if (shouldCache(response)) {
                  return cache.put(url, response);
                }
              })
            )
          );
        }
        return Promise.resolve();
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('capture-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, falling back to network
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Handle WebSocket connections differently
  if (event.request.url.includes('/ws/')) {
    return;
  }

  // In development mode, always go to network first
  if (isDev) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // In production, use stale-while-revalidate strategy
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then(response => {
          // Cache new response if appropriate
          if (shouldCache(response)) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
          }
          return response;
        }).catch(() => {
          // If network fails and we have a cached response, use it
          if (cachedResponse) {
            return cachedResponse;
          }
          throw new Error('No cached response available');
        });

        // If we have a cached response that isn't stale, use it
        if (cachedResponse && !isStale(cachedResponse)) {
          return cachedResponse;
        }

        // Otherwise wait for the network response
        return fetchPromise;
      })
  );
}); 