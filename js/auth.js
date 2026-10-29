// Lógica da tela de login (index.html).
// Não existe cadastro público: os usuários são criados manualmente no painel
// do Supabase (Authentication > Users > Add user) pela coordenação.
// "Esqueci minha senha" é self-service: manda um e-mail com um link mágico
// (supabaseClient.auth.resetPasswordForEmail) que abre redefinir-senha.html
// já autenticado numa sessão temporária de recuperação, só pra trocar a senha.

(async function redirecionarSeJaLogado() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) {
      window.location.href = "app.html";
    }
  } catch (e) {
    console.error("Não foi possível verificar a sessão:", e);
  }
})();

const formLogin = document.getElementById("form-login");
const caixaErro = document.getElementById("erro");
const btnEntrar = document.getElementById("btn-entrar");

formLogin.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  caixaErro.hidden = true;
  btnEntrar.disabled = true;
  btnEntrar.textContent = "Entrando...";

  try {
    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;

    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error) {
      caixaErro.textContent = "E-mail ou senha inválidos.";
      caixaErro.hidden = false;
      btnEntrar.disabled = false;
      btnEntrar.textContent = "Entrar";
      return;
    }

    window.location.href = "app.html";
  } catch (e) {
    // Nunca deixar o botão travado em "Entrando..." silenciosamente —
    // mostra o erro de verdade (ex.: config.js com credenciais erradas).
    caixaErro.textContent = "Erro ao conectar: " + (e.message || e);
    caixaErro.hidden = false;
    btnEntrar.disabled = false;
    btnEntrar.textContent = "Entrar";
  }
});

// --- "Esqueci minha senha" ---
const formRecuperar = document.getElementById("form-recuperar");
const msgRecuperacao = document.getElementById("msg-recuperacao");
const btnEnviarRecuperacao = document.getElementById("btn-enviar-recuperacao");

function mostrarFormRecuperar(mostrar) {
  formLogin.style.display = mostrar ? "none" : "flex";
  formRecuperar.style.display = mostrar ? "flex" : "none";
  caixaErro.hidden = true;
  msgRecuperacao.hidden = true;
}

document.getElementById("link-esqueci-senha").addEventListener("click", (e) => {
  e.preventDefault();
  mostrarFormRecuperar(true);
});
document.getElementById("link-voltar-login").addEventListener("click", (e) => {
  e.preventDefault();
  mostrarFormRecuperar(false);
});

formRecuperar.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  msgRecuperacao.hidden = true;
  btnEnviarRecuperacao.disabled = true;
  btnEnviarRecuperacao.textContent = "Enviando...";

  try {
    const email = document.getElementById("email-recuperar").value.trim();
    // redireciona pra uma página própria de "definir nova senha" depois que
    // a pessoa clicar no link do e-mail (o Supabase abre essa URL já com uma
    // sessão temporária de recuperação).
    const urlRedirecionamento = window.location.origin + "/redefinir-senha.html";
    await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: urlRedirecionamento });

    // Sempre mostra a mesma mensagem de sucesso, exista ou não esse e-mail
    // cadastrado — não dá pra confirmar/negar publicamente se um e-mail tem
    // conta (evita que alguém use esse formulário pra descobrir e-mails
    // válidos da empresa).
    msgRecuperacao.textContent = "Se esse e-mail estiver cadastrado, enviamos um link de recuperação para ele. Confira também a caixa de spam.";
    msgRecuperacao.hidden = false;
    formRecuperar.reset();
  } catch (e) {
    msgRecuperacao.textContent = "Erro ao enviar o link: " + (e.message || e);
    msgRecuperacao.hidden = false;
  }

  btnEnviarRecuperacao.disabled = false;
  btnEnviarRecuperacao.textContent = "Enviar link de recuperação";
});
