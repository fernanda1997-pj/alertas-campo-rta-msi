// "Painel" (escritório, só quem está em alertas_admins): todos os alertas no
// mapa e em lista, com filtro, e a ficha de cada um pra mudar o status,
// responder ao campo e anotar se virou ponto crítico.

let painelState = {
  carregou: false, carregando: false, erro: "",
  lista: [], urls: {},
  filtroStatus: "abertos", filtroRegiao: "", filtroGravidade: "", filtroCategoria: "", filtroSre: "", filtroMes: "", ordem: "triagem",
  aberto: null, salvando: false, msgFicha: ""
};
let mapaPainel = null, camadaMarcadores = null;

const STATUS_ABERTOS = ["novo", "visto", "em_andamento"];

async function carregarPainel() {
  painelState.carregando = true; painelState.erro = "";
  renderPainel();
  try {
    const { data, error } = await supabaseClient.from("alertas").select("*").order("created_at", { ascending: false }).limit(2000);
    if (error) throw error;
    painelState.lista = data || [];
    painelState.carregou = true;
  } catch (erro) {
    console.error(erro);
    painelState.erro = "Não consegui carregar os alertas: " + (erro.message || erro);
  }
  painelState.carregando = false;
  renderPainel();
  atualizarSeloPainel();
}

function alertasFiltrados() {
  const s = painelState;
  return s.lista.filter((a) =>
    (s.filtroStatus === "todos" || (s.filtroStatus === "abertos" ? STATUS_ABERTOS.includes(a.status) : a.status === s.filtroStatus))
    && (!s.filtroRegiao || a.regiao === s.filtroRegiao)
    && (!s.filtroGravidade || a.gravidade === s.filtroGravidade)
    && (!s.filtroCategoria || !!(a.itens || {})[s.filtroCategoria])
    && (!s.filtroMes || (a.capturado_em || "").slice(0, 7) === s.filtroMes)
    && (!s.filtroSre || (a.sre || "").includes(s.filtroSre.trim().toUpperCase()))
  );
}

// Abertos primeiro por gravidade (urgente no topo), depois os mais antigos —
// o que está parado há mais tempo é o que mais precisa de atenção.
function ordenarParaTriagem(lista) {
  const pesoGrav = { urgente: 0, media: 1, baixa: 2 };
  return lista.slice().sort((a, b) => {
    const abertoA = STATUS_ABERTOS.includes(a.status) ? 0 : 1, abertoB = STATUS_ABERTOS.includes(b.status) ? 0 : 1;
    if (abertoA !== abertoB) return abertoA - abertoB;
    if (abertoA === 0) {
      const g = (pesoGrav[a.gravidade] ?? 3) - (pesoGrav[b.gravidade] ?? 3);
      if (g) return g;
      return new Date(a.created_at) - new Date(b.created_at);
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function renderPainel() {
  const m = document.getElementById("mount-painel");
  if (!m) return;
  const s = painelState;
  const contagem = {};
  for (const a of s.lista) contagem[a.status] = (contagem[a.status] || 0) + 1;
  const abertos = s.lista.filter((a) => STATUS_ABERTOS.includes(a.status)).length;

  const chip = (id, rotulo, n, cor) =>
    '<button class="chip-contagem' + (s.filtroStatus === id ? " ativo" : "") + '" data-filtro-status="' + id + '"' + (cor ? ' style="--cor:' + cor + '"' : "") + ">"
    + '<span class="chip-contagem-n">' + n + "</span>" + esc(rotulo) + "</button>";
  const chips = chip("abertos", "Abertos", abertos)
    + STATUS.map((st) => chip(st.id, st.rotulo, contagem[st.id] || 0, st.cor)).join("")
    + chip("todos", "Todos", s.lista.length);

  const lista = s.ordem === "sre" ? ordenarPorSreKm(alertasFiltrados()) : ordenarParaTriagem(alertasFiltrados());
  // a ficha é mensal: só os meses que têm alerta, do mais recente pro mais antigo
  const meses = [...new Set(s.lista.map((a) => (a.capturado_em || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const linhas = lista.map((a) =>
    '<button class="linha-alerta' + (s.aberto && s.aberto.id === a.id ? " ativo" : "") + '" data-abrir="' + a.id + '">'
    + '<div class="linha-alerta-topo">' + seloStatus(a.status) + seloGravidade(a.gravidade) + '<span class="rotulo-mini" style="margin-left:auto;">' + tempoDesde(a.created_at) + "</span></div>"
    + "<b>" + esc(a.categoria) + "</b>"
    + '<div class="rotulo-mini">' + esc(rotuloRegiao(a.regiao)) + (a.trecho ? " › " + esc(a.trecho) : "") + "</div>"
    + (a.sre ? '<div class="km-sre">' + esc(textoSreKmDoAlerta(a)) + "</div>" : "")
    + '<div class="obs obs-curta">' + esc(a.observacao) + "</div>"
    + '<div class="rotulo-mini">' + esc(a.autor_email || "") + "</div>"
    + "</button>"
  ).join("");

  m.innerHTML = '<div class="painel-tela">'
    + '<div class="painel-toolbar">'
    + '<div class="chips-contagem">' + chips + "</div>"
    + '<div class="painel-filtros">'
    + '<select class="input input-mini" id="f-regiao"><option value="">Todas as regiões</option>' + opts(Object.keys(REGIOES), s.filtroRegiao, rotuloRegiao) + "</select>"
    + '<select class="input input-mini" id="f-gravidade"><option value="">Qualquer gravidade</option>' + GRAVIDADES.map((g) => '<option value="' + g.id + '"' + (s.filtroGravidade === g.id ? " selected" : "") + ">" + esc(g.rotulo) + "</option>").join("") + "</select>"
    + '<select class="input input-mini" id="f-mes"><option value="">Todos os meses</option>' + opts(meses, s.filtroMes, rotuloMes) + "</select>"
    + '<select class="input input-mini" id="f-categoria"><option value="">Qualquer item da ficha</option>'
    + TODOS_GRUPOS.map((g) => '<option value="' + g.id + '"' + (s.filtroCategoria === g.id ? " selected" : "") + ">" + esc(g.nome) + "</option>").join("")
    + '<option value="outro"' + (s.filtroCategoria === "outro" ? " selected" : "") + ">Fora da ficha</option></select>"
    + '<input class="input input-mini" id="f-sre" placeholder="S.R.E. (ex.: 201ETO0270)" value="' + esc(s.filtroSre) + '" style="width:190px;">'
    + '<select class="input input-mini" id="f-ordem"><option value="triagem"' + (s.ordem === "triagem" ? " selected" : "") + '>Ordem: urgentes primeiro</option><option value="sre"' + (s.ordem === "sre" ? " selected" : "") + ">Ordem: S.R.E. e km (ficha)</option></select>"
    + '<button class="btn btn-primary btn-mini" id="btn-ficha" title="Uma linha por S.R.E. e km, com o que marcar em cada grupo da ficha (usa os filtros da tela)">Linhas da ficha (CSV)</button>'
    + '<button class="btn btn-outline btn-mini" id="btn-csv">Alertas (CSV)</button>'
    + '<button class="btn btn-outline btn-mini" id="btn-recarregar-painel"' + (s.carregando ? " disabled" : "") + ">" + (s.carregando ? "Carregando…" : "Recarregar") + "</button>"
    + "</div></div>"
    + (s.erro ? '<div class="banner-err" style="margin:12px;">' + esc(s.erro) + "</div>" : "")
    + '<div class="painel-corpo">'
    + '<div class="painel-mapa" id="mapa-painel"></div>'
    + '<div class="painel-lista">' + (linhas || '<div class="vazio-msg">' + (s.carregou ? "Nenhum alerta com esse filtro." : "") + "</div>") + "</div>"
    + "</div></div>"
    + (s.aberto ? htmlFicha(s.aberto) : "");

  m.querySelectorAll("[data-filtro-status]").forEach((b) => b.addEventListener("click", () => { s.filtroStatus = b.dataset.filtroStatus; renderPainel(); }));
  m.querySelector("#f-regiao").addEventListener("change", (e) => { s.filtroRegiao = e.target.value; renderPainel(); });
  m.querySelector("#f-gravidade").addEventListener("change", (e) => { s.filtroGravidade = e.target.value; renderPainel(); });
  m.querySelector("#f-categoria").addEventListener("change", (e) => { s.filtroCategoria = e.target.value; renderPainel(); });
  m.querySelector("#f-ordem").addEventListener("change", (e) => { s.ordem = e.target.value; renderPainel(); });
  m.querySelector("#f-sre").addEventListener("change", (e) => { s.filtroSre = e.target.value; renderPainel(); });
  m.querySelector("#btn-recarregar-painel").addEventListener("click", carregarPainel);
  m.querySelector("#btn-csv").addEventListener("click", () => baixarCsv(lista));
  m.querySelector("#btn-ficha").addEventListener("click", () => baixarLinhasFicha(lista));
  m.querySelector("#f-mes").addEventListener("change", (e) => { s.filtroMes = e.target.value; renderPainel(); });
  m.querySelectorAll("[data-abrir]").forEach((b) => b.addEventListener("click", () => abrirFicha(b.dataset.abrir)));
  if (s.aberto) ligarFicha(m);

  desenharMapa(lista);
}

// Pra preencher a ficha: agrupa por S.R.E. e segue o km do INÍCIO pro FIM
function ordenarPorSreKm(lista) {
  return lista.slice().sort((a, b) =>
    (a.sre || "~").localeCompare(b.sre || "~") || (Number(a.km_sre) || 0) - (Number(b.km_sre) || 0));
}

function desenharMapa(lista) {
  const div = document.getElementById("mapa-painel");
  if (!div || typeof L === "undefined") return;
  // o innerHTML do painel recria a div a cada render — o mapa precisa ser recriado junto
  if (mapaPainel) { mapaPainel.remove(); mapaPainel = null; }
  mapaPainel = L.map(div, { zoomControl: true });
  const ruas = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
  const satelite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "© Esri" });
  ruas.addTo(mapaPainel);
  L.control.layers({ "Mapa": ruas, "Satélite": satelite }, null, { position: "topright" }).addTo(mapaPainel);

  // trechos do contrato, bem clarinhos, só pra dar referência
  const linhas = SEGMENTOS_GEO.map((seg) => seg.pontos.map((p) => [p[1], p[0]]));
  L.polyline(linhas, { color: "#1E3A72", weight: 2, opacity: 0.35, interactive: false }).addTo(mapaPainel);

  camadaMarcadores = L.layerGroup().addTo(mapaPainel);
  const pontos = [];
  for (const a of lista) {
    if (a.gps_lat == null || a.gps_lng == null) continue;
    const ll = [Number(a.gps_lat), Number(a.gps_lng)];
    pontos.push(ll);
    const cor = getComputedStyle(document.documentElement).getPropertyValue(statusPorId(a.status).cor.replace(/^var\((.*)\)$/, "$1")).trim() || "#DC2626";
    L.circleMarker(ll, {
      radius: a.gravidade === "urgente" ? 10 : 7, color: "#fff", weight: 2, fillColor: cor, fillOpacity: 0.95
    }).bindTooltip(esc(a.categoria) + " · " + esc(statusPorId(a.status).rotulo))
      .on("click", () => abrirFicha(a.id))
      .addTo(camadaMarcadores);
  }
  if (pontos.length) mapaPainel.fitBounds(pontos, { padding: [30, 30], maxZoom: 13 });
  else mapaPainel.setView([-8.5, -48.3], 6); // Tocantins
}

async function abrirFicha(id) {
  const s = painelState;
  const a = s.lista.find((x) => x.id === id);
  if (!a) return;
  s.aberto = Object.assign({}, a);
  s.msgFicha = "";
  const faltam = a.fotos.filter((c) => !s.urls[c]);
  if (faltam.length) Object.assign(s.urls, await urlsAssinadas(faltam));
  // abrir um alerta novo já marca como "visto" — o campo vê que alguém olhou
  if (a.status === "novo") {
    const agora = new Date().toISOString();
    const { error } = await supabaseClient.from("alertas").update({ status: "visto", tratado_por: USUARIO_ATUAL.email, tratado_em: agora }).eq("id", id);
    if (!error) {
      Object.assign(a, { status: "visto", tratado_por: USUARIO_ATUAL.email, tratado_em: agora });
      s.aberto = Object.assign({}, a);
      atualizarSeloPainel();
    }
  }
  renderPainel();
}

function htmlFicha(a) {
  const s = painelState;
  const fotos = a.fotos.map((c) => s.urls[c]
    ? '<a href="' + esc(s.urls[c]) + '" target="_blank" rel="noopener"><img src="' + esc(s.urls[c]) + '" alt=""></a>'
    : '<div class="ficha-foto-vazia">foto indisponível</div>').join("");
  const temCoord = a.gps_lat != null && a.gps_lng != null;
  const botoesStatus = STATUS.map((st) =>
    '<button class="btn-status' + (a.status === st.id ? " ativo" : "") + '" data-status="' + st.id + '" style="--cor:' + st.cor + '">' + esc(st.rotulo) + "</button>"
  ).join("");
  return '<div class="ficha-fundo" id="ficha-fundo"></div>'
    + '<div class="ficha" role="dialog" aria-label="Alerta">'
    + '<div class="ficha-topo"><b>' + esc(a.categoria) + "</b>" + seloGravidade(a.gravidade) + '<button class="btn btn-ghost" id="btn-fechar-ficha" aria-label="Fechar">✕</button></div>'
    + '<div class="ficha-corpo">'
    + '<div class="ficha-fotos">' + (fotos || '<div class="ficha-foto-vazia">sem foto</div>') + "</div>"
    + '<div class="obs">' + esc(a.observacao) + "</div>"
    + '<div class="ficha-dados">'
    + "<div><span>Local</span>" + esc(rotuloRegiao(a.regiao)) + (a.trecho ? " › " + esc(a.trecho) : "") + (a.sre ? " · SRE " + esc(a.sre) : "") + "</div>"
    + (a.sre ? "<div><span>Ficha de inspeção</span><b>" + esc(textoSreKmDoAlerta(a)) + "</b>" + (a.distancia_eixo_m != null ? " · " + a.distancia_eixo_m + " m do eixo" : "") + "</div>" : "")
    + "<div><span>Marcar na ficha</span>" + esc(textoItensFicha(a)) + "</div>"
    + "<div><span>Coordenada</span>" + (temCoord ? Number(a.gps_lat).toFixed(5) + ", " + Number(a.gps_lng).toFixed(5)
      + ' · <a href="https://www.google.com/maps?q=' + a.gps_lat + "," + a.gps_lng + '" target="_blank" rel="noopener">abrir no Google Maps</a>' : "sem GPS") + "</div>"
    + "<div><span>Registrado</span>" + fmtDataHora(a.capturado_em) + " por " + esc(a.autor_email || "?") + "</div>"
    + (a.tratado_por ? "<div><span>Último tratamento</span>" + esc(a.tratado_por) + " · " + fmtDataHora(a.tratado_em) + "</div>" : "")
    + "</div>"
    + '<div class="field"><label>Status</label><div class="linha-status">' + botoesStatus + "</div></div>"
    + '<div class="field"><label>Resposta pro campo <span class="rotulo-mini">(aparece em "Meus alertas" de quem mandou)</span></label>'
    + '<textarea class="input" id="ficha-resposta" rows="2" maxlength="600" placeholder="Ex.: equipe de tapa-buraco vai na quinta">' + esc(a.resposta || "") + "</textarea></div>"
    + '<div class="field"><label>Virou ponto crítico? <span class="rotulo-mini">(opcional)</span></label>'
    + '<input class="input" id="ficha-pc" maxlength="60" placeholder="Ex.: R1 nº 184" value="' + esc(a.ponto_critico || "") + '"></div>'
    + (s.msgFicha ? '<div class="' + (s.msgFicha.startsWith("Erro") ? "banner-err" : "banner-ok") + '">' + esc(s.msgFicha) + "</div>" : "")
    + "</div>"
    + '<div class="ficha-rodape"><button class="btn btn-primary btn-grande" id="btn-salvar-ficha"' + (s.salvando ? " disabled" : "") + ">" + (s.salvando ? "Salvando…" : "Salvar") + "</button></div>"
    + "</div>";
}

function ligarFicha(m) {
  const s = painelState;
  const fechar = () => { s.aberto = null; renderPainel(); };
  m.querySelector("#btn-fechar-ficha").addEventListener("click", fechar);
  m.querySelector("#ficha-fundo").addEventListener("click", fechar);
  m.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => {
    s.aberto.resposta = m.querySelector("#ficha-resposta").value;
    s.aberto.ponto_critico = m.querySelector("#ficha-pc").value;
    s.aberto.status = b.dataset.status;
    renderPainel();
  }));
  m.querySelector("#btn-salvar-ficha").addEventListener("click", salvarFicha);
}

async function salvarFicha() {
  const s = painelState;
  const m = document.getElementById("mount-painel");
  const a = s.aberto;
  a.resposta = m.querySelector("#ficha-resposta").value.trim();
  a.ponto_critico = m.querySelector("#ficha-pc").value.trim();
  s.salvando = true; s.msgFicha = "";
  renderPainel();
  const mudancas = {
    status: a.status, resposta: a.resposta || null, ponto_critico: a.ponto_critico || null,
    tratado_por: USUARIO_ATUAL.email, tratado_em: new Date().toISOString()
  };
  const { error } = await supabaseClient.from("alertas").update(mudancas).eq("id", a.id);
  s.salvando = false;
  if (error) {
    s.msgFicha = "Erro ao salvar: " + error.message;
  } else {
    const original = s.lista.find((x) => x.id === a.id);
    Object.assign(original, mudancas);
    s.aberto = Object.assign({}, original);
    s.msgFicha = "Salvo.";
    atualizarSeloPainel();
  }
  renderPainel();
}

function faixaDoAlerta(a) {
  if (a.km_sre == null || !a.sre) return null;
  const info = SRE_KM.find((x) => x.s === a.sre);
  return faixaKm(Number(a.km_sre), info ? info.c / 1000 : null);
}

const numBR = (v) => v == null || v === "" ? "" : String(Math.round(Number(v) * 1000) / 1000).replace(".", ",");

// ponto-e-vírgula + BOM: o Excel em português abre direto com acento certo
function salvarCsv(nome, cabecalho, linhas) {
  const celula = (v) => {
    const t = v == null ? "" : String(v);
    return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const texto = "\uFEFF" + [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome + "_" + new Date().toISOString().slice(0, 10) + ".csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Um alerta por linha, com uma coluna por grupo da ficha (código da coluna marcada)
function baixarCsv(lista) {
  const col = ["created_at", "capturado_em", "status", "gravidade", "tipo_ficha", "categoria", "regiao", "trecho", "sre", "km_sre", "faixa_km", "distancia_eixo_m", "gps_lat", "gps_lng", "observacao", "resposta", "ponto_critico", "autor_email", "tratado_por", "tratado_em"];
  const cab = col.concat(TODOS_GRUPOS.map((g) => g.id), ["fora_da_ficha"]);
  const linhas = lista.map((a) => {
    const f = faixaDoAlerta(a);
    return col.map((c) => c === "faixa_km" ? (f ? f.ini + "-" + numBR(f.fim) : "") : c === "km_sre" ? numBR(a.km_sre) : a[c])
      .concat(TODOS_GRUPOS.map((g) => (a.itens || {})[g.id] || ""), [(a.itens || {}).outro || ""]);
  });
  salvarCsv("alertas", cab, linhas);
}

// No formato da Ficha de Inspeção: uma linha por S.R.E. + km (faixa de 1 km),
// com a coluna marcada em cada grupo. Vários alertas no mesmo km: vale o mais
// grave de cada grupo (a ficha pede o PREDOMINANTE) e as observações juntam.
// Só entram os km COM alerta — o resto da ficha continua sendo preenchido como hoje.
function baixarLinhasFicha(lista) {
  const linhas = new Map();
  for (const a of lista) {
    const f = faixaDoAlerta(a);
    if (!f) continue;
    const tipo = a.tipo_ficha || "pav";
    const chave = tipo + "|" + a.sre + "|" + f.ini;
    if (!linhas.has(chave)) linhas.set(chave, { tipo, a, f, itens: {}, obs: [], n: 0 });
    const l = linhas.get(chave);
    l.n++;
    for (const g of FICHAS[tipo].grupos) {
      const novo = (a.itens || {})[g.id];
      if (!novo) continue;
      const pos = (c) => g.opcoes.findIndex((o) => o.c === c);
      if (!l.itens[g.id] || pos(novo) > pos(l.itens[g.id])) l.itens[g.id] = novo;
    }
    const obs = [(a.itens || {}).outro, a.observacao].filter(Boolean).join(": ");
    if (obs) l.obs.push(obs);
  }
  const ordenadas = [...linhas.values()].sort((x, y) =>
    x.tipo.localeCompare(y.tipo) || parseInt(x.a.regiao.slice(1), 10) - parseInt(y.a.regiao.slice(1), 10)
    || x.a.sre.localeCompare(y.a.sre) || x.f.ini - y.f.ini);
  const cab = ["FICHA", "REGIÃO", "TRECHO", "S.R.E.", "INÍCIO (KM)", "FIM (KM)"]
    .concat(TODOS_GRUPOS.map((g) => g.nome.toUpperCase()), ["OBSERVAÇÕES", "Nº DE ALERTAS"]);
  salvarCsv("linhas_da_ficha", cab, ordenadas.map((l) =>
    [FICHAS[l.tipo].nome, rotuloRegiao(l.a.regiao), l.a.trecho, l.a.sre, l.f.ini, numBR(l.f.fim)]
      .concat(TODOS_GRUPOS.map((g) => l.itens[g.id] || ""), [l.obs.join(" | "), l.n])));
}

// Número de alertas "novo" no botão da aba — é o aviso pro escritório
function atualizarSeloPainel() {
  const b = document.getElementById("tabbtn-painel");
  if (!b || !EH_ADMIN) return;
  supabaseClient.from("alertas").select("id", { count: "exact", head: true }).eq("status", "novo")
    .then(({ count }) => { b.innerHTML = "Painel" + (count ? ' <span class="selo-novos">' + count + "</span>" : ""); });
}
