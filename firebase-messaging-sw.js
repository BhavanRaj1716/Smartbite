// ═══════════════════════════════════════════════════════════════════
//  SmartBite — Firebase Messaging Service Worker
//  This file MUST be at the root of your project.
//  It handles background push notifications when the app is closed.
// ═══════════════════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyDxHZJ1BX4alB8LLbT9kskyqm-jKVFipUo",
  authDomain:        "smart-canteen-e44e9.firebaseapp.com",
  projectId:         "smart-canteen-e44e9",
  storageBucket:     "smart-canteen-e44e9.firebasestorage.app",
  messagingSenderId: "509602872969",
  appId:             "1:509602872969:web:c30a4eb11a448b9084d058"
});

const messaging = firebase.messaging();

// Handle background messages (when app/tab is NOT in focus)
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload);

  const title = payload.notification?.title || 'SmartBite Update 🍔';
  const body  = payload.notification?.body  || 'Your order status has changed.';

  self.registration.showNotification(title, {
    body,
    icon:      'https://via.placeholder.com/192x192/FF4500/ffffff?text=SB',
    badge:     'https://via.placeholder.com/96x96/FF4500/ffffff?text=SB',
    tag:       'smartbite-order',
    renotify:  true,
    vibrate:   [200, 100, 200],
    data:      payload.data || {}
  });
});

// Open the app when notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/index.html');
      }
    })
  );
});
