// Página que o link do e-mail de recuperação abre (ver
// resetPasswordForEmail em js/auth.js). O supabase-js já detecta sozinho o
// token que vem na URL e cria uma sessão temporária "de recuperação" — só dá
// pra usar essa sessão pra trocar a senha, nada mais.

const formNovaSenha = document.getElementById("form-nova-senha");
const caixaErro = document.getElementById("erro");
const msgOk = document.getElementById("msg-ok");
const btnSalvar = document.getElementById("btn-salvar-senha");
const linkIrLogin = document.getElementById("link-ir-login");

let sessaoRecuperacaoOk = false;

function mostrarErroLinkInvalido() {
  formNovaSenha.style.display = "none";
  caixaErro.textContent = "Esse link de recuperação é inválido ou já expirou. Volte para o login e clique em \"Esqueci minha senha\" para pedir um novo.";
  caixaErro.hidden = false;
  linkIrLogin.style.display = "block";
}

supabaseClient.auth.onAuthStateChange((evento) => {
  if (evento === "PASSWORD_RECOVERY") sessaoRecuperacaoOk = true;
});

// Dá um tempo pro supabase-js processar o token da URL (evento acima) antes
// de decidir que o link é inválido — sem isso, a checagem correria rápido
// demais e sempre acharia que não tem sessão nenhuma.
(async function checarLink() {
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (!sessaoRecuperacaoOk) {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) sessaoRecuperacaoOk = true;
  }
  if (!sessaoRecuperacaoOk) mostrarErroLinkInvalido();
})();

formNovaSenha.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  caixaErro.hidden = true;
  msgOk.hidden = true;

  const novaSenha = document.getElementById("nova-senha").value;
  const confirmarSenha = document.getElementById("confirmar-senha").value;

  if (novaSenha !== confirmarSenha) {
    caixaErro.textContent = "As duas senhas precisam ser iguais.";
    caixaErro.hidden = false;
    return;
  }
  if (!sessaoRecuperacaoOk) {
    mostrarErroLinkInvalido();
    return;
  }

  btnSalvar.disabled = true;
  btnSalvar.textContent = "Salvando...";
  try {
    const { error } = await supabaseClient.auth.updateUser({ password: novaSenha });
    if (error) throw error;

    formNovaSenha.style.display = "none";
    msgOk.textContent = "Senha atualizada com sucesso! Você já pode entrar com a senha nova.";
    msgOk.hidden = false;
    linkIrLogin.style.display = "block";
    await supabaseClient.auth.signOut(); // encerra a sessão temporária de recuperação; login de verdade acontece na tela de login
  } catch (e) {
    caixaErro.textContent = "Não foi possível salvar a senha: " + (e.message || e);
    caixaErro.hidden = false;
    btnSalvar.disabled = false;
    btnSalvar.textContent = "Salvar nova senha";
  }
});
