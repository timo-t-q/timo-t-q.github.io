/* ============================================================================
   WARRIORS — sw.js (service worker)

   Robí z portálu appku v telefóne a prijíma push upozornenia.
   Musí ležať v tom istom priečinku ako index.html (na webe /dresy/),
   inak by nemal právomoc nad stránkou.

   ZÁMERNE nič necachuje. Appka sa aktualizuje nahratím index.html cez FTP
   a service worker s cache by ľuďom držal starú verziu — to by bol
   najhorší možný druh chyby: „u mňa to funguje, u nich nie".
   ============================================================================ */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/* Push prichádza PRÁZDNY — mená detí nechodia cez servery Googlu.
   Čo presne čaká, uvidí admin až v appke, keď sa prihlási. */
self.addEventListener('push', (e) => {
  e.waitUntil(self.registration.showNotification('Nová žiadosť o prístup', {
    body: 'Rodič čaká na schválenie. Ťuknite a otvorte žiadosti.',
    icon: 'ikony/ikona-192.png',
    badge: 'ikony/odznak-96.png',
    tag: 'nova-ziadost',     // tri žiadosti = jedna notifikácia, nie tri
    renotify: true,          // …ale pri každej novej telefón znova zapípa
    data: { url: './?ziadosti' },
  }));
});

/* Ťuknutie na notifikáciu: ak je appka už otvorená, prepne sa do nej
   a obnoví žiadosti; inak sa otvorí rovno na nich. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ciel = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;

  e.waitUntil((async () => {
    const okna = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const okno of okna) {
      if (okno.url.startsWith(self.registration.scope) && 'focus' in okno) {
        okno.postMessage({ typ: 'ziadosti' });
        return okno.focus();
      }
    }
    return self.clients.openWindow(ciel);
  })());
});
