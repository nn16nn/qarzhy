/* Qarzhy енді басты мекенжайда — бұл ескі /next/ жұмысшысы өзін өшіреді */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.registration.unregister().then(() => self.clients.matchAll()).then(cs => cs.forEach(c => c.navigate('../')))));
