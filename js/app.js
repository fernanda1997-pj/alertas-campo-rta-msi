// Shell da aplicação: quem está usando (sem login), troca de aba.
//
// Sem login (decisão de 2026-10-29): a pessoa digita o nome uma vez e ele fica
// salvo no celular, junto com um id aleatório do aparelho. O nome vai em cada
// alerta (e em quem tratou, no Painel). O id do aparelho também vai em cada
// alerta — hoje não é usado na tela (a aba "Meus alertas" saiu em 2026-10-29),
// mas permite saber quais alertas saíram do mesmo celular.

const CHAVE_NOME = "alertas_nome";
const CHAVE_DISPOSITIVO = "alertas_dispositivo";

function lerLocal(chave) { try { return localStorage.getItem(chave) || ""; } catch (e) { return ""; } }
function gravarLocal(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) { /* modo privado: segue sem guardar */ } }

let NOME_USUARIO = lerLocal(CHAVE_NOME);
const DISPOSITIVO = lerLocal(CHAVE_DISPOSITIVO) || (() => {
  const id = crypto.randomUUID();
  gravarLocal(CHAVE_DISPOSITIVO, id);
  return id;
})();

function definirNome(nome) {
  NOME_USUARIO = nome.trim();
  gravarLocal(CHAVE_NOME, NOME_USUARIO);
  mostrarNome();
}

function mostrarNome() {
  document.getElementById("usuario-atual").textContent = NOME_USUARIO || "";
  document.getElementById("btn-trocar-nome").textContent = NOME_USUARIO ? "Trocar nome" : "";
}

document.getElementById("btn-trocar-nome").addEventListener("click", () => {
  const novo = prompt("Seu nome (aparece pro escritório):", NOME_USUARIO);
  if (novo != null && novo.trim()) { definirNome(novo); renderAlerta(); }
});

// Tudo até 29/10/2026 foi teste (pedido de 29/10): os dados do SharePoint foram
// apagados lá, e cada aparelho apaga uma vez o que guardou (fichas marcadas, alerta
// na fila, rascunho) — senão a ficha de teste subia de novo ao reabrir o trecho.
// Nome e id do aparelho ficam. Sem localStorage (modo privado) não limpa: sem a
// marca, apagaria a fila a cada vez que o app abrisse.
const LIMPEZA_TESTES = "2026-10-29";
async function limparDadosDeTeste() {
  if (lerLocal("alertas_limpeza") === LIMPEZA_TESTES) return;
  gravarLocal("alertas_limpeza", LIMPEZA_TESTES);
  if (lerLocal("alertas_limpeza") !== LIMPEZA_TESTES) return;
  gravarLocal("alertas_ficha_ultima", "");
  try { await limparTudoLocal(); } catch (erro) { console.error("Não consegui limpar os dados de teste:", erro); }
}

(async function iniciar() {
  mostrarNome();
  await limparDadosDeTeste();
  pedirArmazenamentoPersistente();
  await atualizarContagemFila();
  renderAlerta();
  await recuperarRascunho(); // alerta que ficou pela metade quando o app fechou
  processarFila();
  enviarFichasPendentes(); // ficha preenchida sem sinal numa sessão anterior
  atualizarSeloPainel();
  setInterval(() => atualizarSeloPainel(), 300000); // aviso de alerta novo sem precisar recarregar (5 min)
})();

function mudarAba(aba) {
  for (const nome of ["alerta", "ficha", "painel"]) {
    document.getElementById("aba-" + nome).style.display = aba === nome ? "" : "none";
    document.getElementById("tabbtn-" + nome).classList.toggle("active", aba === nome);
  }
  if (aba === "alerta") renderAlerta();
  if (aba === "ficha") abrirAbaFicha();
  if (aba === "painel") carregarPainel();
}
