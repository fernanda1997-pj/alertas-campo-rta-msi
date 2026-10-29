// Painel › "Fichas percorridas": o que o campo já percorreu e avaliou na Ficha de
// Inspeção (aba Ficha do app), mês a mês — lista dos trechos com andamento e quem
// passou, o mapa com cada linha da ficha colorida pela avaliação, e o detalhe do
// trecho linha por linha. Lê todos os arquivos do mês no SharePoint (api/ficha.js,
// ?comp=) e junta igual à aba Ficha: em cada célula vale a marcação mais recente.

let fichasPainel = {
  comp: mesAtual(), carregando: false, erro: "", docs: null,
  filtroRegiao: "", grupo: "pior", // cor no mapa: pior condição da linha ou um grupo só
  aberto: null                      // "R1|pav|3" com o detalhe aberto
};

// Cores fixas (o mapa de fundo é sempre claro), iguais às do mapa de alertas
const COR_CONDICAO = { bom: "#16A34A", regular: "#F59E0B", ruim: "#DC2626" };
const ROTULO_CONDICAO = { bom: "Bom", regular: "Regular", ruim: "Ruim" };

async function carregarFichasPainel() {
  const st = fichasPainel;
  st.carregando = true; st.erro = "";
  renderPainel();
  try {
    st.docs = await apiLerFichasDoMes(st.comp);
  } catch (erro) {
    console.error(erro);
    st.erro = "Não consegui carregar as fichas: " + (erro.message || erro);
    st.docs = st.docs || [];
  }
  st.carregando = false;
  renderPainel();
}

// Condição de uma linha: a coluna marcada vira uma gravidade de 0 (a boa) a 1
// (a pior do grupo); bom = 0, regular = até a metade, ruim = passou da metade.
// grupo "pior" = a pior entre os grupos marcados. null = nada marcado.
function classeLinha(bloco, mk, grupo) {
  let sev = -1;
  for (const g of bloco.grupos) {
    if (grupo !== "pior" && g.id !== grupo) continue;
    const k = piorIndice(g, mk[g.id] && mk[g.id].c);
    if (k >= 0) sev = Math.max(sev, k / (g.rotulos.length - 1));
  }
  return sev < 0 ? null : sev === 0 ? "bom" : sev <= 0.5 ? "regular" : "ruim";
}

// Um item por trecho com alguma linha marcada no mês
function trechosPercorridos() {
  const st = fichasPainel;
  const porTrecho = {};
  for (const d of st.docs || []) (porTrecho[d.r + "|" + d.f + "|" + d.tr] = porTrecho[d.r + "|" + d.f + "|" + d.tr] || []).push(d);
  const saida = [];
  for (const [k, docs] of Object.entries(porTrecho)) {
    const [r, f, tr] = k.split("|");
    if (st.filtroRegiao && r !== st.filtroRegiao) continue;
    const bloco = blocoFicha(r, f);
    const trecho = bloco && bloco.trechos.find((t) => t.tr === tr);
    if (!trecho) continue;
    const marcas = juntarMarcacoes(docs);
    const linhas = linhasDoTrecho(trecho);
    let preenchidas = 0, completas = 0;
    const cont = { bom: 0, regular: 0, ruim: 0 };
    for (const l of linhas) {
      const mk = marcas[l.chave];
      const cls = mk && classeLinha(bloco, mk, "pior");
      if (!cls) continue;
      preenchidas++;
      if (bloco.grupos.every((g) => mk[g.id] && mk[g.id].c)) completas++;
      cont[cls]++;
    }
    if (!preenchidas) continue;
    saida.push({ k, r, f, tr, bloco, trecho, marcas, linhas, preenchidas, completas, cont,
      pessoas: [...new Set(docs.map((d) => d.nome).filter(Boolean))],
      atualizado: docs.map((d) => d.atualizado || "").sort().pop() });
  }
  return saida.sort((a, b) => b.atualizado.localeCompare(a.atualizado));
}

function htmlResumoCondicao(cont) {
  return '<div class="resumo-condicao">' + ["bom", "regular", "ruim"].filter((c) => cont[c])
    .map((c) => '<span style="--cor:' + COR_CONDICAO[c] + '"><i></i>' + cont[c] + " " + ROTULO_CONDICAO[c].toLowerCase() + "</span>").join("") + "</div>";
}

function renderPainelFichas(m) {
  const st = fichasPainel;
  const lista = st.docs ? trechosPercorridos() : [];
  const regioes = [...new Set(MODELO_FICHA.map((b) => b.r))];
  const grupos = [...FICHAS.pav.grupos, ...FICHAS.np.grupos];

  const cartoes = lista.map((t) => {
    const pct = Math.round(100 * t.preenchidas / t.linhas.length);
    return '<button class="linha-alerta' + (st.aberto === t.k ? " ativo" : "") + '" data-trecho-painel="' + esc(t.k) + '">'
      + '<div class="linha-alerta-topo"><b>' + esc(rotuloRegiao(t.r)) + " · Trecho " + esc(t.tr) + '</b><span class="rotulo-mini" style="margin-left:auto;">' + tempoDesde(t.atualizado) + "</span></div>"
      + '<div class="rotulo-mini">' + esc(t.trecho.tn) + " · " + esc(FICHAS[t.f].nome.toLowerCase()) + "</div>"
      + '<div class="ficha-progresso"><div class="barra"><i style="width:' + pct + '%"></i></div><span>' + t.preenchidas + " de " + t.linhas.length + " linhas (" + pct + "%)</span></div>"
      + htmlResumoCondicao(t.cont)
      + '<div class="rotulo-mini">Por: ' + esc(t.pessoas.join(", ") || "?") + "</div></button>";
  }).join("");

  m.innerHTML = '<div class="painel-tela">'
    + '<div class="painel-toolbar">' + htmlModoPainel()
    + '<div class="painel-filtros">'
    + '<input class="input input-mini" type="month" id="ff-mes" value="' + esc(st.comp) + '" title="Mês da ficha">'
    + '<select class="input input-mini" id="ff-regiao"><option value="">Todas as regiões</option>' + opts(regioes, st.filtroRegiao, rotuloRegiao) + "</select>"
    + '<select class="input input-mini" id="ff-grupo" title="O que a cor do mapa mostra"><option value="pior"' + (st.grupo === "pior" ? " selected" : "") + ">Cor no mapa: pior condição</option>"
    + grupos.map((g) => '<option value="' + g.id + '"' + (st.grupo === g.id ? " selected" : "") + ">Cor no mapa: " + esc(g.nome) + "</option>").join("") + "</select>"
    + '<button class="btn btn-outline btn-mini" id="ff-recarregar"' + (st.carregando ? " disabled" : "") + ">" + (st.carregando ? "Carregando…" : "Recarregar") + "</button>"
    + "</div></div>"
    + (st.erro ? '<div class="banner-err" style="margin:12px;">' + esc(st.erro) + "</div>" : "")
    + '<div class="painel-corpo">'
    + '<div class="painel-mapa" id="mapa-painel"></div>'
    + '<div class="painel-lista">' + (cartoes || '<div class="vazio-msg">' + (st.carregando ? "Carregando…" : st.docs ? "Ninguém preencheu ficha em " + esc(rotuloMes(st.comp)) + (st.filtroRegiao ? " nessa região" : "") + " ainda." : "") + "</div>") + "</div>"
    + "</div></div>"
    + (st.aberto ? htmlTrechoPainel(lista.find((t) => t.k === st.aberto)) : "");

  ligarModoPainel(m);
  m.querySelector("#ff-mes").addEventListener("change", (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { st.comp = e.target.value; st.aberto = null; carregarFichasPainel(); } });
  m.querySelector("#ff-regiao").addEventListener("change", (e) => { st.filtroRegiao = e.target.value; st.aberto = null; renderPainel(); });
  m.querySelector("#ff-grupo").addEventListener("change", (e) => { st.grupo = e.target.value; renderPainel(); });
  m.querySelector("#ff-recarregar").addEventListener("click", carregarFichasPainel);
  m.querySelectorAll("[data-trecho-painel]").forEach((b) => b.addEventListener("click", () => { st.aberto = b.dataset.trechoPainel; renderPainel(); }));
  const fechar = m.querySelector("#btn-fechar-trecho-painel");
  if (fechar) {
    const f = () => { st.aberto = null; renderPainel(); };
    fechar.addEventListener("click", f);
    m.querySelector("#fundo-trecho-painel").addEventListener("click", f);
    const t = lista.find((x) => x.k === st.aberto);
    m.querySelector("#btn-baixar-ficha-painel").addEventListener("click", (e) => baixarFichaXlsx(t.r, t.f, st.comp, e.currentTarget));
  }
  desenharMapaFichas(lista);
}

// Texto de uma linha pro tooltip do mapa: cada grupo marcado, por extenso, com quem marcou
function textoLinhaFicha(t, l) {
  const mk = t.marcas[l.chave] || {};
  return "<b>Trecho " + esc(t.tr) + " · S.R.E. " + esc(l.sre) + " · km " + numBR(l.ini) + "–" + numBR(l.fim) + "</b>"
    + t.bloco.grupos.filter((g) => mk[g.id] && mk[g.id].c)
      .map((g) => "<br>" + esc(GRUPO_CURTO[g.id] || g.nome) + ": " + esc(textoExtenso(t.f, g, mk[g.id].c)) + ' <span style="color:#64748B">(' + esc(mk[g.id].por || "?") + ", " + tempoDesde(mk[g.id].em) + ")</span>").join("");
}

function desenharMapaFichas(lista) {
  const mapa = novoMapaPainel();
  if (!mapa) return;
  const st = fichasPainel;
  const camada = L.featureGroup().addTo(mapa);
  let doAberto = null;
  for (const t of lista) {
    const grupoDoTrecho = L.featureGroup().addTo(camada);
    for (const l of t.linhas) {
      const mk = t.marcas[l.chave];
      const cls = mk && classeLinha(t.bloco, mk, st.grupo);
      if (!cls) continue;
      const s = SRE_KM.find((x) => x.r === t.r && x.s === l.sre);
      const sit = s ? situacaoTracado(t.r, l.sre) : null;
      if (!s || sit.naoBate) continue; // sem traçado confiável: só na lista/detalhe
      const fator = sit.fator || 1;
      L.polyline(recorteDoTracado(s, l.ini * 1000 / fator, l.fim * 1000 / fator), {
        color: COR_CONDICAO[cls], weight: st.aberto === t.k ? 9 : 6, opacity: 0.92, lineCap: "butt"
      }).bindTooltip(textoLinhaFicha(t, l), { sticky: true })
        .on("click", () => { st.aberto = t.k; renderPainel(); })
        .addTo(grupoDoTrecho);
    }
    if (st.aberto === t.k && grupoDoTrecho.getLayers().length) doAberto = grupoDoTrecho;
  }
  const legenda = L.control({ position: "bottomleft" });
  legenda.onAdd = () => {
    const div = L.DomUtil.create("div", "legenda-mapa");
    div.innerHTML = ["bom", "regular", "ruim"].map((c) => '<span><i style="background:' + COR_CONDICAO[c] + ';border-radius:2px"></i>' + ROTULO_CONDICAO[c] + "</span>").join("")
      + '<span class="legenda-mapa-dica">cada pedaço = uma linha da ficha</span>'
      + '<span class="legenda-mapa-dica">' + (st.grupo === "pior" ? "cor = pior condição marcada" : "cor = " + esc((TODOS_GRUPOS.find((g) => g.id === st.grupo) || {}).nome || "")) + "</span>";
    return div;
  };
  legenda.addTo(mapa);
  const alvo = doAberto || (camada.getLayers().some((g) => g.getLayers().length) ? camada : null);
  if (alvo) mapa.fitBounds(alvo.getBounds(), { padding: [30, 30], maxZoom: 14 });
  else mapa.setView([-8.5, -48.3], 6); // Tocantins
}

// Detalhe do trecho: as linhas da ficha como no celular (só leitura), alertas
// abertos em cada km e o botão de baixar a ficha completa da região
function htmlTrechoPainel(t) {
  if (!t) return "";
  const alertas = (painelState.lista || []).filter((a) => STATUS_ABERTOS.includes(a.status) && a.regiao === t.r && a.sre && a.km_sre != null);
  let linhasHtml = "", sreAnterior = "";
  for (const l of t.linhas) {
    if (l.sre !== sreAnterior) {
      linhasHtml += '<div class="ficha-sre">S.R.E. <b>' + esc(l.sre) + "</b> · " + numBR(l.marcos[l.marcos.length - 1]) + " km" + avisoTracado(t.r, l.sre) + "</div>";
      sreAnterior = l.sre;
    }
    const mk = t.marcas[l.chave] || {};
    const nAlertas = alertas.filter((a) => a.sre === l.sre && Number(a.km_sre) >= l.ini && Number(a.km_sre) < l.fim + (l.i === l.marcos.length - 2 ? 0.5 : 0)).length;
    linhasHtml += '<div class="ficha-linha"><span class="ficha-km">' + numBR(l.ini) + "–" + numBR(l.fim) + "</span>"
      + t.bloco.grupos.map((g) => {
        const m = mk[g.id];
        const k = m ? piorIndice(g, m.c) : -1;
        const varios = k >= 0 && listaCodigos(m.c).length > 1;
        return '<span class="ficha-cel' + (k < 0 ? " vazia" : k === 0 ? " boa" : " ruim") + '" title="' + esc(g.nome + (k >= 0 ? ": " + textoExtenso(t.f, g, m.c) + " · " + (m.por || "?") : "")) + '">'
          + (k < 0 ? "·" : esc(rotuloCurto(g.rotulos[k])) + (varios ? "+" : "")) + "</span>";
      }).join("")
      + (nAlertas ? '<span class="ficha-alerta" title="' + nAlertas + ' alerta(s) aberto(s) neste km">⚠' + nAlertas + "</span>" : "<span></span>")
      + "</div>";
  }
  return '<div class="ficha-fundo" id="fundo-trecho-painel"></div><div class="ficha" role="dialog" style="--n:' + t.bloco.grupos.length + '">'
    + '<div class="ficha-topo"><div><b>' + esc(rotuloRegiao(t.r)) + " · Trecho " + esc(t.tr) + '</b><div class="rotulo-mini">' + esc(t.trecho.tn) + "</div></div>"
    + '<button class="btn btn-ghost" id="btn-fechar-trecho-painel" aria-label="Fechar">✕</button></div>'
    + '<div class="ficha-corpo">'
    + '<div class="rotulo-mini">Ficha ' + esc(FICHAS[t.f].nome.toLowerCase()) + " · " + esc(rotuloMes(fichasPainel.comp)) + " · por " + esc(t.pessoas.join(", ") || "?") + " · atualizado " + tempoDesde(t.atualizado) + "</div>"
    + '<div class="ficha-progresso"><div class="barra"><i style="width:' + Math.round(100 * t.preenchidas / t.linhas.length) + '%"></i></div><span>'
    + t.preenchidas + " de " + t.linhas.length + " linhas marcadas · " + t.completas + " completas</span></div>"
    + htmlResumoCondicao(t.cont)
    + '<div><div class="ficha-cab-grupos"><span class="ficha-km">km</span>' + t.bloco.grupos.map((g) => '<span class="ficha-cel" title="' + esc(g.nome) + '">' + esc((GRUPO_CURTO[g.id] || g.nome).slice(0, 7)) + "</span>").join("") + "<span></span></div>"
    + '<div class="ficha-linhas">' + linhasHtml + "</div></div>"
    + "</div>"
    + '<div class="ficha-rodape"><button class="btn btn-primary btn-grande" id="btn-baixar-ficha-painel">Baixar a ficha completa da ' + esc(rotuloRegiao(t.r)) + " (.xlsx)</button></div></div>";
}
