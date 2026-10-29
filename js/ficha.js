// Aba "Ficha": preencher a Ficha de Inspeção em campo acompanhando o GPS.
//
// - A pessoa abre a ficha de um trecho (região + tipo + trecho, as mesmas linhas
//   da planilha real: MODELO_FICHA, js/modelo-ficha.js).
// - Com "Acompanhar" ligado, o GPS mostra em que S.R.E./linha ela está.
// - "Preencher ao passar": escolhe a condição atual de cada grupo (ex.: BOM,
//   ADEQ.) e o app marca sozinho toda linha por onde o carro passa — não precisa
//   ser de km em km. Mudou a condição, toca na nova e segue. Qualquer linha
//   também pode ser marcada à mão (e de uma vez até outra linha).
// - Várias pessoas no mesmo trecho: cada aparelho guarda só as SUAS marcações
//   (no celular e num arquivo próprio no SharePoint, api/ficha.js); na tela e
//   na planilha, cada célula fica com a marcação mais recente de quem quer que seja.
// - Sem sinal: tudo fica no celular e sobe quando a conexão voltar.
// - "Baixar planilha": a ficha .xlsx real da região/tipo, com os X (js/ficha-xlsx.js).
//
// Limite de navegador: o GPS só é lido com o app aberto e a tela ligada (pede
// a tela acesa enquanto acompanha). Tela bloqueada = para de acompanhar.

const DIST_MAX_FICHA_M = 150;      // mais longe que isso do eixo = "fora do trecho"
const SALTO_MAX_LINHAS = 6;        // GPS pulou mais que isso no mesmo S.R.E.? não preenche o meio
const INTERVALO_OUTRAS_MS = 60000; // de quanto em quanto tempo busca o que os outros marcaram

function mesAtual() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

let fichaState = {
  comp: mesAtual(), r: "", f: "", tr: "",
  minhas: {},          // marcações deste aparelho: { "SRE|km": { grupo: {c, em, por} } }
  outras: [],          // docs dos outros aparelhos (api/ficha.js)
  acompanhando: false, posicao: null, gpsErro: "", linhaAtual: null, ultimaLinhaAuto: null,
  auto: {},            // condição atual de cada grupo pro "preencher ao passar"
  autoLigado: true,
  editando: null,      // chave da linha aberta no editor
  sinc: { enviando: false, ultimo: null, erro: "" },
  alertas: []          // alertas abertos (marcação no km)
};
let _watchGps = null, _travaTelaFicha = null, _timerSalvarFicha = null, _timerOutras = null;

// ---------- modelo ----------
function blocoFicha(r, f) { return MODELO_FICHA.find((b) => b.r === r && b.f === f) || null; }
function trechoFicha(s) { const b = blocoFicha(s.r, s.f); return b ? b.trechos.find((t) => t.tr === s.tr) || null : null; }
function idFichaLocal(s) { return s.comp + "|" + s.r + "|" + s.f + "|" + s.tr; }
function chaveLinha(sre, ini) { return sre + "|" + ini; }
function rotuloCurto(r) { return String(r).replace(/\s*\(.*$/, ""); } // "REG. (ATÉ 10 IRR./KM)" -> "REG."

// Todas as linhas do trecho na ordem da ficha: [{sre, ini, fim, i, chave}]
function linhasDoTrecho(trecho) {
  const out = [];
  for (const [sre, marcos] of trecho.sres) {
    for (let i = 0; i < marcos.length - 1; i++) out.push({ sre, ini: marcos[i], fim: marcos[i + 1], i, marcos, chave: chaveLinha(sre, marcos[i]) });
  }
  return out;
}

// Cada célula: a marcação mais recente entre a minha e as dos outros
function marcacoesJuntas() {
  const s = fichaState;
  const docs = [{ marcas: s.minhas }].concat(s.outras.filter((d) => d.dispositivo !== DISPOSITIVO));
  return juntarMarcacoes(docs);
}

function juntarMarcacoes(docs) {
  const saida = {};
  for (const d of docs) {
    for (const [linha, grupos] of Object.entries(d.marcas || {})) {
      for (const [g, m] of Object.entries(grupos)) {
        const atual = saida[linha] && saida[linha][g];
        if (!atual || m.em > atual.em) (saida[linha] = saida[linha] || {})[g] = m;
      }
    }
  }
  return saida;
}

// ---------- estado local ----------
async function abrirFichaInspecao(r, f, tr, comp) {
  pararAcompanhar();
  Object.assign(fichaState, { r, f, tr, comp: comp || fichaState.comp, minhas: {}, outras: [], linhaAtual: null, ultimaLinhaAuto: null, editando: null, auto: {} });
  gravarLocal("alertas_ficha_ultima", JSON.stringify({ r, f, tr }));
  try {
    const doc = await lerFichaLocal(idFichaLocal(fichaState));
    if (doc) { fichaState.minhas = doc.marcas || {}; fichaState.auto = doc.auto || {}; }
  } catch (erro) { console.error("Não consegui ler a ficha guardada no celular:", erro); }
  renderFicha();
  buscarOutras();
  buscarAlertasDaFicha();
  clearInterval(_timerOutras);
  _timerOutras = setInterval(() => { if (fichaState.tr && document.visibilityState === "visible") buscarOutras(); }, INTERVALO_OUTRAS_MS);
}

// Entrar na aba: volta pra última ficha aberta neste aparelho (ou mostra a escolha)
function abrirAbaFicha() {
  if (fichaState.tr) { renderFicha(); return; }
  let ultima = null;
  try { ultima = JSON.parse(lerLocal("alertas_ficha_ultima") || "null"); } catch (e) { /* sem última */ }
  if (ultima && blocoFicha(ultima.r, ultima.f) && trechoFicha({ r: ultima.r, f: ultima.f, tr: ultima.tr })) {
    abrirFichaInspecao(ultima.r, ultima.f, ultima.tr);
  } else {
    renderFicha();
  }
}

function fecharFicha() {
  pararAcompanhar();
  clearInterval(_timerOutras);
  fichaState.tr = "";
  gravarLocal("alertas_ficha_ultima", ""); // "Trocar" = quer escolher outra, não reabrir esta
  renderFicha();
}

function guardarFicha() {
  clearTimeout(_timerSalvarFicha);
  _timerSalvarFicha = setTimeout(async () => {
    const s = fichaState;
    if (!s.tr) return;
    try {
      await salvarFichaLocal({ id: idFichaLocal(s), comp: s.comp, r: s.r, f: s.f, tr: s.tr, marcas: s.minhas, auto: s.auto, pendente: true });
      enviarFichasPendentes();
    } catch (erro) { console.error("Não consegui guardar a ficha no celular:", erro); }
  }, 1200);
}

// Sobe pro SharePoint tudo que mudou (desta ficha e de outras que ficaram sem sinal)
async function enviarFichasPendentes() {
  const sinc = fichaState.sinc;
  if (sinc.enviando || semSinal()) return;
  let docs;
  try { docs = (await listarFichasLocais()).filter((d) => d.pendente); } catch (erro) { return; }
  if (!docs.length) return;
  sinc.enviando = true; sinc.erro = "";
  atualizarStatusFicha();
  for (const d of docs) {
    try {
      await apiGravarFicha({ comp: d.comp, r: d.r, f: d.f, tr: d.tr, dispositivo: DISPOSITIVO, nome: NOME_USUARIO, marcas: d.marcas });
      // só tira o "pendente" se nada mudou durante o envio
      const atual = await lerFichaLocal(d.id);
      if (atual && JSON.stringify(atual.marcas) === JSON.stringify(d.marcas)) await salvarFichaLocal(Object.assign(atual, { pendente: false }));
      sinc.ultimo = new Date().toISOString();
    } catch (erro) {
      console.error("Ficha não subiu (fica pra próxima):", erro);
      sinc.erro = pareceErroDeRede(erro) ? "" : (erro.message || String(erro));
      if (pareceErroDeRede(erro)) break;
    }
  }
  sinc.enviando = false;
  atualizarStatusFicha();
}

async function buscarOutras() {
  const s = fichaState;
  if (!s.tr || semSinal()) return;
  try {
    const docs = await apiLerFicha(s.comp, s.r, s.f, s.tr);
    if (s.tr) { s.outras = docs; if (!s.editando) renderFicha(); }
  } catch (erro) { console.error("Não consegui buscar as marcações dos outros:", erro); }
}

async function buscarAlertasDaFicha() {
  if (semSinal()) return;
  try {
    fichaState.alertas = (await apiListarAlertas()).filter((a) => STATUS_ABERTOS.includes(a.status) && a.sre && a.km_sre != null);
    if (fichaState.tr && !fichaState.editando) renderFicha();
  } catch (erro) { console.error(erro); }
}

// ---------- marcar ----------
function marcar(chave, grupo, codigo) {
  const m = fichaState.minhas;
  (m[chave] = m[chave] || {})[grupo] = { c: codigo, em: new Date().toISOString(), por: NOME_USUARIO || "" };
}

// Aplica a "condição atual" (auto) numa linha
function aplicarAuto(chave) {
  let mudou = false;
  const juntas = marcacoesJuntas();
  for (const [g, c] of Object.entries(fichaState.auto)) {
    if (!c) continue;
    const atual = juntas[chave] && juntas[chave][g];
    if (!atual || atual.c !== c) { marcar(chave, g, c); mudou = true; }
  }
  return mudou;
}

// ---------- GPS ----------
function acompanhar() {
  const s = fichaState;
  if (!navigator.geolocation) { s.gpsErro = "Este navegador não dá acesso ao GPS."; renderFicha(); return; }
  s.acompanhando = true; s.gpsErro = "";
  if ("wakeLock" in navigator) navigator.wakeLock.request("screen").then((t) => { _travaTelaFicha = t; }).catch(() => {});
  _watchGps = navigator.geolocation.watchPosition(aoMudarPosicao, (erro) => {
    s.gpsErro = erro.code === 1 ? "Permissão de localização negada — libere o GPS pra este site." : "Sem sinal de GPS agora.";
    atualizarGpsNaTela();
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  renderFicha();
}

function pararAcompanhar() {
  if (_watchGps != null) navigator.geolocation.clearWatch(_watchGps);
  _watchGps = null;
  if (_travaTelaFicha) { _travaTelaFicha.release().catch(() => {}); _travaTelaFicha = null; }
  fichaState.acompanhando = false;
  fichaState.ultimaLinhaAuto = null;
}

// a tela de acompanhar é solta pelo navegador quando a página some: pede de novo na volta
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && fichaState.acompanhando && "wakeLock" in navigator) {
    navigator.wakeLock.request("screen").then((t) => { _travaTelaFicha = t; }).catch(() => {});
  }
});

function aoMudarPosicao(pos) {
  const s = fichaState;
  const trecho = trechoFicha(s);
  if (!trecho) return;
  s.posicao = { lat: pos.coords.latitude, lng: pos.coords.longitude, precisao: pos.coords.accuracy };
  s.gpsErro = "";
  const sresDaFicha = new Set(trecho.sres.map((x) => x[0]));
  const achado = localizarNoSre(s.posicao.lat, s.posicao.lng, (x) => sresDaFicha.has(x.s));
  const limite = Math.max(DIST_MAX_FICHA_M, (s.posicao.precisao || 0) * 1.5);
  if (!achado || achado.distancia > limite) {
    s.linhaAtual = { fora: true, distancia: achado ? achado.distancia : null };
    atualizarGpsNaTela();
    return;
  }
  const linhas = linhasDoTrecho(trecho);
  // última linha do S.R.E. vai até o fim da ficha; km do traçado pode passar um pouco
  let linha = null;
  for (const l of linhas) if (l.sre === achado.sre && achado.km >= l.ini - 0.05) linha = l;
  if (!linha) { s.linhaAtual = { fora: true, distancia: achado.distancia }; atualizarGpsNaTela(); return; }
  const mudouLinha = !s.linhaAtual || s.linhaAtual.chave !== linha.chave;
  s.linhaAtual = Object.assign({}, linha, { km: achado.km, distancia: achado.distancia });

  let mudouDado = false;
  if (s.autoLigado && Object.values(s.auto).some(Boolean) && mudouLinha) {
    // preenche também as linhas entre a anterior e esta (GPS falhou um trecho), se for o mesmo S.R.E. e perto
    const ant = s.ultimaLinhaAuto;
    const idxAtual = linhas.findIndex((l) => l.chave === linha.chave);
    const idxAnt = ant ? linhas.findIndex((l) => l.chave === ant) : -1;
    let de = idxAtual, ate = idxAtual;
    // a linha anterior já foi marcada quando o carro passou por ela: só as do meio
    if (idxAnt >= 0 && linhas[idxAnt].sre === linha.sre && Math.abs(idxAtual - idxAnt) <= SALTO_MAX_LINHAS) {
      if (idxAtual > idxAnt) de = idxAnt + 1; else ate = idxAnt - 1;
    }
    for (let k = de; k <= ate; k++) mudouDado = aplicarAuto(linhas[k].chave) || mudouDado;
    s.ultimaLinhaAuto = linha.chave;
  }
  if (mudouDado) { guardarFicha(); if (!s.editando) renderFicha(); else atualizarGpsNaTela(); }
  else atualizarGpsNaTela();
}

// ---------- tela ----------
function renderFicha() {
  const m = document.getElementById("mount-ficha");
  if (!m) return;
  const s = fichaState;
  if (!s.tr || !trechoFicha(s)) { renderEscolherFicha(m); return; }
  const bloco = blocoFicha(s.r, s.f), trecho = trechoFicha(s);
  const linhas = linhasDoTrecho(trecho);
  const juntas = marcacoesJuntas();
  const completas = linhas.filter((l) => bloco.grupos.every((g) => juntas[l.chave] && juntas[l.chave][g.id] && juntas[l.chave][g.id].c)).length;
  const pct = linhas.length ? Math.round(100 * completas / linhas.length) : 0;
  const outros = s.outras.filter((d) => d.dispositivo !== DISPOSITIVO && d.nome)
    .map((d) => esc(d.nome) + " (" + tempoDesde(d.atualizado) + ")").join(", ");

  const autoHtml = bloco.grupos.map((g) =>
    '<div class="auto-grupo"><div class="grupo-ficha-nome">' + esc(g.nome) + '</div><div class="chips-opcoes">'
    + g.rotulos.map((r) => '<button class="chip-opcao chip-mini' + (s.auto[g.id] === r ? " ativo" : "") + '" data-auto-grupo="' + g.id + '" data-auto-rotulo="' + esc(r) + '" title="' + esc(r) + '">' + esc(rotuloCurto(r)) + "</button>").join("")
    + "</div></div>").join("");

  let linhasHtml = "", sreAnterior = "";
  for (const l of linhas) {
    if (l.sre !== sreAnterior) {
      linhasHtml += '<div class="ficha-sre">S.R.E. <b>' + esc(l.sre) + "</b> · " + numBR(l.marcos[l.marcos.length - 1]) + " km"
        + (SRE_KM.some((x) => x.s === l.sre) ? "" : ' <span class="rotulo-mini">(sem traçado no mapa — marque tocando na linha)</span>') + "</div>";
      sreAnterior = l.sre;
    }
    const marcas = juntas[l.chave] || {};
    const nAlertas = s.alertas.filter((a) => a.sre === l.sre && Number(a.km_sre) >= l.ini && Number(a.km_sre) < l.fim + (l.i === l.marcos.length - 2 ? 0.5 : 0)).length;
    linhasHtml += '<button class="ficha-linha' + (s.linhaAtual && s.linhaAtual.chave === l.chave ? " atual" : "") + '" data-linha="' + esc(l.chave) + '">'
      + '<span class="ficha-km">' + numBR(l.ini) + "–" + numBR(l.fim) + "</span>"
      + bloco.grupos.map((g) => {
        const mk = marcas[g.id];
        const k = mk && mk.c ? g.rotulos.indexOf(mk.c) : -1;
        return '<span class="ficha-cel' + (k < 0 ? " vazia" : k === 0 ? " boa" : " ruim") + '" title="' + esc(g.nome + (mk && mk.c ? ": " + mk.c + " · " + (mk.por || "?") : "")) + '">' + (k < 0 ? "·" : esc(rotuloCurto(mk.c))) + "</span>";
      }).join("")
      + (nAlertas ? '<span class="ficha-alerta" title="' + nAlertas + ' alerta(s) aberto(s) neste km">⚠' + nAlertas + "</span>" : "")
      + "</button>";
  }

  m.innerHTML = '<div class="ficha-tela" style="--n:' + bloco.grupos.length + '">'
    + '<div class="ficha-cabeca"><div><div class="rotulo-mini">' + esc(rotuloRegiao(s.r)) + " · Ficha " + esc(FICHAS[s.f].nome.toLowerCase()) + " · " + esc(rotuloMes(s.comp)) + "</div>"
    + "<b>Trecho " + esc(s.tr) + "</b> — " + esc(trecho.tn) + "</div>"
    + '<button class="btn btn-ghost btn-mini" id="btn-trocar-ficha">Trocar</button></div>'
    + '<div id="ficha-gps"></div>'
    + '<details class="ficha-auto"' + (Object.values(s.auto).some(Boolean) ? "" : " open") + "><summary><b>Preencher ao passar</b> "
    + '<label class="chave-auto" onclick="event.stopPropagation()"><input type="checkbox" id="chk-auto"' + (s.autoLigado ? " checked" : "") + "> ligado</label></summary>"
    + '<div class="rotulo-mini">Toque na condição atual de cada grupo. Com o GPS ligado, toda linha por onde você passar é marcada assim — mudou a pista, toque na nova condição.</div>'
    + autoHtml + "</details>"
    + '<div class="ficha-progresso"><div class="barra"><i style="width:' + pct + '%"></i></div><span>' + completas + " de " + linhas.length + " linhas completas</span></div>"
    + '<div class="rotulo-mini" id="ficha-status"></div>'
    + (outros ? '<div class="rotulo-mini">Também preenchendo este trecho: ' + outros + "</div>" : "")
    + '<div class="ficha-cab-grupos"><span class="ficha-km">km</span>' + bloco.grupos.map((g) => '<span class="ficha-cel" title="' + esc(g.nome) + '">' + esc(g.nome.replace(/^(Condição d[oa] |Elementos de |Sinalização )/, "").slice(0, 6)) + "</span>").join("") + "</div>"
    + '<div class="ficha-linhas">' + linhasHtml + "</div>"
    + '<button class="btn btn-outline btn-grande" id="btn-baixar-ficha">Baixar planilha da ' + esc(rotuloRegiao(s.r)) + " (.xlsx)</button>"
    + "</div>"
    + (s.editando ? htmlEditorLinha(bloco, linhas, juntas) : "");

  m.querySelector("#btn-trocar-ficha").addEventListener("click", fecharFicha);
  m.querySelector("#chk-auto").addEventListener("change", (e) => { s.autoLigado = e.target.checked; s.ultimaLinhaAuto = null; });
  m.querySelectorAll("[data-auto-grupo]").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.autoGrupo, r = b.dataset.autoRotulo;
    s.auto[g] = s.auto[g] === r ? "" : r;
    // trocou a condição dentro de uma linha: vale pra ela se ainda está na
    // primeira metade (ou se a linha não tinha nada); passou da metade, a
    // ficha pede o PREDOMINANTE — a linha fica como estava e a nova começa na próxima
    const l = s.linhaAtual;
    if (s.autoLigado && l && l.chave && s.auto[g]) {
      const jaTinha = (marcacoesJuntas()[l.chave] || {})[g];
      const fracao = l.fim > l.ini ? (l.km - l.ini) / (l.fim - l.ini) : 0;
      if (!jaTinha || !jaTinha.c || fracao <= 0.5) marcar(l.chave, g, s.auto[g]);
      s.ultimaLinhaAuto = l.chave;
    }
    guardarFicha();
    renderFicha();
  }));
  m.querySelectorAll("[data-linha]").forEach((b) => b.addEventListener("click", () => { s.editando = b.dataset.linha; renderFicha(); }));
  m.querySelector("#btn-baixar-ficha").addEventListener("click", () => baixarFichaXlsx(s.r, s.f, s.comp));
  if (s.editando) ligarEditorLinha(m, bloco, linhas);
  atualizarGpsNaTela();
  atualizarStatusFicha();
}

function atualizarGpsNaTela() {
  const el = document.getElementById("ficha-gps");
  if (!el) return;
  const s = fichaState;
  let txt;
  if (!s.acompanhando) {
    txt = '<button class="btn btn-primary btn-grande" id="btn-acompanhar">📍 Acompanhar minha localização</button>';
  } else {
    const l = s.linhaAtual;
    const info = s.gpsErro ? '<span class="aviso-gps">' + esc(s.gpsErro) + "</span>"
      : !l ? "Procurando o GPS…"
      : l.fora ? "<b>Fora deste trecho</b>" + (l.distancia != null ? " (" + (l.distancia >= 1000 ? (l.distancia / 1000).toFixed(1) + " km" : Math.round(l.distancia) + " m") + " da rodovia mais perto dele)" : "")
      : "Você está no <b>S.R.E. " + esc(l.sre) + "</b> · km " + l.km.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " · linha <b>" + numBR(l.ini) + "–" + numBR(l.fim) + "</b>";
    txt = '<div class="ficha-gps-ativo"><span class="ponto-gps"></span><div>' + info
      + (s.posicao && s.posicao.precisao ? '<div class="rotulo-mini">precisão do GPS: ' + Math.round(s.posicao.precisao) + " m</div>" : "")
      + '</div><button class="btn btn-ghost btn-mini" id="btn-parar-gps">Parar</button></div>';
  }
  el.innerHTML = txt;
  const b1 = el.querySelector("#btn-acompanhar"); if (b1) b1.addEventListener("click", acompanhar);
  const b2 = el.querySelector("#btn-parar-gps"); if (b2) b2.addEventListener("click", () => { pararAcompanhar(); renderFicha(); });
  document.querySelectorAll(".ficha-linha").forEach((b) => b.classList.toggle("atual", !!(s.linhaAtual && s.linhaAtual.chave === b.dataset.linha)));
}

function atualizarStatusFicha() {
  const el = document.getElementById("ficha-status");
  if (!el) return;
  const s = fichaState.sinc;
  el.textContent = s.enviando ? "Enviando pro SharePoint…"
    : s.erro ? "Não consegui enviar: " + s.erro
    : semSinal() ? "Sem sinal — fica guardado no celular e sobe quando o sinal voltar."
    : s.ultimo ? "Salvo no celular e no SharePoint (" + tempoDesde(s.ultimo) + ")."
    : "Salvo no celular.";
}

function htmlEditorLinha(bloco, linhas, juntas) {
  const s = fichaState;
  const l = linhas.find((x) => x.chave === s.editando);
  if (!l) return "";
  const marcas = juntas[l.chave] || {};
  const seguintes = linhas.filter((x) => x.sre === l.sre && x.ini > l.ini);
  const alertasAqui = s.alertas.filter((a) => a.sre === l.sre && Number(a.km_sre) >= l.ini && Number(a.km_sre) < l.fim + 0.5);
  return '<div class="ficha-fundo" id="editor-fundo"></div><div class="ficha editor-linha" role="dialog">'
    + '<div class="ficha-topo"><b>S.R.E. ' + esc(l.sre) + " · km " + numBR(l.ini) + "–" + numBR(l.fim) + '</b><button class="btn btn-ghost" id="btn-fechar-editor" aria-label="Fechar">✕</button></div>'
    + '<div class="ficha-corpo">'
    + (alertasAqui.length ? '<div class="aviso-proximo">⚠ Alertas abertos neste km: ' + alertasAqui.map((a) => "<b>" + esc(a.categoria) + "</b>" + (a.observacao ? " — " + esc(a.observacao) : "")).join("; ") + "</div>" : "")
    + bloco.grupos.map((g) => {
      const mk = marcas[g.id];
      return '<div class="grupo-ficha"><div class="grupo-ficha-nome">' + esc(g.nome)
        + (mk && mk.c ? ' <span class="rotulo-mini">· ' + esc(mk.por || "?") + ", " + tempoDesde(mk.em) + "</span>" : "") + '</div><div class="chips-opcoes">'
        + g.rotulos.map((r) => '<button class="chip-opcao chip-mini' + (mk && mk.c === r ? " ativo" : "") + '" data-ed-grupo="' + g.id + '" data-ed-rotulo="' + esc(r) + '">' + esc(r) + "</button>").join("")
        + (mk && mk.c ? '<button class="chip-opcao chip-mini chip-limpar" data-ed-grupo="' + g.id + '" data-ed-rotulo="">limpar</button>' : "")
        + "</div></div>";
    }).join("")
    + (seguintes.length ? '<div class="field"><label>Aplicar o que está marcado aqui também até</label><select class="input" id="sel-ate"><option value="">só esta linha</option>'
      + seguintes.map((x) => '<option value="' + esc(x.chave) + '">km ' + numBR(x.fim) + "</option>").join("") + "</select></div>" : "")
    + "</div>"
    + '<div class="ficha-rodape"><button class="btn btn-primary btn-grande" id="btn-ok-editor">Pronto</button></div></div>';
}

function ligarEditorLinha(m, bloco, linhas) {
  const s = fichaState;
  const fechar = () => { s.editando = null; renderFicha(); };
  m.querySelector("#btn-fechar-editor").addEventListener("click", fechar);
  m.querySelector("#editor-fundo").addEventListener("click", fechar);
  m.querySelectorAll("[data-ed-grupo]").forEach((b) => b.addEventListener("click", () => {
    marcar(s.editando, b.dataset.edGrupo, b.dataset.edRotulo);
    guardarFicha();
    renderFicha();
  }));
  m.querySelector("#btn-ok-editor").addEventListener("click", () => {
    const sel = m.querySelector("#sel-ate");
    if (sel && sel.value) {
      // copia as marcações desta linha pras seguintes, até a escolhida
      const juntas = marcacoesJuntas();
      const origem = juntas[s.editando] || {};
      const l0 = linhas.find((x) => x.chave === s.editando);
      for (const x of linhas) {
        if (x.sre !== l0.sre || x.ini <= l0.ini) continue;
        for (const [g, mk] of Object.entries(origem)) if (mk.c) marcar(x.chave, g, mk.c);
        if (x.chave === sel.value) break;
      }
      guardarFicha();
    }
    fechar();
  });
}

function renderEscolherFicha(m) {
  const s = fichaState;
  const regioes = [...new Set(MODELO_FICHA.map((b) => b.r))];
  const r = s.r || regioes[0], f = s.f || "pav";
  const bloco = blocoFicha(r, f);
  const trechos = bloco ? bloco.trechos : [];
  m.innerHTML = '<div class="alerta-tela">'
    + '<div class="lista-titulo-ficha">Preencher Ficha de Inspeção</div>'
    + '<div class="rotulo-mini">Escolha a ficha do trecho que vai percorrer. Dá pra mais de uma pessoa preencher o mesmo trecho ao mesmo tempo.</div>'
    + '<button class="btn btn-outline btn-grande" id="btn-ficha-gps">📍 Achar pelo meu local</button>'
    + (s.gpsErro ? '<div class="aviso-gps">' + esc(s.gpsErro) + "</div>" : "")
    + '<div class="field"><label>Região</label><select class="input" id="sel-f-regiao">' + opts(regioes, r, rotuloRegiao) + "</select></div>"
    + '<div class="field"><label>Ficha</label><div class="seletor-ficha">'
    + Object.keys(FICHAS).map((k) => '<button class="seg' + (k === f ? " ativo" : "") + '" data-f-tipo="' + k + '">' + esc(FICHAS[k].nome) + "</button>").join("") + "</div></div>"
    + '<div class="field"><label>Trecho</label><select class="input" id="sel-f-trecho"><option value="">Escolha…</option>'
    + trechos.map((t) => '<option value="' + esc(t.tr) + '"' + (t.tr === s.tr ? " selected" : "") + ">" + esc(t.tr + " — " + t.tn) + "</option>").join("") + "</select></div>"
    + '<div class="field"><label>Mês da ficha</label><input class="input" type="month" id="inp-f-mes" value="' + esc(s.comp) + '"></div>'
    + '<button class="btn btn-primary btn-grande" id="btn-abrir-ficha" disabled>Abrir ficha</button>'
    + "</div>";
  s.r = r; s.f = f;
  const selT = m.querySelector("#sel-f-trecho"), btn = m.querySelector("#btn-abrir-ficha");
  const atualizar = () => { btn.disabled = !selT.value; };
  m.querySelector("#sel-f-regiao").addEventListener("change", (e) => { s.r = e.target.value; s.tr = ""; renderFicha(); });
  m.querySelectorAll("[data-f-tipo]").forEach((b) => b.addEventListener("click", () => { s.f = b.dataset.fTipo; s.tr = ""; renderFicha(); }));
  selT.addEventListener("change", atualizar);
  m.querySelector("#inp-f-mes").addEventListener("change", (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) s.comp = e.target.value; });
  btn.addEventListener("click", () => abrirFichaInspecao(s.r, s.f, selT.value, s.comp));
  m.querySelector("#btn-ficha-gps").addEventListener("click", acharFichaPeloLocal);
  atualizar();
}

// Lê o GPS uma vez e escolhe região/tipo/trecho da ficha onde a pessoa está
async function acharFichaPeloLocal() {
  const s = fichaState;
  s.gpsErro = "";
  const c = await obterCoordenadasReais();
  if (!c) { s.gpsErro = "Não consegui a localização (GPS desligado ou permissão negada)."; renderFicha(); return; }
  const achado = localizarNoSre(c.lat, c.lng, (x) => MODELO_FICHA.some((b) => b.trechos.some((t) => t.sres.some((y) => y[0] === x.s))));
  if (!achado || achado.distancia > 3000) { s.gpsErro = "Nenhum trecho das fichas perto daqui."; renderFicha(); return; }
  const info = SRE_KM.find((x) => x.s === achado.sre);
  const candidatos = MODELO_FICHA.filter((b) => b.trechos.some((t) => t.sres.some((y) => y[0] === achado.sre)));
  const bloco = candidatos.find((b) => info && b.f === info.f) || candidatos[0];
  const trecho = bloco.trechos.find((t) => t.sres.some((y) => y[0] === achado.sre));
  abrirFichaInspecao(bloco.r, bloco.f, trecho.tr, s.comp);
}

window.addEventListener("online", () => { enviarFichasPendentes(); buscarOutras(); });
