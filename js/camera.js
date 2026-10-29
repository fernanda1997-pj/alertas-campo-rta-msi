// Câmera contínua (tela Novo alerta) — copiada do Fotos de Campo (web - Fotos/js/camera.js),
// só com os nomes trocados pra este app. Abre a câmera DENTRO do app e deixa tirar
// várias fotos seguidas, sem voltar pra tela e tocar no "+" a cada foto — a
// câmera nativa do celular (input capture) só devolve UMA foto por vez.
//
// Cada toque no botão redondo já anexa a foto ao alerta (alertaState.fotos, pela
// mesma adicionarFotos da câmera do celular); "Concluir" só fecha a câmera.
// A foto é o quadro do vídeo na resolução que o navegador liberou (até ~2560 px,
// de sobra: o envio reduz pra 1600 px de qualquer jeito). Se a câmera do app não
// abrir (sem permissão, navegador sem suporte), cai na câmera nativa do celular.
//
// "Apagão" no campo: a câmera do app não segura a tela acesa sozinha (o app de
// câmera do celular segura) e o navegador corta a câmera quando a tela bloqueia
// ou a pessoa troca de app — na volta o vídeo ficava preto e o botão não fazia
// nada. Agora: pede a tela acesa (Wake Lock) enquanto a câmera está aberta e
// religa a câmera sozinha ao voltar pro app (ou ao tocar no botão com ela parada).

let _cameraContinua = null;

const RESTRICOES_CAMERA = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
  audio: false
};

async function abrirCameraContinua() {
  if (_cameraContinua) return;
  alertaState.avisoCamera = "";
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alertaState.avisoCamera = "Este navegador não deixa o app abrir a câmera — usei a câmera do celular (uma foto por vez).";
    renderAlerta();
    document.getElementById("input-foto").click();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(RESTRICOES_CAMERA);
  } catch (erro) {
    console.error("Não consegui abrir a câmera do app:", erro);
    alertaState.avisoCamera = "Não consegui abrir a câmera dentro do app (permissão negada?) — usei a câmera do celular (uma foto por vez).";
    renderAlerta();
    document.getElementById("input-foto").click();
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "camera-continua";
  overlay.style.cssText = "position:fixed;inset:0;z-index:300;background:#000;display:flex;flex-direction:column;";
  overlay.innerHTML =
    '<div id="cam-area" style="flex:1 1 auto;min-height:0;position:relative;overflow:hidden;touch-action:none;">'
    + '<video id="cam-video" autoplay playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;transform-origin:center center;"></video>'
    + '<div id="cam-flash" style="position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .18s;"></div>'
    + '<div id="cam-status" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:none;background:rgba(0,0,0,.7);color:#fff;font:600 14px system-ui,sans-serif;padding:10px 16px;border-radius:12px;text-align:center;max-width:80%;"></div>'
    + '<div style="position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);left:0;right:0;text-align:center;color:#fff;font:600 12.5px system-ui,sans-serif;text-shadow:0 1px 4px rgba(0,0,0,.8);pointer-events:none;">Toque no círculo pra tirar · dois dedos dão zoom</div>'
    + '<div id="cam-zoom-badge" style="position:absolute;top:calc(env(safe-area-inset-top,0px) + 38px);left:50%;transform:translateX(-50%);background:rgba(0,0,0,.6);color:#fff;font:700 15px system-ui,sans-serif;padding:4px 14px;border-radius:16px;opacity:0;transition:opacity .25s;pointer-events:none;">1×</div>'
    + '<div id="cam-zoom-botoes" style="position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:6px;background:rgba(0,0,0,.5);border-radius:24px;padding:5px;"></div>'
    + '</div>'
    + '<div style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:14px 18px calc(env(safe-area-inset-bottom,0px) + 18px);background:#000;">'
    + '<div id="cam-ultima" style="position:relative;width:58px;height:58px;border-radius:10px;overflow:hidden;background:#1f2937;"></div>'
    + '<button id="cam-disparar" aria-label="Tirar foto" style="width:78px;height:78px;border-radius:50%;border:4px solid #fff;background:rgba(255,255,255,.88);cursor:pointer;padding:0;"></button>'
    + '<button id="cam-concluir" style="min-width:92px;height:44px;border-radius:22px;border:none;background:#2563eb;color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer;padding:0 16px;">Fechar</button>'
    + '</div>';
  document.body.appendChild(overlay);

  const video = overlay.querySelector("#cam-video");
  video.srcObject = stream;
  video.play().catch(() => {});
  _cameraContinua = { overlay, stream, tiradas: 0, pendentes: 0 };

  const botaoConcluir = overlay.querySelector("#cam-concluir");
  const miniatura = overlay.querySelector("#cam-ultima");
  const status = overlay.querySelector("#cam-status");
  const mostrarStatus = (texto) => { status.textContent = texto; status.style.display = texto ? "block" : "none"; };

  // ---- tela acesa enquanto a câmera está aberta ----
  // O navegador solta o Wake Lock sozinho quando a página some (tela bloqueada,
  // troca de app); por isso pede de novo toda vez que a página volta.
  let travaTela = null;
  async function manterTelaAcesa() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try { travaTela = await navigator.wakeLock.request("screen"); }
    catch (erro) { console.error("Não consegui manter a tela acesa:", erro); }
  }
  manterTelaAcesa();

  // ---- religar a câmera quando o navegador cortou ----
  let religando = false;
  const cameraParada = () => !trilha || trilha.readyState === "ended" || !video.videoWidth;
  async function religarCamera() {
    if (religando || !_cameraContinua) return;
    religando = true;
    mostrarStatus("Religando a câmera…");
    try {
      stream.getTracks().forEach((t) => t.stop());
      const novo = await navigator.mediaDevices.getUserMedia(RESTRICOES_CAMERA);
      if (!_cameraContinua) { novo.getTracks().forEach((t) => t.stop()); return; } // fechou enquanto religava
      stream = novo; _cameraContinua.stream = novo;
      trilha = stream.getVideoTracks()[0];
      trilha.addEventListener("ended", aoCairTrilha);
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (zoom !== 1) aplicarZoom(zoom);
      mostrarStatus("");
    } catch (erro) {
      console.error("Não consegui religar a câmera:", erro);
      mostrarStatus("A câmera parou. Toque no círculo pra tentar de novo, ou em Fechar e abra outra vez.");
    } finally {
      religando = false;
    }
  }
  function aoCairTrilha() { if (document.visibilityState === "visible") religarCamera(); }
  function aoMudarVisibilidade() {
    if (document.visibilityState !== "visible") return;
    manterTelaAcesa();
    video.play().catch(() => {});
    // dá um instante pro navegador devolver a câmera sozinho antes de religar
    setTimeout(() => { if (_cameraContinua && (cameraParada() || trilha.muted)) religarCamera(); }, 800);
  }
  document.addEventListener("visibilitychange", aoMudarVisibilidade);

  // ---- zoom ----
  // Zoom de verdade da câmera quando o aparelho deixa (Android/Chrome: track.zoom);
  // senão zoom digital — amplia o vídeo na tela e a foto sai recortada exatamente
  // no que aparece (iPhone/Safari não libera o zoom da câmera pro navegador).
  const area = overlay.querySelector("#cam-area");
  const faixaPilulas = overlay.querySelector("#cam-zoom-botoes");
  const selo = overlay.querySelector("#cam-zoom-badge");
  let trilha = stream.getVideoTracks()[0];
  if (trilha) trilha.addEventListener("ended", aoCairTrilha);
  const capacidades = trilha && trilha.getCapabilities ? trilha.getCapabilities() : {};
  let zoomReal = !!(capacidades && capacidades.zoom && capacidades.zoom.max > (capacidades.zoom.min || 1));
  const ZOOM_MIN = zoomReal ? Math.max(1, capacidades.zoom.min || 1) : 1;
  const ZOOM_MAX = zoomReal ? capacidades.zoom.max : 4;
  let zoom = 1, aplicandoReal = false, pendenteReal = null, seloTimer = null;

  const niveis = [1, 2, 3, 5].filter((n) => n >= ZOOM_MIN && n <= ZOOM_MAX);
  faixaPilulas.innerHTML = niveis.map((n) => '<button type="button" class="cam-zoom-pilula" data-zoom="' + n + '" style="min-width:44px;height:34px;border-radius:17px;border:none;cursor:pointer;font:700 13px system-ui,sans-serif;padding:0 8px;"></button>').join("");
  if (niveis.length < 2) faixaPilulas.style.display = "none";

  function pintarPilulas() {
    faixaPilulas.querySelectorAll(".cam-zoom-pilula").forEach((b) => {
      const n = +b.getAttribute("data-zoom"), ativo = Math.abs(zoom - n) < 0.05;
      b.textContent = (ativo ? zoom.toFixed(zoom % 1 ? 1 : 0) : n) + "×";
      b.style.background = ativo ? "#fff" : "transparent"; b.style.color = ativo ? "#111827" : "#fff";
    });
  }
  function aplicarZoom(z) {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    pintarPilulas();
    selo.textContent = zoom.toFixed(1) + "×"; selo.style.opacity = "1";
    clearTimeout(seloTimer); seloTimer = setTimeout(() => { selo.style.opacity = "0"; }, 1100);
    if (zoomReal) {
      pendenteReal = zoom;
      if (aplicandoReal) return;
      aplicandoReal = true;
      (async () => {
        while (pendenteReal !== null) {
          const v = pendenteReal; pendenteReal = null;
          try { await trilha.applyConstraints({ advanced: [{ zoom: v }] }); }
          catch (erro) {
            console.error("Zoom da câmera não aplicou, usando zoom digital:", erro);
            zoomReal = false; video.style.transform = "scale(" + zoom + ")"; break;
          }
        }
        aplicandoReal = false;
      })();
    } else {
      video.style.transform = "scale(" + zoom + ")";
    }
  }
  pintarPilulas();
  faixaPilulas.addEventListener("click", (e) => { const b = e.target.closest(".cam-zoom-pilula"); if (b) aplicarZoom(+b.getAttribute("data-zoom")); });

  // pinça com dois dedos (e roda do mouse no computador)
  const dedos = new Map();
  let distIni = 0, zoomIni = 1;
  const distancia = () => { const [a, b] = Array.from(dedos.values()); return Math.hypot(a.x - b.x, a.y - b.y); };
  area.addEventListener("pointerdown", (e) => {
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dedos.size === 2) { distIni = distancia(); zoomIni = zoom; }
  });
  area.addEventListener("pointermove", (e) => {
    if (!dedos.has(e.pointerId)) return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dedos.size === 2 && distIni > 0) aplicarZoom(zoomIni * distancia() / distIni);
  });
  const soltou = (e) => { dedos.delete(e.pointerId); distIni = 0; };
  area.addEventListener("pointerup", soltou); area.addEventListener("pointercancel", soltou);
  area.addEventListener("wheel", (e) => { e.preventDefault(); aplicarZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }, { passive: false });

  // o que aparece na tela = o que sai na foto: no zoom digital recorta a parte visível
  function recorteDaFoto() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (zoomReal || zoom <= 1.001) return { sx: 0, sy: 0, sw: vw, sh: vh };
    const cw = area.clientWidth, ch = area.clientHeight;
    const esc0 = Math.min(cw / vw, ch / vh);
    const sw = Math.min(vw * esc0 * zoom, cw) / (esc0 * zoom), sh = Math.min(vh * esc0 * zoom, ch) / (esc0 * zoom);
    return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
  }

  function fechar() {
    stream.getTracks().forEach((t) => t.stop());
    overlay.remove();
    document.removeEventListener("keydown", aoTeclar);
    document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    if (travaTela) travaTela.release().catch(() => {});
    _cameraContinua = null;
    renderAlerta();
  }
  function aoTeclar(e) { if (e.key === "Escape") fechar(); }
  document.addEventListener("keydown", aoTeclar);
  botaoConcluir.addEventListener("click", fechar);

  overlay.querySelector("#cam-disparar").addEventListener("click", () => {
    if (religando) return;
    if (trilha && trilha.readyState === "ended") { religarCamera(); return; }
    if (!video.videoWidth) { video.play().catch(() => {}); return; } // câmera ainda abrindo
    const rec = recorteDaFoto();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(rec.sw); canvas.height = Math.round(rec.sh);
    canvas.getContext("2d").drawImage(video, rec.sx, rec.sy, rec.sw, rec.sh, 0, 0, canvas.width, canvas.height);
    const flash = overlay.querySelector("#cam-flash");
    flash.style.opacity = ".75"; setTimeout(() => { flash.style.opacity = "0"; }, 90);
    if (navigator.vibrate) navigator.vibrate(25);
    const estado = _cameraContinua;
    estado.pendentes++;
    canvas.toBlob((blob) => {
      estado.pendentes--;
      // solta a memória do quadro na hora: o Safari tem um teto de memória de
      // canvas e, depois de umas 20 fotos sem soltar, para de gerar a foto
      canvas.width = 0; canvas.height = 0;
      if (!blob) { mostrarStatus("Essa foto não foi salva (memória do celular cheia?). Toque em Concluir e envie as que já tirou."); return; }
      const agora = Date.now();
      const arquivo = new File([blob], "foto_" + agora + ".jpg", { type: "image/jpeg", lastModified: agora });
      adicionarFotos([arquivo]);
      if (!religando) mostrarStatus("");
      estado.tiradas++;
      botaoConcluir.textContent = "Concluir (" + estado.tiradas + ")";
      miniatura.innerHTML = '<img src="' + alertaState.fotos[alertaState.fotos.length - 1].url + '" style="width:100%;height:100%;object-fit:cover;display:block;">'
        + '<div style="position:absolute;bottom:2px;right:2px;min-width:20px;height:20px;border-radius:10px;background:#2563eb;color:#fff;font:700 11px/20px system-ui,sans-serif;text-align:center;padding:0 5px;">' + estado.tiradas + '</div>';
      if (!_cameraContinua) renderAlerta(); // fechou antes de a última terminar de salvar
    }, "image/jpeg", 0.92);
  });
}
