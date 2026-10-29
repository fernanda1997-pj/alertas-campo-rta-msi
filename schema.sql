-- ==========================================================================
-- Alertas de Campo RTA-MSI — schema Supabase (Postgres)
--
-- Roda no MESMO projeto Supabase do Fotos de Campo (atpzdqgsqsxevxctgzss) —
-- de propósito: o pessoal de campo entra com o mesmo e-mail e senha que já
-- usa no Fotos de Campo, sem cadastro novo. Não mexe na tabela `fotos`.
--
-- Rodar isso inteiro em: Supabase > SQL Editor > New query > Run
-- (pode rodar de novo sem problema — tudo é "if not exists"/"drop if exists")
-- ==========================================================================

create extension if not exists "pgcrypto";

-- ---------- QUEM CUIDA DOS ALERTAS (escritório) ----------
-- Só quem está nesta lista vê a aba "Painel" e pode mudar o status de um
-- alerta. Pra incluir o supervisor depois, é só rodar outro insert com o
-- e-mail de login dele (o mesmo do Fotos de Campo).
create table if not exists alertas_admins (
  email text primary key
);
insert into alertas_admins (email) values ('fernanda.borges.pj@gmail.com') on conflict do nothing;

alter table alertas_admins enable row level security;
drop policy if exists "alertas_admins_select" on alertas_admins;
create policy "alertas_admins_select" on alertas_admins for select to authenticated using (true);

create or replace function eh_admin_alertas() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from alertas_admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- ---------- ALERTAS ----------
create table if not exists alertas (
  id uuid primary key default gen_random_uuid(),
  -- local (GPS do celular → trecho mais próximo; pode ser corrigido à mão no envio)
  regiao text,                          -- ex: "R11"
  trecho text,                          -- ex: "RODOVIA TO-373 - TRECHO ALVORADA - ARAGUAÇU"
  sre text,                             -- código SRE do segmento mais próximo
  km_sre numeric,                       -- km dentro do S.R.E. (0 = INÍCIO), o mesmo da Ficha de Inspeção
  distancia_eixo_m numeric,             -- distância do GPS até o eixo da rodovia
  gps_lat numeric,
  gps_lng numeric,
  -- o que o pessoal de campo informa
  tipo_ficha text not null,             -- 'pav' | 'np' — qual Ficha de Inspeção (vem da situação do S.R.E.)
  itens jsonb not null default '{}',    -- {grupo da ficha: código da coluna}, ex. {"pavimento":"BUR. L.","vegetacao":"INAD.","outro":"Erosão"} — ver FICHAS em js/dados.js
  categoria text not null,              -- resumo legível dos itens ("Buracos ao longo · Vegetação inadequada")
  gravidade text not null,              -- 'baixa' | 'media' | 'urgente'
  observacao text,                      -- nas palavras de quem viu (vai nas OBSERVAÇÕES da ficha)
  fotos text[] not null default '{}',   -- caminhos dentro do bucket "alertas"
  capturado_em timestamptz not null,    -- quando a pessoa registrou (não quando o sinal voltou)
  autor_email text,
  -- o que o escritório faz com ele
  status text not null default 'novo',  -- 'novo' | 'visto' | 'em_andamento' | 'resolvido' | 'descartado'
  resposta text,                        -- retorno do escritório (o autor vê em "Meus alertas")
  ponto_critico text,                   -- se virou ponto crítico: "R1 nº 183", por exemplo
  tratado_por text,
  tratado_em timestamptz,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id) default auth.uid()
);

create index if not exists alertas_status_idx on alertas (status);
create index if not exists alertas_sre_idx on alertas (sre, km_sre);
create index if not exists alertas_criado_idx on alertas (created_at desc);
create index if not exists alertas_autor_idx on alertas (created_by);

-- Campo só pode criar alerta em nome próprio, e só com status "novo".
-- Todo mundo logado enxerga todos os alertas (serve pra ver se o problema
-- já foi avisado por outra pessoa). Só o escritório altera ou exclui.
alter table alertas enable row level security;
drop policy if exists "alertas_select" on alertas;
drop policy if exists "alertas_insert" on alertas;
drop policy if exists "alertas_update_admin" on alertas;
drop policy if exists "alertas_delete_admin" on alertas;
create policy "alertas_select" on alertas for select to authenticated using (true);
create policy "alertas_insert" on alertas for insert to authenticated
  with check (created_by = auth.uid() and status = 'novo' and resposta is null and tratado_por is null);
create policy "alertas_update_admin" on alertas for update to authenticated using (eh_admin_alertas()) with check (eh_admin_alertas());
create policy "alertas_delete_admin" on alertas for delete to authenticated using (eh_admin_alertas());

-- ==========================================================================
-- Storage: bucket privado só das fotos de alerta (separado do "fotos-campo")
-- ==========================================================================
insert into storage.buckets (id, name, public)
values ('alertas', 'alertas', false)
on conflict (id) do nothing;

drop policy if exists "alertas_fotos_select" on storage.objects;
drop policy if exists "alertas_fotos_insert" on storage.objects;
drop policy if exists "alertas_fotos_delete_admin" on storage.objects;
create policy "alertas_fotos_select" on storage.objects for select to authenticated using (bucket_id = 'alertas');
create policy "alertas_fotos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'alertas');
create policy "alertas_fotos_delete_admin" on storage.objects for delete to authenticated using (bucket_id = 'alertas' and eh_admin_alertas());
