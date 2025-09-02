// MindChat Service Worker - Optimized for low-bandwidth environments
// Version 1.0.0

const CACHE_NAME = 'mindchat-v1.0.0';
const STATIC_CACHE = 'mindchat-static-v1';
const DYNAMIC_CACHE = 'mindchat-dynamic-v1';
const AUDIO_CACHE = 'mindchat-audio-v1';

// Critical assets for offline functionality
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Audio files for CBT sessions (compressed for low bandwidth)
const AUDIO_ASSETS = [
  '/audio/breathing-basics-64k.mp3',
  '/audio/thought-challenging-64k.mp3',
  '/audio/sleep-preparation-64k.mp3',
  '/audio/anxiety-relief-64k.mp3',
  '/audio/crisis-calm-64k.mp3'
];

// API endpoints to cache
const API_ENDPOINTS = [
  '/api/mood-data',
  '/api/session-progress',
  '/api/peer-rooms',
  '/api/crisis-hotlines'
];

// Install event - cache critical assets
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker: Installing...');
  
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(STATIC_CACHE).then((cache) => {
        console.log('📦 Caching static assets...');
        return cache.addAll(STATIC_ASSETS);
      }),
      
      // Pre-cache one essential audio file for offline use
      caches.open(AUDIO_CACHE).then((cache) => {
        console.log('🎧 Pre-caching essential audio...');
        return cache.add('/audio/breathing-basics-64k.mp3');
      })
    ]).then(() => {
      console.log('✅ Service Worker: Installation complete');
      // Force activation of new service worker
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old cache versions
          if (cacheName !== STATIC_CACHE && 
              cacheName !== DYNAMIC_CACHE && 
              cacheName !== AUDIO_CACHE) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker: Activation complete');
      return self.clients.claim();
    })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Handle different types of requests with appropriate strategies
  if (request.method === 'GET') {
    event.respondWith(handleGetRequest(request, url));
  } else if (request.method === 'POST') {
    event.respondWith(handlePostRequest(request, url));
  }
});

// GET request handler with caching strategies
async function handleGetRequest(request, url) {
  try {
    // Strategy 1: Cache First for static assets
    if (STATIC_ASSETS.some(asset => url.pathname.endsWith(asset))) {
      return await cacheFirstStrategy(request, STATIC_CACHE);
    }
    
    // Strategy 2: Cache First for audio files
    if (url.pathname.includes('/audio/')) {
      return await cacheFirstStrategy(request, AUDIO_CACHE);
    }
    
    // Strategy 3: Network First for API calls
    if (url.pathname.startsWith('/api/')) {
      return await networkFirstStrategy(request, DYNAMIC_CACHE);
    }
    
    // Strategy 4: Stale While Revalidate for dynamic content
    return await staleWhileRevalidateStrategy(request, DYNAMIC_CACHE);
    
  } catch (error) {
    console.error('❌ Fetch error:', error);
    return await getFallbackResponse(request);
  }
}

// POST request handler for offline data sync
async function handlePostRequest(request, url) {
  try {
    // Try network first
    const response = await fetch(request);
    return response;
  } catch (error) {
    // If offline, store for background sync
    if (url.pathname.startsWith('/api/')) {
      await storeForBackgroundSync(request);
      return new Response(JSON.stringify({ 
        success: true, 
        offline: true,
        message: 'Data queued for sync when online' 
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      });
    }
    throw error;
  }
}

// Caching Strategy 1: Cache First (for static assets)
async function cacheFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    console.log('📦 Serving from cache:', request.url);
    return cachedResponse;
  }
  
  const networkResponse = await fetch(request);
  await cache.put(request, networkResponse.clone());
  console.log('🌐 Cached from network:', request.url);
  return networkResponse;
}

// Caching Strategy 2: Network First (for API calls)
async function networkFirstStrategy(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    const cache = await caches.open(cacheName);
    await cache.put(request, networkResponse.clone());
    console.log('🌐 Fresh from network:', request.url);
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('📦 Fallback to cache:', request.url);
      return cachedResponse;
    }
    
    throw error;
  }
}

// Caching Strategy 3: Stale While Revalidate (for dynamic content)
async function staleWhileRevalidateStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  // Fetch from network in background
  const networkResponsePromise = fetch(request).then(async (networkResponse) => {
    await cache.put(request, networkResponse.clone());
    return networkResponse;
  }).catch(() => null);
  
  // Return cached version immediately if available
  if (cachedResponse) {
    console.log('📦 Serving stale cache:', request.url);
    return cachedResponse;
  }
  
  // Wait for network if no cache available
  const networkResponse = await networkResponsePromise;
  if (networkResponse) {
    console.log('🌐 Fresh from network:', request.url);
    return networkResponse;
  }
  
  throw new Error('No cached response and network unavailable');
}

// Fallback responses for offline scenarios
async function getFallbackResponse(request) {
  const url = new URL(request.url);
  
  // Fallback for HTML pages
  if (request.headers.get('Accept')?.includes('text/html')) {
    const cache = await caches.open(STATIC_CACHE);
    return await cache.match('/') || new Response('Offline - Please check your connection', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
  
  // Fallback for API calls
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({
      error: 'Offline',
      message: 'This feature requires internet connection',
      offline: true
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Fallback for images
  if (request.headers.get('Accept')?.includes('image/')) {
    // Return a simple SVG placeholder
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="#f0f0f0"/>
      <text x="100" y="100" text-anchor="middle" fill="#666" font-size="14">Offline</text>
    </svg>`;
    
    return new Response(svg, {
      headers: { 'Content-Type': 'image/svg+xml' }
    });
  }
  
  return new Response('Resource unavailable offline', { status: 503 });
}

// Background sync for offline data
async function storeForBackgroundSync(request) {
  try {
    const requestData = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: await request.text(),
      timestamp: Date.now()
    };
    
    // Store in IndexedDB for background sync
    const db = await openIndexedDB();
    const transaction = db.transaction(['pending_requests'], 'readwrite');
    const store = transaction.objectStore('pending_requests');
    await store.add(requestData);
    
    console.log('💾 Stored request for background sync:', request.url);
  } catch (error) {
    console.error('❌ Failed to store for background sync:', error);
  }
}

// IndexedDB helper functions
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MindChatDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create stores
      if (!db.objectStoreNames.contains('pending_requests')) {
        const store = db.createObjectStore('pending_requests', { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      if (!db.objectStoreNames.contains('mood_data')) {
        const moodStore = db.createObjectStore('mood_data', { 
          keyPath: 'date' 
        });
      }
      
      if (!db.objectStoreNames.contains('session_progress')) {
        const sessionStore = db.createObjectStore('session_progress', { 
          keyPath: 'sessionId' 
        });
      }
    };
  });
}

// Background sync event handler
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-pending-requests') {
    event.waitUntil(syncPendingRequests());
  } else if (event.tag === 'sync-mood-data') {
    event.waitUntil(syncMoodData());
  } else if (event.tag === 'sync-session-progress') {
    event.waitUntil(syncSessionProgress());
  }
});

// Sync pending requests when back online
async function syncPendingRequests() {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(['pending_requests'], 'readonly');
    const store = transaction.objectStore('pending_requests');
    const requests = await getAllFromStore(store);
    
    for (const requestData of requests) {
      try {
        const response = await fetch(requestData.url, {
          method: requestData.method,
          headers: requestData.headers,
          body: requestData.body
        });
        
        if (response.ok) {
          // Remove successfully synced request
          const deleteTransaction = db.transaction(['pending_requests'], 'readwrite');
          const deleteStore = deleteTransaction.objectStore('pending_requests');
          await deleteStore.delete(requestData.id);
          
          console.log('✅ Synced request:', requestData.url);
        }
      } catch (error) {
        console.error('❌ Failed to sync request:', requestData.url, error);
      }
    }
  } catch (error) {
    console.error('❌ Background sync failed:', error);
  }
}

// Sync mood data
async function syncMoodData() {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(['mood_data'], 'readonly');
    const store = transaction.objectStore('mood_data');
    const moodData = await getAllFromStore(store);
    
    if (moodData.length > 0) {
      const response = await fetch('/api/sync-mood', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(moodData)
      });
      
      if (response.ok) {
        // Clear synced data
        const clearTransaction = db.transaction(['mood_data'], 'readwrite');
        const clearStore = clearTransaction.objectStore('mood_data');
        await clearStore.clear();
        
        console.log('✅ Mood data synced successfully');
      }
    }
  } catch (error) {
    console.error('❌ Mood data sync failed:', error);
  }
}

// Sync session progress
async function syncSessionProgress() {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(['session_progress'], 'readonly');
    const store = transaction.objectStore('session_progress');
    const progressData = await getAllFromStore(store);
    
    if (progressData.length > 0) {
      const response = await fetch('/api/sync-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(progressData)
      });
      
      if (response.ok) {
        // Clear synced data
        const clearTransaction = db.transaction(['session_progress'], 'readwrite');
        const clearStore = clearTransaction.objectStore('session_progress');
        await clearStore.clear();
        
        console.log('✅ Session progress synced successfully');
      }
    }
  } catch (error) {
    console.error('❌ Session progress sync failed:', error);
  }
}

// Helper function to get all records from IndexedDB store
function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Push notification handler for crisis alerts
self.addEventListener('push', (event) => {
  console.log('🔔 Push notification received');
  
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      tag: data.tag || 'mindchat-notification',
      requireInteraction: data.urgent || false,
      actions: data.actions || [],
      data: data.data || {}
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('🔔 Notification clicked:', event.notification.tag);
  
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if app is already open
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Open new window if app not already open
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Periodic background sync for critical data
self.addEventListener('periodicsync', (event) => {
  console.log('⏰ Periodic sync triggered:', event.tag);
  
  if (event.tag === 'crisis-check') {
    event.waitUntil(checkCrisisSupport());
  } else if (event.tag === 'mood-reminder') {
    event.waitUntil(sendMoodReminder());
  }
});

// Crisis support check
async function checkCrisisSupport() {
  try {
    // Check if user needs immediate support based on recent mood data
    const db = await openIndexedDB();
    const transaction = db.transaction(['mood_data'], 'readonly');
    const store = transaction.objectStore('mood_data');
    const recentMoods = await getAllFromStore(store);
    
    // Filter last 3 days of mood data
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const recentLowMoods = recentMoods.filter(mood => 
      new Date(mood.date) >= threeDaysAgo && mood.value <= 2
    );
    
    // If 3+ low moods in recent days, send supportive notification
    if (recentLowMoods.length >= 3) {
      await self.registration.showNotification('MindChat Support', {
        body: 'We noticed you might be going through a tough time. Remember, support is available.',
        icon: '/icons/icon-192x192.png',
        tag: 'crisis-support',
        requireInteraction: true,
        actions: [
          {
            action: 'crisis-support',
            title: 'Get Support'
          },
          {
            action: 'dismiss',
            title: 'Not Now'
          }
        ],
        data: { url: '/?section=crisis' }
      });
    }
  } catch (error) {
    console.error('❌ Crisis check failed:', error);
  }
}

// Send mood reminder
async function sendMoodReminder() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const moodToday = localStorage.getItem(`mood_${today}`);
    
    if (!moodToday) {
      await self.registration.showNotification('MindChat Reminder', {
        body: 'How are you feeling today? Take a moment to check in with yourself.',
        icon: '/icons/icon-192x192.png',
        tag: 'mood-reminder',
        actions: [
          {
            action: 'mood-checkin',
            title: 'Check In'
          }
        ],
        data: { url: '/?section=home' }
      });
    }
  } catch (error) {
    console.error('❌ Mood reminder failed:', error);
  }
}

// Message handler for communication with main app
self.addEventListener('message', (event) => {
  console.log('💬 Message received:', event.data);
  
  if (event.data && event.data.type) {
    switch (event.data.type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
      case 'CACHE_AUDIO':
        cacheAudioFile(event.data.url);
        break;
      case 'CLEAR_CACHE':
        clearAllCaches();
        break;
      case 'SYNC_NOW':
        triggerSync(event.data.tag);
        break;
      default:
        console.log('❓ Unknown message type:', event.data.type);
    }
  }
});

// Cache audio file on demand
async function cacheAudioFile(url) {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    await cache.add(url);
    console.log('🎧 Audio cached:', url);
  } catch (error) {
    console.error('❌ Audio caching failed:', error);
  }
}

// Clear all caches
async function clearAllCaches() {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
    console.log('🗑️ All caches cleared');
  } catch (error) {
    console.error('❌ Cache clearing failed:', error);
  }
}

// Trigger background sync
async function triggerSync(tag) {
  try {
    await self.registration.sync.register(tag);
    console.log('🔄 Background sync registered:', tag);
  } catch (error) {
    console.error('❌ Background sync registration failed:', error);
  }
}

// Error handler
self.addEventListener('error', (event) => {
  console.error('❌ Service Worker error:', event.error);
});

// Unhandled rejection handler
self.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled promise rejection:', event.reason);
});

console.log('🧠 MindChat Service Worker loaded successfully');