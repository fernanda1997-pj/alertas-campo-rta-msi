// Fila de envio offline no IndexedDB: o alerta registrado sem sinal fica
// guardado no celular (sobrevive a fechar o app) e sobe sozinho quando a
// conexão voltar. As fotos (File) vão direto pro IndexedDB, sem base64.

const FILA_DB_NOME = "alertas-campo-fila";
const FILA_STORE = "alertas";
const RASCUNHO_STORE = "rascunho"; // alerta ainda não enviado (ver salvarFotoRascunho)
const FICHA_STORE = "fichas";      // marcações da aba Ficha deste aparelho (ver js/ficha.js)

function abrirFilaDB() {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(FILA_DB_NOME, 3);
    pedido.onupgradeneeded = () => {
      for (const nome of [FILA_STORE, RASCUNHO_STORE, FICHA_STORE]) {
        if (!pedido.result.objectStoreNames.contains(nome)) pedido.result.createObjectStore(nome, { keyPath: "id" });
      }
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

function _tx(store, modo, acao) {
  return abrirFilaDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, modo);
    const pedido = acao(tx.objectStore(store));
    tx.oncomplete = () => resolve(pedido ? pedido.result : undefined);
    tx.onerror = () => reject(tx.error);
  }));
}

function salvarNaFila(item) { return _tx(FILA_STORE, "readwrite", (s) => { s.put(item); }); }
function listarFila() { return _tx(FILA_STORE, "readonly", (s) => s.getAll()).then((r) => r || []); }
function removerDaFila(id) { return _tx(FILA_STORE, "readwrite", (s) => { s.delete(id); }); }

// ---- Rascunho: o alerta que está sendo montado e ainda não foi enviado ----
// Cada foto é gravada aqui no momento em que é tirada, e o resto do formulário
// (local, itens da ficha, gravidade, observação) a cada mudança. Se o celular
// fechar o navegador no meio (troca de app, tela bloqueada, falta de memória),
// tudo volta ao abrir o app de novo. Mesmo esquema do Fotos de Campo.
const ID_ESTADO_RASCUNHO = "_estado";

function salvarFotoRascunho(id, file) { return _tx(RASCUNHO_STORE, "readwrite", (s) => { s.put({ id, file }); }); }
function removerFotoRascunho(id) { return _tx(RASCUNHO_STORE, "readwrite", (s) => { s.delete(id); }); }
function salvarEstadoRascunho(estado) { return _tx(RASCUNHO_STORE, "readwrite", (s) => { s.put({ id: ID_ESTADO_RASCUNHO, estado }); }); }
function listarRascunho() { return _tx(RASCUNHO_STORE, "readonly", (s) => s.getAll()).then((r) => r || []); }
function limparRascunho() { return _tx(RASCUNHO_STORE, "readwrite", (s) => { s.clear(); }); }

// ---- Ficha: o que ESTE aparelho marcou em cada trecho (id "AAAA-MM|R1|np|20") ----
// Fica no celular primeiro (funciona sem sinal) e sobe pro SharePoint quando dá;
// `pendente` = mudou desde o último envio.
function salvarFichaLocal(doc) { return _tx(FICHA_STORE, "readwrite", (s) => { s.put(doc); }); }
function lerFichaLocal(id) { return _tx(FICHA_STORE, "readonly", (s) => s.get(id)); }
function listarFichasLocais() { return _tx(FICHA_STORE, "readonly", (s) => s.getAll()).then((r) => r || []); }

// Sem isso o navegador pode apagar a fila sozinho (Safari depois de ~7 dias,
// Android quando falta espaço). Não mostra pergunta nenhuma pra pessoa.
function pedirArmazenamentoPersistente() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

function pareceErroDeRede(erro) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String((erro && (erro.message || erro.error_description || erro)) || "");
  return /failed to fetch|networkerror|network request failed|load failed|timeout|ERR_INTERNET/i.test(msg);
}
