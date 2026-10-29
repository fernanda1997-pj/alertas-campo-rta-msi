// Service Worker: deixa o app abrir sem sinal nenhum (guarda uma cópia do
// HTML/CSS/JS no celular). Mesma estratégia do Fotos de Campo:
// - arquivos do próprio site: network-first (quem tem sinal sempre pega a
//   versão nova a cada deploy, sem precisar trocar o nome do cache);
// - bibliotecas da CDN (versão presa na URL): cache-first;
// - api/ (alertas e fotos no SharePoint) e qualquer outra origem (tiles do
//   mapa): nunca interceptar. Já houve bug no Fotos de Campo por guardar
//   resposta de dados em cache — a lista nunca mais atualizava.
const CACHE_ESTATICO = "alertas-campo-static-v7";
const CDN_HOSTNAME = "cdn.jsdelivr.net";

const ARQUIVOS_APP = [
  "./",
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/api.js",
  "js/trechos-geo.js",
  "js/sre-km.js",
  "js/modelo-ficha.js",
  "js/dados.js",
  "js/geo.js",
  "js/foto.js",
  "js/fila.js",
  "js/alerta.js",
  "js/camera.js",
  "js/ficha.js",
  "js/ficha-xlsx.js",
  "js/painel.js",
  "js/app.js",
  "js/registrar-sw.js",
  "logo/LOGO RTA.png",
  "logo/LOGO MSI.jpeg",
  "logo/favicon.png",
  "icons/rta-msi-180.png",
  "icons/rta-msi-192.png",
  "icons/rta-msi-512.png"
];

const ARQUIVOS_CDN = [
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
  "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
];

self.addEventListener("install", (evento) => {
  self.skipWaiting();
  evento.waitUntil(
    caches.open(CACHE_ESTATICO).then((cache) =>
      // um arquivo que falhar não derruba a instalação inteira
      Promise.all(ARQUIVOS_APP.concat(ARQUIVOS_CDN).map((url) =>
        cache.add(url).catch((erro) => console.warn("Não guardou no cache:", url, erro))
      ))
    )
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_ESTATICO).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return; // dados: sempre direto na rede

  if (url.origin === self.location.origin) {
    evento.respondWith(
      fetch(req)
        .then((resposta) => {
          const copia = resposta.clone();
          caches.open(CACHE_ESTATICO).then((cache) => cache.put(req, copia));
          return resposta;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((match) => match || caches.match("index.html")))
    );
    return;
  }

  if (url.hostname === CDN_HOSTNAME) {
    evento.respondWith(
      caches.match(req).then((match) =>
        match || fetch(req).then((resposta) => {
          const copia = resposta.clone();
          caches.open(CACHE_ESTATICO).then((cache) => cache.put(req, copia));
          return resposta;
        })
      )
    );
  }
  // resto: direto pra rede, sem cache
});
