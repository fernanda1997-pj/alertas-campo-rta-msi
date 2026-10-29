// Fila de envio offline no IndexedDB: o alerta registrado sem sinal fica
// guardado no celular (sobrevive a fechar o app) e sobe sozinho quando a
// conexão voltar. As fotos (File) vão direto pro IndexedDB, sem base64.

const FILA_DB_NOME = "alertas-campo-fila";
const FILA_STORE = "alertas";

function abrirFilaDB() {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(FILA_DB_NOME, 1);
    pedido.onupgradeneeded = () => {
      if (!pedido.result.objectStoreNames.contains(FILA_STORE)) {
        pedido.result.createObjectStore(FILA_STORE, { keyPath: "id" });
      }
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

function _txFila(modo, acao) {
  return abrirFilaDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(FILA_STORE, modo);
    const pedido = acao(tx.objectStore(FILA_STORE));
    tx.oncomplete = () => resolve(pedido ? pedido.result : undefined);
    tx.onerror = () => reject(tx.error);
  }));
}

function salvarNaFila(item) { return _txFila("readwrite", (s) => { s.put(item); }); }
function listarFila() { return _txFila("readonly", (s) => s.getAll()).then((r) => r || []); }
function removerDaFila(id) { return _txFila("readwrite", (s) => { s.delete(id); }); }

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
