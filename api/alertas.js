// Alertas guardados no SharePoint, um arquivo JSON por alerta
// (Alertas-Campo/dados/<id>.json). Sem login: o site inteiro é aberto pra
// quem tiver o link. As travas ficam aqui no servidor:
//   - GET   lista todos os alertas;
//   - POST  cria um alerta novo — o status sempre nasce "novo", sem resposta;
//           reenviar o mesmo id (fila offline) não duplica nem sobrescreve;
//   - PATCH muda SÓ o tratamento (status, resposta, ponto_critico,
//           tratado_por, tratado_em) — foto, local, itens e observação ficam
//           como o campo mandou;
//   - não existe exclusão pelo site.

const { conectar, gravarArquivo, lerItem, listarPasta } = require("./_lib/msgraph");

const ID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FOTO_OK = /^[A-Za-z0-9-]{1,30}\/[A-Za-z0-9-]{1,30}\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/\d{1,2}\.jpg$/;
const STATUS = ["novo", "visto", "em_andamento", "resolvido", "descartado"];
const GRAVIDADES = ["baixa", "media", "urgente"];
const TIPOS_FICHA = ["pav", "np"];

const texto = (v, max) => (v == null || v === "" ? null : String(v).slice(0, max));
const numero = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));

// Monta o alerta só com os campos conhecidos, cortando tamanho — o que vier a
// mais no corpo da requisição é ignorado.
function alertaNovo(b) {
  if (!ID_OK.test(String(b.id || ""))) return { erro: "id inválido" };
  if (!GRAVIDADES.includes(b.gravidade)) return { erro: "gravidade inválida" };
  if (!TIPOS_FICHA.includes(b.tipo_ficha)) return { erro: "tipo_ficha inválido" };
  if (!b.categoria) return { erro: "faltou o que foi visto" };
  if (!b.capturado_em || isNaN(Date.parse(b.capturado_em))) return { erro: "capturado_em inválido" };
  const fotos = Array.isArray(b.fotos) ? b.fotos.slice(0, 10).map(String) : [];
  if (fotos.some((f) => !FOTO_OK.test(f))) return { erro: "caminho de foto inválido" };
  const itens = {};
  if (b.itens && typeof b.itens === "object") {
    for (const [k, v] of Object.entries(b.itens).slice(0, 10)) {
      if (/^[a-z_]{1,30}$/.test(k) && v != null) itens[k] = String(v).slice(0, 40);
    }
  }
  return {
    alerta: {
      id: b.id,
      regiao: texto(b.regiao, 6), trecho: texto(b.trecho, 200), sre: texto(b.sre, 20),
      km_sre: numero(b.km_sre), distancia_eixo_m: numero(b.distancia_eixo_m),
      gps_lat: numero(b.gps_lat), gps_lng: numero(b.gps_lng),
      tipo_ficha: b.tipo_ficha, itens, categoria: texto(b.categoria, 300),
      gravidade: b.gravidade, observacao: texto(b.observacao, 800),
      fotos, capturado_em: new Date(b.capturado_em).toISOString(),
      autor_nome: texto(b.autor_nome, 60), dispositivo: texto(b.dispositivo, 40),
      status: "novo", resposta: null, ponto_critico: null, tratado_por: null, tratado_em: null,
      created_at: new Date().toISOString()
    }
  };
}

async function listar(con) {
  const arquivos = (await listarPasta(con, "dados")).filter((i) => i.file && /\.json$/.test(i.name));
  const alertas = [];
  // os links de download já vêm autenticados na listagem; baixa de 20 em 20
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
    alertas.push(...lote.filter(Boolean));
  }
  alertas.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return alertas;
}

async function atualizar(con, b) {
  if (!ID_OK.test(String(b.id || ""))) return { status: 400, corpo: { erro: "id inválido" } };
  const caminho = "dados/" + b.id + ".json";
  // lê, aplica só o tratamento e grava de volta com If-Match: se alguém mexeu
  // no meio do caminho, tenta de novo (até 3 vezes) em cima da versão nova
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const item = await lerItem(con, caminho);
    if (!item) return { status: 404, corpo: { erro: "alerta não encontrado" } };
    const atual = await (await fetch(item.downloadUrl)).json();
    const novo = Object.assign({}, atual);
    if (b.status !== undefined) {
      if (!STATUS.includes(b.status)) return { status: 400, corpo: { erro: "status inválido" } };
      novo.status = b.status;
    }
    if (b.resposta !== undefined) novo.resposta = texto(b.resposta, 600);
    if (b.ponto_critico !== undefined) novo.ponto_critico = texto(b.ponto_critico, 60);
    novo.tratado_por = texto(b.tratado_por, 60);
    novo.tratado_em = new Date().toISOString();
    const r = await gravarArquivo(con, caminho, JSON.stringify(novo), "application/json", "replace", item.eTag);
    if (r.ok) return { status: 200, corpo: novo };
  }
  return { status: 409, corpo: { erro: "o alerta mudou enquanto salvava, tente de novo" } };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  // TEMPORÁRIO (2026-10-29): conferir o formato do segredo colado no Vercel sem revelar o valor. Remover depois.
  if (req.method === "GET" && (req.query || {}).diag === "1") {
    const bruto = String(process.env.MS_CLIENT_SECRET || "");
    const s = bruto.trim();
    res.status(200).json({
      tamanhoBruto: bruto.length, tamanho: s.length, espacoNasPontas: bruto !== s,
      espacoNoMeio: /\s/.test(s), soCaracteresValidos: /^[A-Za-z0-9~._-]+$/.test(s),
      tamanhoSiteId: String(process.env.MS_SITE_ID || "").trim().length,
      siteIdComecaCerto: /^rtaengbr\.sharepoint\.com,/.test(String(process.env.MS_SITE_ID || "").trim())
    });
    return;
  }
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.status(405).json({ erro: "Método não permitido" });
    return;
  }
  const con = await conectar(res);
  if (!con) return;
  try {
    if (req.method === "GET") {
      res.status(200).json(await listar(con));
      return;
    }
    if (req.method === "POST") {
      const { alerta, erro } = alertaNovo(req.body || {});
      if (erro) { res.status(400).json({ erro }); return; }
      const r = await gravarArquivo(con, "dados/" + alerta.id + ".json", JSON.stringify(alerta), "application/json", "fail");
      res.status(200).json({ ok: true, jaExistia: !!r.jaExistia });
      return;
    }
    const r = await atualizar(con, req.body || {});
    res.status(r.status).json(r.corpo);
  } catch (erro) {
    console.error("Erro em /api/alertas:", erro);
    res.status(500).json({ erro: erro.message || String(erro) });
  }
};
