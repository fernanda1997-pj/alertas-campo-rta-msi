// Acesso ao SharePoint da empresa pelo Microsoft Graph, com as MESMAS
// credenciais de aplicativo do Fotos de Campo (variáveis de ambiente do
// Vercel: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SITE_ID e, se
// houver, MS_PASTA_BASE). Ficam só no servidor, nunca chegam ao navegador.
// Prefixo "_lib": o Vercel não transforma esta pasta em rota.
//
// Tudo do app fica dentro de uma pasta só no SharePoint:
//   Alertas-Campo/dados/<id>.json                 um arquivo por alerta
//   Alertas-Campo/fotos/R1/TO-201/2026-10-29/<id>/1.jpg

const PASTA_APP = "Alertas-Campo";

function obterConfig() {
  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const siteId = process.env.MS_SITE_ID;
  const pastaBase = process.env.MS_PASTA_BASE || "";
  const configurado = !!(tenantId && clientId && clientSecret && siteId);
  return { tenantId, clientId, clientSecret, siteId, pastaBase, configurado };
}

// Token de aplicativo (client credentials) — não é login de nenhuma pessoa.
// Guardado na memória da function enquanto ela estiver "quente" (vale ~1 h).
let tokenCache = { valor: null, expira: 0 };
async function obterToken(config) {
  if (tokenCache.valor && Date.now() < tokenCache.expira) return tokenCache.valor;
  const resp = await fetch(
    "https://login.microsoftonline.com/" + encodeURIComponent(config.tenantId) + "/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://graph.microsoft.com/.default"
      })
    }
  );
  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Falha ao autenticar com o Microsoft");
  }
  tokenCache = { valor: json.access_token, expira: Date.now() + Math.max(60, (json.expires_in || 3600) - 300) * 1000 };
  return json.access_token;
}

// URL do Graph pra um caminho DENTRO da pasta do app (já codificado pedaço por pedaço)
function urlItem(config, caminhoNoApp) {
  const completo = [config.pastaBase.replace(/^\/+|\/+$/g, ""), PASTA_APP, caminhoNoApp].filter(Boolean).join("/");
  return "https://graph.microsoft.com/v1.0/sites/" + config.siteId + "/drive/root:/" + completo.split("/").map(encodeURIComponent).join("/");
}

// Abre a conexão (config + token) ou responde o erro e devolve null
async function conectar(res) {
  const config = obterConfig();
  if (!config.configurado) {
    res.status(501).json({ erro: "SharePoint não configurado: faltam as variáveis MS_* no Vercel deste projeto." });
    return null;
  }
  try {
    return { config, token: await obterToken(config) };
  } catch (erro) {
    console.error("Falha ao autenticar no Microsoft Graph:", erro);
    res.status(502).json({ erro: "Falha ao autenticar com o Microsoft: " + erro.message });
    return null;
  }
}

// Grava um arquivo. seExistir: "fail" (devolve {jaExistia:true} em vez de
// sobrescrever) | "replace". ifMatch: só grava se o arquivo não mudou desde a leitura.
async function gravarArquivo(con, caminhoNoApp, conteudo, tipo, seExistir, ifMatch) {
  const headers = { Authorization: "Bearer " + con.token, "Content-Type": tipo };
  if (ifMatch) headers["If-Match"] = ifMatch;
  const resp = await fetch(urlItem(con.config, caminhoNoApp) + ":/content?@microsoft.graph.conflictBehavior=" + seExistir, {
    method: "PUT", headers, body: conteudo
  });
  if (resp.status === 409 && seExistir === "fail") return { jaExistia: true };
  if (resp.status === 412) return { mudou: true };
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => "");
    console.error("Falha ao gravar no SharePoint:", caminhoNoApp, resp.status, corpo);
    throw new Error("Falha ao gravar no SharePoint (HTTP " + resp.status + ")");
  }
  return { ok: true };
}

// Metadados de um arquivo: { eTag, downloadUrl } ou null se não existe
async function lerItem(con, caminhoNoApp) {
  const resp = await fetch(urlItem(con.config, caminhoNoApp), { headers: { Authorization: "Bearer " + con.token } });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error("Falha ao ler do SharePoint (HTTP " + resp.status + ")");
  const json = await resp.json();
  return { eTag: json.eTag, downloadUrl: json["@microsoft.graph.downloadUrl"] };
}

// Todos os arquivos de uma pasta do app (segue a paginação do Graph)
async function listarPasta(con, caminhoNoApp) {
  const itens = [];
  let url = urlItem(con.config, caminhoNoApp) + ":/children?$top=999";
  while (url) {
    const resp = await fetch(url, { headers: { Authorization: "Bearer " + con.token } });
    if (resp.status === 404) return itens; // pasta ainda não existe = nenhum alerta
    if (!resp.ok) throw new Error("Falha ao listar no SharePoint (HTTP " + resp.status + ")");
    const json = await resp.json();
    itens.push(...(json.value || []));
    url = json["@odata.nextLink"] || null;
  }
  return itens;
}

module.exports = { conectar, gravarArquivo, lerItem, listarPasta };
