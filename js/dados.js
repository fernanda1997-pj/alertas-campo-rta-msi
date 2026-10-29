// Listas fixas do app + utilitários pequenos usados em todas as telas.

// Os mesmos grupos e colunas da Ficha de Inspeção (modelo set/2026, legenda da
// própria ficha). `c` é o cabeçalho da coluna na ficha — é ele que vai pro
// CSV "Linhas da ficha". As opções estão na ordem das colunas, do menos pro
// mais grave: quando dois alertas caem no mesmo km, vale o mais grave (a
// ficha pede o PREDOMINANTE). A coluna "boa" (BOM/ADEQ./LIMPOS...) não entra:
// alerta é pra problema; o km sem alerta continua sendo preenchido como hoje.
// Os `id` são os mesmos do converter_fichas.py (TEMPLATES), pra cruzar depois.
const FICHAS = {
  pav: {
    nome: "Pavimentada",
    grupos: [
      { id: "pavimento", nome: "Condição do pavimento", opcoes: [
        { c: "REM. I.", t: "Remendos isolados", d: "até 10 por km" },
        { c: "REM. L.", t: "Remendos ao longo", d: "mais de 10 por km" },
        { c: "BUR. I.", t: "Buracos isolados", d: "até 5 por km" },
        { c: "BUR. L.", t: "Buracos ao longo", d: "mais de 5 por km" }
      ] },
      { id: "vegetacao", nome: "Vegetação", opcoes: [
        { c: "INAD.", t: "Inadequada", d: "mato alto, precisa roçar" }
      ] },
      { id: "drenagem", nome: "Elementos de drenagem", opcoes: [
        { c: "SUJOS", t: "Sujos" },
        { c: "DAN.", t: "Danificados" }
      ] },
      { id: "sinalizacao_horizontal", nome: "Sinalização horizontal", opcoes: [
        { c: "REG.", t: "Regular" },
        { c: "INEXIST.", t: "Inexistente" }
      ] },
      { id: "sinalizacao_vertical", nome: "Sinalização vertical", opcoes: [
        { c: "POUCAS", t: "Poucas placas" },
        { c: "INEXIST.", t: "Inexistente" }
      ] }
    ]
  },
  np: {
    nome: "Não pavimentada",
    grupos: [
      { id: "plataforma", nome: "Condição da plataforma", opcoes: [
        { c: "REG.", t: "Regular", d: "até 10 irregularidades por km" },
        { c: "RUIM", t: "Ruim", d: "mais de 10 irregularidades por km" },
        { c: "PÉSSIMA", t: "Péssima", d: "atoleiro / ponto crítico" }
      ] },
      { id: "drenagem_superficial", nome: "Drenagem superficial", opcoes: [
        { c: "OBSTRUÍDA", t: "Obstruída" },
        { c: "AUSENTE", t: "Ausente" }
      ] }
    ]
  }
};

// Problema que não tem coluna na ficha (vai nas OBSERVAÇÕES dela)
const FORA_DA_FICHA = ["Erosão", "Ponte / estrutura", "Obstrução na pista", "Outro"];

// Todos os grupos das duas fichas, sem repetir (pro filtro do Painel e o CSV)
const TODOS_GRUPOS = [...FICHAS.pav.grupos, ...FICHAS.np.grupos];

function opcaoDaFicha(grupoId, codigo) {
  const g = TODOS_GRUPOS.find((x) => x.id === grupoId);
  return g ? g.opcoes.find((o) => o.c === codigo) || null : null;
}

// "Buracos ao longo · Vegetação inadequada · Erosão" — resumo legível
// (vai na coluna `categoria`, nas listas e no carimbo da foto)
function resumoItens(itens) {
  const partes = [];
  for (const g of TODOS_GRUPOS) {
    const o = itens && itens[g.id] ? opcaoDaFicha(g.id, itens[g.id]) : null;
    if (!o) continue;
    // "Buracos ao longo" já diz tudo; nos outros, o nome do grupo + a opção
    partes.push(g.id === "pavimento" ? o.t : g.nome.replace(/^Condição da /, "").replace(/^./, (l) => l.toUpperCase()) + " " + o.t.toLowerCase());
  }
  if (itens && itens.outro) partes.push(itens.outro);
  return partes.join(" · ");
}

const GRAVIDADES = [
  { id: "baixa",   rotulo: "Pode esperar", cor: "var(--ok)" },
  { id: "media",   rotulo: "Atenção",      cor: "var(--amber)" },
  { id: "urgente", rotulo: "Urgente",      cor: "var(--danger)", dica: "risco de acidente ou de perder a pista" }
];

const STATUS = [
  { id: "novo",         rotulo: "Novo",         cor: "var(--danger)" },
  { id: "visto",        rotulo: "Visto",        cor: "var(--info)" },
  { id: "em_andamento", rotulo: "Em andamento", cor: "var(--amber)" },
  { id: "resolvido",    rotulo: "Resolvido",    cor: "var(--ok)" },
  { id: "descartado",   rotulo: "Descartado",   cor: "var(--text-muted)" }
];

function gravidadePorId(id) { return GRAVIDADES.find((g) => g.id === id) || { id, rotulo: id, cor: "var(--text-muted)" }; }
function statusPorId(id) { return STATUS.find((s) => s.id === id) || { id, rotulo: id, cor: "var(--text-muted)" }; }

// Região › lista de trechos, tirada das mesmas geometrias usadas na detecção
// por GPS (js/trechos-geo.js) — assim a correção manual sempre oferece
// exatamente os trechos que o GPS conhece, sem uma segunda lista pra manter.
const REGIOES = (() => {
  const mapa = {};
  for (const seg of SEGMENTOS_GEO) {
    (mapa[seg.regiao] = mapa[seg.regiao] || new Set()).add(seg.trecho);
  }
  const ordem = Object.keys(mapa).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
  const saida = {};
  for (const r of ordem) saida[r] = Array.from(mapa[r]).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return saida;
})();

function rotuloRegiao(codigo) { return codigo ? "Região " + codigo.replace(/^R/, "") : ""; }

function esc(texto) {
  return String(texto == null ? "" : texto)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function opts(lista, atual, rotulador) {
  return lista.map((v) => '<option value="' + esc(v) + '"' + (v === atual ? " selected" : "") + ">" + esc(rotulador ? rotulador(v) : v) + "</option>").join("");
}

// "Ficha pavimentada — Condição do pavimento: BUR. L. · Vegetação: INAD."
function textoItensFicha(a) {
  const tipo = FICHAS[a.tipo_ficha] ? a.tipo_ficha : "pav";
  const itens = a.itens || {};
  const partes = FICHAS[tipo].grupos.filter((g) => itens[g.id]).map((g) => g.nome + ": " + itens[g.id]);
  if (itens.outro) partes.push("Fora da ficha: " + itens.outro);
  return "Ficha " + FICHAS[tipo].nome.toLowerCase() + (partes.length ? " — " + partes.join(" · ") : "");
}

const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
function rotuloMes(ym) { const p = ym.split("-"); return MESES_PT[parseInt(p[1], 10) - 1] + "/" + p[0]; }

function fmtDataHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// "há 3 h", "há 2 dias" — no painel o que importa é há quanto tempo o alerta está parado
function tempoDesde(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return "há " + min + " min";
  const h = Math.round(min / 60);
  if (h < 24) return "há " + h + " h";
  const d = Math.round(h / 24);
  return "há " + d + (d === 1 ? " dia" : " dias");
}

function seloStatus(id) {
  const s = statusPorId(id);
  return '<span class="selo" style="--cor:' + s.cor + '">' + esc(s.rotulo) + "</span>";
}

function seloGravidade(id) {
  const g = gravidadePorId(id);
  return '<span class="selo selo-gravidade" style="--cor:' + g.cor + '">' + esc(g.rotulo) + "</span>";
}
