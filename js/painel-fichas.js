// Painel › "Fichas percorridas" (na mesma tela dos alertas, js/painel.js): o que o
// campo já percorreu e avaliou na Ficha de Inspeção (aba Ficha do app), mês a mês —
// cartões dos trechos com andamento e quem passou, as linhas da ficha coloridas
// pela avaliação no mapa, e o detalhe do trecho linha por linha. Lê todos os arquivos do mês no SharePoint (api/ficha.js,
// ?comp=) e junta igual à aba Ficha: em cada célula vale a marcação mais recente.

let fichasPainel = {
  comp: mesAtual(), carregando: false, erro: "", docs: null,
  grupo: "pior",                    // cor no mapa: pior condição da linha ou um grupo só
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
    if (painelState.filtroRegiao && r !== painelState.filtroRegiao) continue; // a região do Painel vale pros dois
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

// Filtros das fichas na barra do Painel: mês da ficha e o que a cor do mapa mostra
function htmlFiltrosFichas() {
  const st = fichasPainel;
  const grupos = [...FICHAS.pav.grupos, ...FICHAS.np.grupos];
  return '<label class="campo-rotulado"><span class="rotulo-mini">Mês da ficha</span>'
    + '<input class="input input-mini" type="month" id="ff-mes" value="' + esc(st.comp) + '"></label>'
    + '<label class="campo-rotulado" title="Cada km do trecho aparece no mapa em verde (bom), amarelo (regular) ou vermelho (ruim)"><span class="rotulo-mini">Condição no mapa</span>'
    + '<select class="input input-mini" id="ff-grupo"><option value="pior"' + (st.grupo === "pior" ? " selected" : "") + ">Todos os itens (vale o pior)</option>"
    + grupos.map((g) => '<option value="' + g.id + '"' + (st.grupo === g.id ? " selected" : "") + ">Só " + esc(g.nome.charAt(0).toLowerCase() + g.nome.slice(1)) + "</option>").join("") + "</select></label>";
}

function ligarFiltrosFichas(m, trechos) {
  const st = fichasPainel;
  m.querySelector("#ff-mes").addEventListener("change", (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { st.comp = e.target.value; st.aberto = null; carregarFichasPainel(); } });
  m.querySelector("#ff-grupo").addEventListener("change", (e) => { st.grupo = e.target.value; renderPainel(); });
  m.querySelectorAll("[data-trecho-painel]").forEach((b) => b.addEventListener("click", () => abrirTrechoPainel(b.dataset.trechoPainel)));
  const fechar = m.querySelector("#btn-fechar-trecho-painel");
  if (fechar) {
    const f = () => { st.aberto = null; renderPainel(); };
    fechar.addEventListener("click", f);
    m.querySelector("#fundo-trecho-painel").addEventListener("click", f);
    const t = trechos.find((x) => x.k === st.aberto);
    m.querySelector("#btn-baixar-ficha-painel").addEventListener("click", (e) => baixarFichaXlsx(t.r, t.f, st.comp, e.currentTarget));
  }
}

function abrirTrechoPainel(k) {
  fichasPainel.aberto = k;
  painelState.aberto = null; // um detalhe aberto por vez
  renderPainel();
}

function htmlCartaoTrecho(t) {
  const pct = Math.round(100 * t.preenchidas / t.linhas.length);
  return '<button class="linha-alerta linha-trecho' + (fichasPainel.aberto === t.k ? " ativo" : "") + '" data-trecho-painel="' + esc(t.k) + '">'
    + '<div class="linha-alerta-topo"><b>' + esc(rotuloRegiao(t.r)) + " · Trecho " + esc(t.tr) + '</b><span class="rotulo-mini" style="margin-left:auto;">' + tempoDesde(t.atualizado) + "</span></div>"
    + '<div class="rotulo-mini">' + esc(t.trecho.tn) + " · " + esc(FICHAS[t.f].nome.toLowerCase()) + "</div>"
    + '<div class="ficha-progresso"><div class="barra"><i style="width:' + pct + '%"></i></div><span>' + t.preenchidas + " de " + t.linhas.length + " linhas (" + pct + "%)</span></div>"
    + htmlResumoCondicao(t.cont)
    + (t.completas < t.preenchidas ? '<div class="rotulo-mini" style="color:var(--amber)">' + (t.preenchidas - t.completas) + " linha(s) com grupo sem marcação</div>" : "")
    + '<div class="rotulo-mini">Por: ' + esc(t.pessoas.join(", ") || "?") + "</div></button>";
}

function htmlLegendaFichas() {
  const st = fichasPainel;
  return '<b class="legenda-mapa-titulo">Ficha (' + (st.grupo === "pior" ? "pior condição" : esc((TODOS_GRUPOS.find((g) => g.id === st.grupo) || {}).nome || "")) + ")</b>"
    + ["bom", "regular", "ruim"].map((c) => '<span><i style="background:' + COR_CONDICAO[c] + ';border-radius:2px"></i>' + ROTULO_CONDICAO[c] + "</span>").join("");
}

// Texto de uma linha pro tooltip do mapa: cada grupo marcado, por extenso, com quem marcou
function textoLinhaFicha(t, l) {
  const mk = t.marcas[l.chave] || {};
  return "<b>Trecho " + esc(t.tr) + " · S.R.E. " + esc(l.sre) + " · km " + numBR(l.ini) + "–" + numBR(l.fim) + "</b>"
    + t.bloco.grupos.filter((g) => mk[g.id] && mk[g.id].c)
      .map((g) => "<br>" + esc(GRUPO_CURTO[g.id] || g.nome) + ": " + esc(textoExtenso(t.f, g, mk[g.id].c)) + ' <span style="color:#64748B">(' + esc(mk[g.id].por || "?") + ", " + tempoDesde(mk[g.id].em) + ")</span>").join("");
}

// Linhas da ficha no mapa do Painel. Devolve { tem, limites, doAberto } pro
// enquadramento (js/painel.js desenharMapa).
function desenharFichasNoMapa(mapa, lista) {
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
        .on("click", () => abrirTrechoPainel(t.k))
        .addTo(grupoDoTrecho);
    }
    if (st.aberto === t.k && grupoDoTrecho.getLayers().length) doAberto = grupoDoTrecho.getBounds();
  }
  const tem = camada.getLayers().some((g) => g.getLayers().length);
  return { tem, limites: tem ? camada.getBounds() : null, doAberto };
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
