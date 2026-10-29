// Marcações da Ficha de Inspeção feitas em campo (aba "Ficha" do app).
//
// Várias pessoas podem preencher o mesmo trecho ao mesmo tempo: cada aparelho
// grava SÓ o próprio arquivo, então ninguém sobrescreve ninguém —
//   Alertas-Campo/fichas/<AAAA-MM>/<R1>-<pav|np>/<nº trecho>__<id do aparelho>.json
// e quem junta (a marcação mais recente de cada célula vale) é o app.
//
//   GET  ?comp=2026-10&r=R1&f=np[&tr=20]   todos os arquivos daquela ficha (ou só de um trecho)
//   POST {comp, r, f, tr, dispositivo, nome, marcas}   grava/substitui o arquivo deste aparelho

const { conectar, gravarArquivo, listarPasta } = require("./_lib/msgraph");

const COMP_OK = /^\d{4}-\d{2}$/;
const REG_OK = /^R\d{1,2}$/;
const TIPO_OK = /^(pav|np)$/;
const TR_OK = /^[A-Za-z0-9-]{1,12}$/;
const ID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHAVE_LINHA_OK = /^[A-Z0-9]{4,14}\|\d{1,4}(\.\d{1,3})?$/; // "201ETO0270|3"
const GRUPO_OK = /^[a-z_]{1,30}$/;
const MAX_LINHAS = 4000;

function pasta(q) { return "fichas/" + q.comp + "/" + q.r + "-" + q.f; }

function parametrosOk(q) {
  return COMP_OK.test(q.comp || "") && REG_OK.test(q.r || "") && TIPO_OK.test(q.f || "") && (q.tr === undefined || TR_OK.test(q.tr));
}

// Só o formato esperado passa; o resto é descartado sem erro
function limparMarcas(marcas) {
  const saida = {};
  if (!marcas || typeof marcas !== "object") return saida;
  for (const [linha, grupos] of Object.entries(marcas).slice(0, MAX_LINHAS)) {
    if (!CHAVE_LINHA_OK.test(linha) || !grupos || typeof grupos !== "object") continue;
    const g2 = {};
    for (const [g, m] of Object.entries(grupos).slice(0, 10)) {
      if (!GRUPO_OK.test(g) || !m || typeof m !== "object" || isNaN(Date.parse(m.em))) continue;
      g2[g] = { c: String(m.c == null ? "" : m.c).slice(0, 120), em: new Date(m.em).toISOString(), por: String(m.por || "").slice(0, 60) };
    }
    if (Object.keys(g2).length) saida[linha] = g2;
  }
  return saida;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ erro: "Método não permitido" });
    return;
  }
  const q = req.method === "GET" ? (req.query || {}) : (req.body || {});
  const p = { comp: q.comp, r: q.r, f: q.f, tr: q.tr === "" || q.tr == null ? undefined : String(q.tr) };
  if (!parametrosOk(p)) {
    res.status(400).json({ erro: "parâmetros inválidos (comp, r, f, tr)" });
    return;
  }
  const con = await conectar(res);
  if (!con) return;
  try {
    if (req.method === "GET") {
      const arquivos = (await listarPasta(con, pasta(p)))
        .filter((i) => i.file && /\.json$/.test(i.name) && (!p.tr || i.name.startsWith(p.tr + "__")));
      const saida = [];
      for (let i = 0; i < arquivos.length; i += 20) {
        const lote = await Promise.all(arquivos.slice(i, i + 20).map(async (arq) => {
          try {
            const resp = await fetch(arq["@microsoft.graph.downloadUrl"]);
            return resp.ok ? await resp.json() : null;
          } catch (erro) {
            console.error("Não consegui ler", arq.name, erro);
            return null;
          }
        }));
        saida.push(...lote.filter(Boolean));
      }
      res.status(200).json(saida);
      return;
    }
    if (!p.tr || !ID_OK.test(String(q.dispositivo || ""))) {
      res.status(400).json({ erro: "faltou trecho ou id do aparelho" });
      return;
    }
    const doc = {
      comp: p.comp, r: p.r, f: p.f, tr: p.tr, dispositivo: q.dispositivo,
      nome: String(q.nome || "").slice(0, 60), atualizado: new Date().toISOString(),
      marcas: limparMarcas(q.marcas)
    };
    await gravarArquivo(con, pasta(p) + "/" + p.tr + "__" + q.dispositivo + ".json", JSON.stringify(doc), "application/json", "replace");
    res.status(200).json({ ok: true, linhas: Object.keys(doc.marcas).length });
  } catch (erro) {
    console.error("Erro em /api/ficha:", erro);
    res.status(500).json({ erro: erro.message || String(erro) });
  }
};
