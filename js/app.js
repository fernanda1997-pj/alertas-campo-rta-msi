// Shell da aplicação: sessão, quem é do escritório, troca de aba, sair.

let USUARIO_ATUAL = null;
let EH_ADMIN = false;

(async function iniciar() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    window.location.href = "index.html";
    return;
  }
  USUARIO_ATUAL = data.session.user;
  document.getElementById("usuario-atual").textContent = USUARIO_ATUAL.email;
  pedirArmazenamentoPersistente();

  await atualizarContagemFila();
  renderAlerta();
  processarFila();

  // Aba Painel só aparece pra quem está na tabela alertas_admins
  if (!semSinal()) {
    const { data: admin } = await supabaseClient.from("alertas_admins").select("email").ilike("email", USUARIO_ATUAL.email).maybeSingle();
    EH_ADMIN = !!admin;
  }
  if (EH_ADMIN) {
    document.getElementById("tabbtn-painel").style.display = "";
    atualizarSeloPainel();
    setInterval(atualizarSeloPainel, 120000); // aviso de alerta novo sem precisar recarregar
  }
})();

document.getElementById("btn-sair").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
});

function mudarAba(aba) {
  for (const nome of ["alerta", "meus", "painel"]) {
    document.getElementById("aba-" + nome).style.display = aba === nome ? "" : "none";
    document.getElementById("tabbtn-" + nome).classList.toggle("active", aba === nome);
  }
  if (aba === "alerta") renderAlerta();
  if (aba === "meus") carregarMeus();
  if (aba === "painel") carregarPainel();
}
