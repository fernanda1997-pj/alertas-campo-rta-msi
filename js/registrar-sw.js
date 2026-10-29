// Registra o Service Worker (sw.js) — deixa guardado uma cópia do site no
// próprio celular pra abrir mesmo sem sinal nenhum. Incluído em toda página
// (index.html/app.html/redefinir-senha.html) pra funcionar a partir de
// qualquer uma delas.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((erro) => {
      console.error("Não foi possível registrar o service worker (o site ainda funciona normalmente com sinal):", erro);
    });
  });
}
