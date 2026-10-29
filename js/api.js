// Conversa com as functions do próprio site (api/alertas.js e api/foto.js),
// que guardam tudo no SharePoint da empresa. Sem sinal, o fetch falha com
// "Failed to fetch" — é isso que pareceErroDeRede (js/fila.js) reconhece pra
// mandar o alerta pra fila do celular.

// Sinal fraco: o fetch não falha, fica pendurado. Passou do prazo, vira erro
// "timeout" (pareceErroDeRede) e o alerta/ficha vai pra fila do celular. Reenviar
// é seguro: foto e alerta com o mesmo id não duplicam no SharePoint (jaExistia).
const PRAZO_API_MS = 90000;

async function chamarApi(metodo, url, corpo) {
  const controle = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controle ? setTimeout(() => controle.abort(), PRAZO_API_MS) : null;
  let resp;
  try {
    resp = await fetch(url, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: "no-store",
      signal: controle ? controle.signal : undefined
    });
  } catch (erro) {
    if (erro && erro.name === "AbortError") throw new Error("timeout: sinal fraco demais");
    throw erro;
  } finally { clearTimeout(timer); }
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const erro = new Error(json.erro || "HTTP " + resp.status);
    erro.status = resp.status;
    throw erro;
  }
  return json;
}

function apiListarAlertas() { return chamarApi("GET", "api/alertas"); }
function apiCriarAlerta(alerta) { return chamarApi("POST", "api/alertas", alerta); }
function apiAtualizarAlerta(id, mudancas) { return chamarApi("PATCH", "api/alertas", Object.assign({ id }, mudancas)); }

function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(",")[1] || "");
    leitor.onerror = () => reject(leitor.error || new Error("Falha ao ler a foto"));
    leitor.readAsDataURL(arquivo);
  });
}

async function apiEnviarFoto(caminho, arquivo) {
  return chamarApi("POST", "api/foto", { caminho, conteudoBase64: await arquivoParaBase64(arquivo) });
}

// Ficha de Inspeção em campo (api/ficha.js): um arquivo por aparelho por trecho
function apiLerFicha(comp, r, f, tr) {
  return chamarApi("GET", "api/ficha?comp=" + encodeURIComponent(comp) + "&r=" + encodeURIComponent(r) + "&f=" + encodeURIComponent(f) + (tr ? "&tr=" + encodeURIComponent(tr) : ""));
}
function apiGravarFicha(doc) { return chamarApi("POST", "api/ficha", doc); }

// Endereço da foto pra usar direto em <img src> / link
function urlFoto(caminho) { return "api/foto?c=" + encodeURIComponent(caminho); }
