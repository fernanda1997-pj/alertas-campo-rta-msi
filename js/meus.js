// "Meus alertas": o que a pessoa de campo mandou e o que o escritório fez com
// cada um. É o retorno que faz o pessoal continuar avisando — sem ele, o
// alerta vira um buraco negro e o campo volta pro WhatsApp.

let meusState = { carregou: false, carregando: false, erro: "", lista: [] };

async function carregarMeus() {
  meusState.carregando = true; meusState.erro = "";
  renderMeus();
  try {
    // sem login: "meus" = os que saíram deste celular
    meusState.lista = (await apiListarAlertas()).filter((a) => a.dispositivo === DISPOSITIVO).slice(0, 200);
    meusState.carregou = true;
  } catch (erro) {
    console.error(erro);
    meusState.erro = semSinal() ? "Sem sinal — a lista aparece quando a conexão voltar." : "Não consegui carregar: " + (erro.message || erro);
  }
  meusState.carregando = false;
  renderMeus();
}

async function renderMeus() {
  const m = document.getElementById("mount-meus");
  if (!m) return;
  const s = meusState;
  let naFila = [];
  try { naFila = await listarFila(); } catch (e) { /* sem IndexedDB: segue sem a fila */ }

  const cartoesFila = naFila.map((it) =>
    '<div class="cartao-alerta cartao-fila"><div class="cartao-alerta-corpo">'
    + '<div class="cartao-alerta-topo"><span class="selo" style="--cor:var(--amber)">Esperando sinal</span>' + seloGravidade(it.gravidade) + "</div>"
    + "<b>" + esc(it.categoria) + "</b>"
    + '<div class="rotulo-mini">' + esc(rotuloRegiao(it.regiao)) + (it.trecho ? " › " + esc(it.trecho) : "") + " · " + fmtDataHora(it.capturadoEm) + "</div>"
    + (it.sre ? '<div class="km-sre">' + esc("S.R.E. " + it.sre + (typeof it.kmSre === "number" ? " · " + textoKm(it.kmSre, it.extensaoKm) : "")) + "</div>" : "")
    + '<div class="obs">' + esc(it.observacao) + "</div></div></div>"
  ).join("");

  const cartoes = s.lista.map((a) => {
    const url = a.fotos[0] && urlFoto(a.fotos[0]);
    return '<div class="cartao-alerta">'
      + (url ? '<a class="cartao-alerta-foto" href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" alt="" loading="lazy"></a>' : '<div class="cartao-alerta-foto vazio">sem foto</div>')
      + '<div class="cartao-alerta-corpo">'
      + '<div class="cartao-alerta-topo">' + seloStatus(a.status) + seloGravidade(a.gravidade) + '<span class="rotulo-mini" style="margin-left:auto;">' + tempoDesde(a.created_at) + "</span></div>"
      + "<b>" + esc(a.categoria) + "</b>"
      + '<div class="rotulo-mini">' + esc(rotuloRegiao(a.regiao)) + (a.trecho ? " › " + esc(a.trecho) : "") + " · " + fmtDataHora(a.capturado_em) + "</div>"
      + (a.sre ? '<div class="km-sre">' + esc(textoSreKmDoAlerta(a)) + "</div>" : "")
      + '<div class="obs">' + esc(a.observacao) + "</div>"
      + (a.resposta ? '<div class="resposta"><span class="rotulo-mini">Escritório respondeu:</span> ' + esc(a.resposta) + "</div>" : "")
      + (a.ponto_critico ? '<div class="resposta"><span class="rotulo-mini">Virou ponto crítico:</span> ' + esc(a.ponto_critico) + "</div>" : "")
      + "</div></div>";
  }).join("");

  m.innerHTML = '<div class="lista-tela">'
    + '<div class="lista-topo"><div class="lista-titulo">Meus alertas</div><button class="btn btn-outline btn-mini" id="btn-recarregar-meus"' + (s.carregando ? " disabled" : "") + ">" + (s.carregando ? "Carregando…" : "Recarregar") + "</button></div>"
    + (s.erro ? '<div class="banner-err">' + esc(s.erro) + "</div>" : "")
    + cartoesFila + cartoes
    + (!naFila.length && !s.lista.length && s.carregou ? '<div class="vazio-msg">Você ainda não mandou nenhum alerta.</div>' : "")
    + "</div>";
  m.querySelector("#btn-recarregar-meus").addEventListener("click", carregarMeus);
}
