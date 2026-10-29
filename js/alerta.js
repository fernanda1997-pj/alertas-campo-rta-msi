// Tela "Novo alerta" (campo): foto → local pelo GPS → o que é → gravidade →
// observação → Enviar. Sem sinal, o alerta vai pra fila do celular (js/fila.js)
// e sobe sozinho quando a conexão voltar.

const RAIO_ALERTA_PROXIMO_M = 300; // alerta aberto a menos disso = "já avisaram aqui"

function estadoInicialAlerta() {
  return {
    fotos: [],              // [{ id, file, url }]
    capturadoEm: null,      // momento da 1ª foto (é o que vale, não a hora do envio)
    gps: null, localizando: false, gpsErro: "",
    regiao: "", trecho: "", sre: "", km: null, extensaoKm: null, distancia: null, manual: false,
    situacao: "",           // PPS, LEN... do S.R.E. (só pra mostrar de onde veio o tipo de ficha)
    tipoFicha: "",          // "pav" | "np" — vem do S.R.E., mas dá pra trocar
    itens: {},              // { grupoId: código da coluna da ficha, outro: "Erosão"... }
    gravidade: "", observacao: "",
    proximos: [],           // alertas abertos perto daqui
    avisoRascunho: "",      // fotos recuperadas do rascunho (o app tinha fechado antes do Enviar)
    avisoCamera: "",        // a câmera do app não abriu e caiu na câmera do celular
    enviando: false, progresso: "", msgOk: "", msgErro: ""
  };
}

let alertaState = estadoInicialAlerta();
let filaState = { total: 0, processando: false, msg: "" };
let alertasAbertosCache = null; // pra checar "já avisaram aqui" sem consultar o banco a cada foto

function semSinal() { return navigator.onLine === false; }

function renderAlerta() {
  const s = alertaState;
  const m = document.getElementById("mount-alerta");
  if (!m) return;

  const faixaConexao = semSinal()
    ? '<div class="faixa-conexao offline">Sem sinal — o alerta fica guardado no celular e sobe sozinho quando o sinal voltar.</div>'
    : "";
  const faixaFila = filaState.total
    ? '<div class="faixa-conexao fila"><span>' + filaState.total + (filaState.total === 1 ? " alerta guardado" : " alertas guardados") + " no celular, esperando sinal.</span>"
      + (semSinal() ? "" : ' <button class="btn btn-outline btn-mini" id="btn-processar-fila"' + (filaState.processando ? " disabled" : "") + ">" + (filaState.processando ? "Enviando…" : "Enviar agora") + "</button>")
      + "</div>"
    : "";
  const faixaFilaMsg = filaState.msg ? '<div class="banner-ok" style="margin:0 0 12px;">' + esc(filaState.msg) + "</div>" : "";

  if (s.msgOk) {
    m.innerHTML = '<div class="alerta-tela">' + faixaConexao + faixaFila
      + '<div class="enviado-ok"><div class="enviado-icone">✓</div><div class="enviado-titulo">' + esc(s.msgOk) + "</div>"
      + '<div class="enviado-sub">O escritório recebe no Painel.</div>'
      + '<button class="btn btn-primary btn-grande" id="btn-novo-alerta">Registrar outro alerta</button></div></div>';
    m.querySelector("#btn-novo-alerta").addEventListener("click", () => { alertaState = estadoInicialAlerta(); renderAlerta(); });
    ligarBotaoFila(m);
    return;
  }

  // ---- 1. Fotos ----
  const miniaturas = s.fotos.map((f) =>
    '<div class="mini-foto"><img src="' + f.url + '" alt=""><button class="mini-foto-x" data-remover="' + f.id + '" aria-label="Remover foto">✕</button></div>'
  ).join("");
  const blocoFotos = s.fotos.length
    ? '<div class="mini-grade">' + miniaturas + '<button class="mini-foto mini-foto-mais" id="btn-mais-foto" aria-label="Tirar mais uma foto">+</button></div>'
    : '<button class="btn-camera" id="btn-tirar-foto"><span class="btn-camera-icone">📷</span><span>Tirar foto do problema</span><small>pode tirar várias seguidas · dois dedos dão zoom</small></button>';
  const avisosFoto = (s.avisoRascunho && s.fotos.length ? '<div class="aviso-gps">' + esc(s.avisoRascunho) + "</div>" : "")
    + (s.avisoCamera ? '<div class="aviso-gps">' + esc(s.avisoCamera) + "</div>" : "");

  // ---- 2. Local ----
  let blocoLocal = "";
  if (s.fotos.length) {
    if (s.localizando) {
      blocoLocal = '<div class="cartao-local"><div class="spinner"></div><span>Pegando a localização…</span></div>';
    } else if (s.manual || !s.regiao) {
      const regioes = Object.keys(REGIOES);
      blocoLocal = '<div class="cartao-local cartao-local-manual">'
        + (s.gpsErro ? '<div class="aviso-gps">' + esc(s.gpsErro) + "</div>" : "")
        + '<div class="field"><label>Região</label><select class="input" id="sel-regiao"><option value="">Escolha…</option>' + opts(regioes, s.regiao, rotuloRegiao) + "</select></div>"
        + '<div class="field"><label>Trecho</label><select class="input" id="sel-trecho"' + (s.regiao ? "" : " disabled") + '><option value="">Escolha…</option>' + (s.regiao ? opts(REGIOES[s.regiao], s.trecho) : "") + "</select></div>"
        + (s.gps ? "" : '<button class="btn btn-ghost btn-mini" id="btn-tentar-gps">Tentar o GPS de novo</button>')
        + "</div>";
    } else {
      blocoLocal = '<div class="cartao-local">'
        + '<div class="cartao-local-texto"><div class="rotulo-mini">Local detectado pelo GPS</div>'
        + "<b>" + esc(rotuloRegiao(s.regiao)) + "</b> › " + esc(s.trecho)
        + (s.sre ? '<div class="km-sre">S.R.E. <b>' + esc(s.sre) + "</b> · " + esc(textoKmAlerta({ sre: s.sre, km_sre: s.km, regiao: s.regiao, tipo_ficha: s.tipoFicha })) + "</div>" : "")
        + '<div class="rotulo-mini">' + (s.gps ? s.gps.lat.toFixed(5) + ", " + s.gps.lng.toFixed(5) : "") + (s.distancia != null ? " · " + Math.round(s.distancia) + " m do eixo" : "") + "</div></div>"
        + '<button class="btn btn-ghost btn-mini" id="btn-corrigir-local">Corrigir</button></div>';
    }
    if (s.proximos.length) {
      const a = s.proximos[0];
      blocoLocal += '<div class="aviso-proximo">Já tem alerta aberto a ' + Math.round(a.distancia) + " m daqui: <b>" + esc(a.categoria) + "</b> (" + esc(statusPorId(a.status).rotulo.toLowerCase()) + ", " + tempoDesde(a.created_at) + ")."
        + (s.proximos.length > 1 ? " E mais " + (s.proximos.length - 1) + " perto." : "")
        + " Se for o mesmo problema, mande mesmo assim só se piorou.</div>";
    }
  }

  // ---- 2. O que viu: os grupos da ficha do tipo deste S.R.E. ----
  const blocoFicha = htmlItensFicha(s);
  const botoesGravidade = GRAVIDADES.map((g) =>
    '<button class="btn-gravidade' + (s.gravidade === g.id ? " ativo" : "") + '" data-gravidade="' + g.id + '" style="--cor:' + g.cor + '">'
    + "<b>" + esc(g.rotulo) + "</b>" + (g.dica ? "<small>" + esc(g.dica) + "</small>" : "") + "</button>"
  ).join("");

  // sem login: o nome é pedido uma vez e fica no celular (js/app.js)
  const blocoNome = NOME_USUARIO ? "" : '<div class="cartao-nome"><label for="campo-nome">Seu nome</label>'
    + '<div class="linha-nome"><input class="input" id="campo-nome" maxlength="60" autocomplete="name" placeholder="Ex.: João Silva"><button class="btn btn-primary" id="btn-salvar-nome">OK</button></div>'
    + '<div class="rotulo-mini">Só na primeira vez. Fica salvo neste celular e aparece pro escritório em cada alerta.</div></div>';

  const falta = [];
  if (!NOME_USUARIO) falta.push("seu nome");
  if (!s.fotos.length) falta.push("foto");
  if (!s.regiao || !s.trecho) falta.push("local");
  if (!Object.keys(s.itens).length) falta.push("o que você viu");
  if (!s.gravidade) falta.push("gravidade");
  if (observacaoObrigatoria(s) && s.observacao.trim().length < 5) falta.push("observação");
  const podeEnviar = !falta.length && !s.enviando && !s.localizando;

  m.innerHTML = '<div class="alerta-tela">' + faixaConexao + faixaFila + faixaFilaMsg + blocoNome
    + '<div class="passo"><div class="passo-titulo"><span class="passo-num">1</span>Foto</div>' + blocoFotos + avisosFoto + blocoLocal + "</div>"
    + '<div class="passo"><div class="passo-titulo"><span class="passo-num">2</span>O que você viu neste km?</div>' + blocoFicha + "</div>"
    + '<div class="passo"><div class="passo-titulo"><span class="passo-num">3</span>Gravidade</div><div class="linha-gravidade">' + botoesGravidade + "</div></div>"
    + '<div class="passo"><div class="passo-titulo"><span class="passo-num">4</span>Observação'
    + (observacaoObrigatoria(s) ? "" : ' <span class="rotulo-mini">(opcional · vai nas OBSERVAÇÕES da ficha)</span>') + "</div>"
    + '<textarea class="input" id="campo-observacao" rows="3" maxlength="800" placeholder="Ex.: buraco grande no meio da pista, sentido Palmas, carro desviando pela contramão">' + esc(s.observacao) + "</textarea></div>"
    + (s.msgErro ? '<div class="banner-err">' + esc(s.msgErro) + "</div>" : "")
    + '<button class="btn btn-primary btn-grande" id="btn-enviar"' + (podeEnviar ? "" : " disabled") + ">"
    + (s.enviando ? (s.progresso || "Enviando…") : (semSinal() ? "Guardar alerta" : "Enviar alerta")) + "</button>"
    + (falta.length && !s.enviando ? '<div class="falta">Falta: ' + falta.join(", ") + "</div>" : "")
    + "</div>";

  ligarEventosAlerta(m);
  agendarRascunho();
}

function ligarBotaoFila(m) {
  const b = m.querySelector("#btn-processar-fila");
  if (b) b.addEventListener("click", () => processarFila());
}

function ligarEventosAlerta(m) {
  const s = alertaState;
  const abrirCamera = () => abrirCameraContinua(); // câmera do app (js/camera.js); sem suporte, cai na do celular
  const bTirar = m.querySelector("#btn-tirar-foto"); if (bTirar) bTirar.addEventListener("click", abrirCamera);
  const bMais = m.querySelector("#btn-mais-foto"); if (bMais) bMais.addEventListener("click", abrirCamera);
  m.querySelectorAll("[data-remover]").forEach((b) => b.addEventListener("click", () => {
    const f = s.fotos.find((x) => x.id === b.dataset.remover);
    if (f) URL.revokeObjectURL(f.url);
    s.fotos = s.fotos.filter((x) => x.id !== b.dataset.remover);
    removerFotoRascunho(b.dataset.remover).catch((erro) => console.error("Não consegui tirar a foto do rascunho:", erro));
    if (!s.fotos.length) { s.capturadoEm = null; limparRascunhoSemFalhar(); }
    renderAlerta();
  }));
  const bCorrigir = m.querySelector("#btn-corrigir-local"); if (bCorrigir) bCorrigir.addEventListener("click", () => { s.manual = true; renderAlerta(); });
  const bGps = m.querySelector("#btn-tentar-gps"); if (bGps) bGps.addEventListener("click", () => lerGps());
  const selR = m.querySelector("#sel-regiao"); if (selR) selR.addEventListener("change", (e) => { s.regiao = e.target.value; s.trecho = ""; limparKm(); renderAlerta(); });
  const selT = m.querySelector("#sel-trecho"); if (selT) selT.addEventListener("change", (e) => { s.trecho = e.target.value; recalcularKmNoTrecho(); renderAlerta(); });
  m.querySelectorAll("[data-tipo-ficha]").forEach((b) => b.addEventListener("click", () => {
    if (s.tipoFicha === b.dataset.tipoFicha) return;
    s.tipoFicha = b.dataset.tipoFicha;
    s.itens = s.itens.outro ? { outro: s.itens.outro } : {}; // os grupos de uma ficha não existem na outra
    renderAlerta();
  }));
  // tocar de novo na mesma opção desmarca (é "uma X por grupo", igual à ficha)
  m.querySelectorAll("[data-grupo]").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.grupo, c = b.dataset.codigo;
    if (s.itens[g] === c) delete s.itens[g]; else s.itens[g] = c;
    renderAlerta();
  }));
  m.querySelectorAll("[data-gravidade]").forEach((b) => b.addEventListener("click", () => { s.gravidade = b.dataset.gravidade; renderAlerta(); }));
  const obs = m.querySelector("#campo-observacao");
  if (obs) obs.addEventListener("input", (e) => {
    const antes = s.observacao.trim().length >= 5;
    s.observacao = e.target.value;
    agendarRascunho();
    // só redesenha quando muda o "pode enviar", senão o teclado do celular fecha a cada letra
    if (antes !== (s.observacao.trim().length >= 5)) {
      const pos = e.target.selectionStart;
      renderAlerta();
      const novo = document.getElementById("campo-observacao");
      if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
    }
  });
  const bEnviar = m.querySelector("#btn-enviar"); if (bEnviar) bEnviar.addEventListener("click", enviarAlertaDaTela);
  const bNome = m.querySelector("#btn-salvar-nome");
  if (bNome) {
    const salvar = () => { const v = m.querySelector("#campo-nome").value; if (v.trim().length >= 2) { definirNome(v); renderAlerta(); } };
    bNome.addEventListener("click", salvar);
    m.querySelector("#campo-nome").addEventListener("keydown", (e) => { if (e.key === "Enter") salvar(); });
  }
  ligarBotaoFila(m);
}

// Fotos novas — da câmera do app (js/camera.js) ou da câmera do celular (input).
// Cada uma já vai pro rascunho no celular; a 1ª dispara a leitura do GPS.
function adicionarFotos(arquivos) {
  if (!arquivos.length) return;
  const s = alertaState;
  const eraPrimeira = !s.fotos.length;
  for (const file of arquivos) {
    const foto = { id: "f" + Date.now() + Math.random().toString(36).slice(2, 7), file, url: URL.createObjectURL(file) };
    s.fotos.push(foto);
    salvarFotoRascunho(foto.id, file).catch((erro) => console.error("Não consegui guardar a foto no rascunho do celular:", erro));
  }
  if (eraPrimeira) {
    s.capturadoEm = new Date().toISOString();
    lerGps();
  } else {
    renderAlerta();
  }
}

document.addEventListener("change", (e) => {
  if (e.target.id !== "input-foto") return;
  const arquivos = Array.from(e.target.files || []);
  e.target.value = "";
  adicionarFotos(arquivos);
});

// ---- Rascunho (js/fila.js): o formulário sobrevive a sair da tela ----
const CAMPOS_RASCUNHO = ["capturadoEm", "gps", "regiao", "trecho", "sre", "km", "extensaoKm", "distancia", "manual",
  "situacao", "fichaDoSre", "tipoFicha", "itens", "gravidade", "observacao"];
let _timerRascunho = null;

function agendarRascunho() {
  clearTimeout(_timerRascunho);
  _timerRascunho = setTimeout(gravarEstadoRascunho, 400);
}

function gravarEstadoRascunho() {
  const s = alertaState;
  if (!s.fotos.length || s.msgOk || s.enviando) return; // sem foto não tem alerta começado
  const estado = {};
  for (const c of CAMPOS_RASCUNHO) estado[c] = s[c];
  salvarEstadoRascunho(estado).catch((erro) => console.error("Não consegui guardar o rascunho:", erro));
}

function limparRascunhoSemFalhar() {
  clearTimeout(_timerRascunho);
  return limparRascunho().catch((erro) => console.error("Não consegui limpar o rascunho do celular:", erro));
}

// Ao abrir o app: devolve o alerta que ficou pela metade (fotos + o que já tinha sido marcado)
async function recuperarRascunho() {
  let itens;
  try { itens = await listarRascunho(); } catch (erro) { console.error("Não consegui ler o rascunho:", erro); return; }
  const fotos = itens.filter((i) => i.file);
  if (!fotos.length) { if (itens.length) limparRascunhoSemFalhar(); return; }
  const s = alertaState;
  const reg = itens.find((i) => i.id === ID_ESTADO_RASCUNHO);
  if (reg && reg.estado) for (const c of CAMPOS_RASCUNHO) if (reg.estado[c] !== undefined) s[c] = reg.estado[c];
  s.fotos = fotos.map((f) => ({ id: f.id, file: f.file, url: URL.createObjectURL(f.file) }));
  s.capturadoEm = s.capturadoEm || new Date().toISOString();
  s.avisoRascunho = fotos.length === 1
    ? "Recuperei 1 foto que ainda não tinha sido enviada."
    : "Recuperei " + fotos.length + " fotos que ainda não tinham sido enviadas.";
  // local já tinha sido lido antes de sair: não lê de novo (a pessoa pode ter andado)
  if (!s.regiao && !s.gps) lerGps(); else renderAlerta();
}

// troca de app / tela bloqueada: grava na hora, sem esperar o intervalo
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") gravarEstadoRascunho(); });
window.addEventListener("pagehide", gravarEstadoRascunho);

function limparKm() {
  Object.assign(alertaState, { sre: "", km: null, extensaoKm: null, distancia: null, situacao: "", fichaDoSre: "" });
}

function aplicarKm(achado) {
  const s = alertaState;
  Object.assign(s, { sre: achado.sre, km: achado.km, extensaoKm: achado.extensaoKm, distancia: achado.distancia, situacao: achado.situacao, fichaDoSre: achado.ficha });
  // o tipo de ficha segue o S.R.E.; se mudou, as marcações da outra ficha não valem
  if (achado.ficha && achado.ficha !== s.tipoFicha) {
    s.tipoFicha = achado.ficha;
    s.itens = s.itens.outro ? { outro: s.itens.outro } : {};
  }
}

// Sem nada da ficha marcado (só "fora da ficha"), a observação é que explica o problema
function observacaoObrigatoria(s) {
  return !!s.itens.outro && Object.keys(s.itens).length === 1;
}

function htmlItensFicha(s) {
  const tipo = s.tipoFicha || "pav";
  const ficha = FICHAS[tipo];
  const seletorTipo = '<div class="seletor-ficha">'
    + Object.keys(FICHAS).map((k) =>
      '<button class="seg' + (k === tipo ? " ativo" : "") + '" data-tipo-ficha="' + k + '">' + esc(FICHAS[k].nome) + "</button>").join("")
    + "</div>"
    + '<div class="rotulo-mini">' + (!s.situacao ? "Escolha o tipo de ficha. "
      : s.fichaDoSre && s.fichaDoSre !== tipo ? "<b>Atenção:</b> o S.R.E. é " + esc(s.situacao) + " (ficha " + esc(FICHAS[s.fichaDoSre].nome.toLowerCase()) + "), você trocou à mão. "
      : "Ficha " + esc(ficha.nome.toLowerCase()) + " pela situação do S.R.E. (" + esc(s.situacao) + "). ")
    + "Marque só o que está ruim — no máximo uma opção por grupo, igual à ficha.</div>";
  const grupos = ficha.grupos.map((g) =>
    '<div class="grupo-ficha"><div class="grupo-ficha-nome">' + esc(g.nome) + "</div><div class=\"chips-opcoes\">"
    + g.opcoes.map((o) =>
      '<button class="chip-opcao chip-ficha' + (s.itens[g.id] === o.c ? " ativo" : "") + '" data-grupo="' + g.id + '" data-codigo="' + esc(o.c) + '">'
      + "<span>" + esc(o.t) + "</span>" + (o.d ? "<small>" + esc(o.d) + "</small>" : "") + "</button>").join("")
    + "</div></div>"
  ).join("");
  const fora = '<div class="grupo-ficha"><div class="grupo-ficha-nome">Fora da ficha <span class="rotulo-mini">(vai nas observações)</span></div><div class="chips-opcoes">'
    + FORA_DA_FICHA.map((o) =>
      '<button class="chip-opcao' + (s.itens.outro === o ? " ativo" : "") + '" data-grupo="outro" data-codigo="' + esc(o) + '">' + esc(o) + "</button>").join("")
    + "</div></div>";
  return seletorTipo + grupos + fora;
}

// Corrigiu o trecho à mão: se tem GPS, acha o S.R.E./km dentro do trecho escolhido
function recalcularKmNoTrecho() {
  const s = alertaState;
  limparKm();
  if (!s.gps || !s.trecho) return;
  const achado = localizarNoSre(s.gps.lat, s.gps.lng, s.trecho);
  if (achado && achado.distancia <= DISTANCIA_MAXIMA_M) aplicarKm(achado);
}

function nomeTrechoPorSre(sre) {
  const seg = SEGMENTOS_GEO.find((x) => (x.sre || "").replace(/\s/g, "").toUpperCase() === sre);
  return seg ? seg.trecho : "";
}

async function lerGps() {
  const s = alertaState;
  s.localizando = true; s.gpsErro = "";
  renderAlerta();
  const coords = await obterCoordenadasReais();
  s.localizando = false;
  s.gps = coords;
  if (!coords) {
    s.gpsErro = "Não consegui a localização (GPS desligado ou permissão negada). Escolha a região e o trecho.";
    s.manual = true;
    renderAlerta();
    return;
  }
  const achado = localizarNoSre(coords.lat, coords.lng);
  if (achado && achado.distancia <= DISTANCIA_MAXIMA_M) {
    s.regiao = achado.regiao; s.trecho = achado.trecho || nomeTrechoPorSre(achado.sre); s.manual = false;
    aplicarKm(achado);
  } else {
    s.gpsErro = "Nenhuma rodovia do contrato perto daqui (a mais próxima está a " + (achado ? (achado.distancia / 1000).toFixed(1) : "?") + " km). Escolha à mão.";
    s.manual = true;
  }
  renderAlerta();
  procurarAlertasProximos(coords.lat, coords.lng);
}

async function procurarAlertasProximos(lat, lng) {
  if (semSinal()) return;
  try {
    if (!alertasAbertosCache) {
      alertasAbertosCache = (await apiListarAlertas())
        .filter((a) => ["novo", "visto", "em_andamento"].includes(a.status) && a.gps_lat != null);
    }
    alertaState.proximos = alertasAbertosCache
      .map((a) => Object.assign({}, a, { distancia: distanciaMetros(lat, lng, Number(a.gps_lat), Number(a.gps_lng)) }))
      .filter((a) => a.distancia <= RAIO_ALERTA_PROXIMO_M)
      .sort((a, b) => a.distancia - b.distancia);
    renderAlerta();
  } catch (erro) {
    console.error("Não consegui checar alertas próximos:", erro); // não impede o envio
  }
}

async function enviarAlertaDaTela() {
  const s = alertaState;
  s.enviando = true; s.msgErro = ""; s.progresso = "";
  renderAlerta();
  const item = {
    id: crypto.randomUUID(), // gerado aqui: reenviar o mesmo alerta nunca duplica
    fotos: s.fotos.map((f) => f.file),
    capturadoEm: s.capturadoEm || new Date().toISOString(),
    gpsLat: s.gps ? s.gps.lat : null, gpsLng: s.gps ? s.gps.lng : null,
    regiao: s.regiao, trecho: s.trecho, sre: s.sre, kmSre: s.km, extensaoKm: s.extensaoKm, distanciaEixo: s.distancia,
    tipoFicha: s.tipoFicha || "pav", itens: Object.assign({}, s.itens), categoria: resumoItens(s.itens),
    gravidade: s.gravidade, observacao: s.observacao.trim(),
    autorNome: NOME_USUARIO, dispositivo: DISPOSITIVO
  };

  const guardar = async () => {
    await salvarNaFila(item);
    await limparRascunhoSemFalhar(); // as fotos já estão na fila, o rascunho não precisa mais segurar
    await atualizarContagemFila();
    s.enviando = false;
    s.msgOk = "Alerta guardado no celular";
    s.fotos.forEach((f) => URL.revokeObjectURL(f.url));
    renderAlerta();
  };

  if (semSinal()) { await guardar(); return; }

  try {
    await enviarAlerta(item, (txt) => { s.progresso = txt; renderAlerta(); });
    await limparRascunhoSemFalhar();
    s.enviando = false;
    s.msgOk = "Alerta enviado";
    s.fotos.forEach((f) => URL.revokeObjectURL(f.url));
    alertasAbertosCache = null;
    renderAlerta();
    atualizarSeloPainel();
  } catch (erro) {
    if (pareceErroDeRede(erro)) { await guardar(); return; }
    console.error(erro);
    s.enviando = false;
    s.msgErro = "Não foi possível enviar: " + (erro.message || erro);
    renderAlerta();
  }
}

// Sobe as fotos e grava a linha. Idempotente: o id e os caminhos são fixos,
// então rodar de novo depois de uma queda no meio não duplica nada.
async function enviarAlerta(item, aoProgredir) {
  const dia = item.capturadoEm.slice(0, 10);
  const pasta = (item.regiao || "sem-regiao") + "/" + trechoCurto(item.trecho) + "/" + dia + "/" + item.id;
  const caminhos = [];
  for (let i = 0; i < item.fotos.length; i++) {
    if (aoProgredir) aoProgredir("Enviando foto " + (i + 1) + " de " + item.fotos.length + "…");
    // o servidor só aceita JPEG: a foto sempre passa pelo carimbo (que também converte)
    let arquivo;
    try {
      arquivo = await prepararFotoAlerta(item.fotos[i], item);
    } catch (erro) {
      console.error("Não consegui processar a foto:", erro);
      throw new Error("não consegui abrir a foto " + (i + 1) + " (formato não suportado?). Tire de novo pela câmera do app.");
    }
    const caminho = pasta + "/" + (i + 1) + ".jpg";
    // se a foto já subiu numa tentativa anterior (o sinal caiu depois), o
    // servidor não sobrescreve e responde ok
    await apiEnviarFoto(caminho, arquivo);
    caminhos.push(caminho);
  }
  if (aoProgredir) aoProgredir("Registrando o alerta…");
  // reenviar o mesmo id não duplica: o servidor responde ok com jaExistia
  await apiCriarAlerta({
    id: item.id,
    regiao: item.regiao || null, trecho: item.trecho || null, sre: item.sre || null,
    km_sre: typeof item.kmSre === "number" ? Math.round(item.kmSre * 1000) / 1000 : null,
    distancia_eixo_m: typeof item.distanciaEixo === "number" ? Math.round(item.distanciaEixo) : null,
    gps_lat: item.gpsLat, gps_lng: item.gpsLng,
    tipo_ficha: item.tipoFicha, itens: item.itens || {},
    categoria: item.categoria, gravidade: item.gravidade, observacao: item.observacao || null,
    fotos: caminhos, capturado_em: item.capturadoEm,
    autor_nome: item.autorNome || null, dispositivo: item.dispositivo || null
  });
}

async function atualizarContagemFila() {
  try { filaState.total = (await listarFila()).length; } catch (e) { filaState.total = 0; }
}

async function processarFila() {
  if (filaState.processando || semSinal()) return;
  const itens = await listarFila();
  if (!itens.length) { filaState.total = 0; return; }
  filaState.processando = true; filaState.msg = "";
  renderAlerta();
  let ok = 0;
  for (const item of itens) {
    try {
      await enviarAlerta(item);
      await removerDaFila(item.id);
      ok++;
    } catch (erro) {
      console.error("Alerta da fila não subiu (fica pra próxima):", erro);
      if (pareceErroDeRede(erro)) break;
    }
  }
  filaState.processando = false;
  await atualizarContagemFila();
  if (ok) {
    filaState.msg = ok + (ok === 1 ? " alerta guardado foi enviado." : " alertas guardados foram enviados.");
    alertasAbertosCache = null;
    atualizarSeloPainel();
  }
  renderAlerta();}

window.addEventListener("online", () => { renderAlerta(); processarFila(); });
window.addEventListener("offline", () => renderAlerta());
