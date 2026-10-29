// Fotos dos alertas no SharePoint (Alertas-Campo/fotos/...).
//   POST {caminho, conteudoBase64}  sobe uma foto; se o mesmo caminho já
//        existe (reenvio da fila offline), não sobrescreve e responde ok
//   GET  ?c=<caminho>               redireciona pro link temporário da foto
//        (é o que vai no <img src> do site)
// O caminho é validado (só o formato que o site gera), então ninguém usa isto
// pra ler ou gravar fora da pasta de fotos.

const { conectar, gravarArquivo, lerItem } = require("./_lib/msgraph");

const FOTO_OK = /^[A-Za-z0-9-]{1,30}\/[A-Za-z0-9-]{1,30}\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/\d{1,2}\.jpg$/;
const LIMITE_BYTES = 3.5 * 1024 * 1024; // a function do Vercel aceita ~4,5 MB de corpo (base64 incluso)

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ erro: "Método não permitido" });
    return;
  }
  const caminho = String(req.method === "GET" ? (req.query || {}).c || "" : (req.body || {}).caminho || "");
  if (!FOTO_OK.test(caminho)) {
    res.status(400).json({ erro: "caminho de foto inválido" });
    return;
  }
  const con = await conectar(res);
  if (!con) return;
  try {
    if (req.method === "GET") {
      const item = await lerItem(con, "fotos/" + caminho);
      if (!item || !item.downloadUrl) { res.status(404).json({ erro: "foto não encontrada" }); return; }
      res.setHeader("Cache-Control", "private, max-age=600"); // o link do SharePoint vale ~1 h
      res.redirect(302, item.downloadUrl);
      return;
    }
    const buffer = Buffer.from(String((req.body || {}).conteudoBase64 || ""), "base64");
    if (!buffer.length || buffer.length > LIMITE_BYTES) {
      res.status(413).json({ erro: "foto vazia ou grande demais" });
      return;
    }
    // só JPEG (começa com FF D8) — o site sempre converte antes de mandar
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      res.status(415).json({ erro: "a foto precisa ser JPEG" });
      return;
    }
    const r = await gravarArquivo(con, "fotos/" + caminho, buffer, "image/jpeg", "fail");
    res.status(200).json({ ok: true, jaExistia: !!r.jaExistia });
  } catch (erro) {
    console.error("Erro em /api/foto:", erro);
    res.status(500).json({ erro: erro.message || String(erro) });
  }
};
