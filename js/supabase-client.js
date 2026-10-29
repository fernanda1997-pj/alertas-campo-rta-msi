// Cliente Supabase compartilhado por toda a aplicação.
// Depende do SDK carregado via CDN (ver <script> no HTML) e de js/config.js.
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);
