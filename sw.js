// خدمة بسيطة للعمل بدون إنترنت: الشبكة أولًا، وإن فشلت نستخدم النسخة المخزّنة.
const CACHE = 'kalimati-v1';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg', 'css/style.css',
  'js/util.js', 'js/data.js', 'js/sfx.js', 'js/speech.js', 'js/store.js',
  'js/games.js', 'js/views.js', 'js/teacher.js', 'js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
