/**
 * Service Worker —— 让 JADEVEIL 可以安装到桌面 / 主屏幕，并在离线时继续游玩。
 *
 * 策略：网络优先，失败回退缓存。
 *   · 在线时永远拿最新文件（游戏由几十个 ES 模块组成，混用新旧版本会直接崩），
 *     同时把成功的响应写进缓存
 *   · 离线时用最后一次成功的缓存；导航请求统一回退到首页
 *   · 只缓存同源、成功（200 / basic）的 GET；重定向（例如 Zero Trust 登录跳转）、
 *     跨域与错误响应一律不缓存
 *
 * 首次安装时预缓存页面骨架与图标；其余模块、贴图、音效在第一次游玩时自然进入缓存。
 * 改策略或缓存结构时把 CACHE 的版本号加一，activate 会清掉旧缓存。
 */
const CACHE = "jadeveil-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => { /* 预缓存失败不阻止安装（例如首次访问被登录页拦截） */ })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("jadeveil-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
      if (cached) return cached;
      if (req.mode === "navigate") {
        const shell = await caches.match("/index.html") || await caches.match("/");
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
