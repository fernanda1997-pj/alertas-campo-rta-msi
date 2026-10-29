-- ==========================================================================
-- Alertas de Campo RTA-MSI — schema Supabase (Postgres)
--
-- Roda no MESMO projeto Supabase do Fotos de Campo (atpzdqgsqsxevxctgzss).
-- Não mexe na tabela `fotos` nem no bucket `fotos-campo`.
--
-- SEM LOGIN (decisão de 2026-10-29): o site acessa como `anon` (a chave
-- pública que fica em js/config.js). Isso quer dizer que QUALQUER pessoa com
-- o link pode ver e mandar alertas e mudar o status no Painel. As travas
-- abaixo limitam o estrago possível sem exigir login:
--   - ninguém apaga alerta nem foto pelo site (não existe policy de delete);
--   - depois de criado, só dá pra mudar os campos de TRATAMENTO (status,
--     resposta, ponto_critico, tratado_por, tratado_em) — foto, local,
--     observação e itens da ficha ficam como o campo mandou;
--   - o bucket só aceita imagem de até 5 MB.
-- Pra fechar com login no futuro, trocar `to anon, authenticated` por
-- `to authenticated` nas policies.
--
-- Rodar isso inteiro em: Supabase > SQL Editor > New query > Run
-- ==========================================================================

create extension if not exists "pgcrypto";

create table if not exists alertas (
  id uuid primary key default gen_random_uuid(),
  -- local (GPS do celular → S.R.E. mais próximo; dá pra corrigir o trecho à mão)
  regiao text,                          -- ex: "R11"
  trecho text,                          -- ex: "RODOVIA TO-373 - TRECHO ALVORADA - ARAGUAÇU"
  sre text,                             -- código do S.R.E. mais próximo
  km_sre numeric,                       -- km dentro do S.R.E. (0 = INÍCIO), o mesmo da Ficha de Inspeção
  distancia_eixo_m numeric,             -- distância do GPS até o eixo da rodovia
  gps_lat numeric,
  gps_lng numeric,
  -- o que o pessoal de campo informa
  tipo_ficha text not null,             -- 'pav' | 'np' — qual Ficha de Inspeção (vem da situação do S.R.E.)
  itens jsonb not null default '{}',    -- {grupo da ficha: código da coluna}, ex. {"pavimento":"BUR. L.","outro":"Erosão"} — ver FICHAS em js/dados.js
  categoria text not null,              -- resumo legível dos itens ("Buracos ao longo · Vegetação inadequada")
  gravidade text not null,              -- 'baixa' | 'media' | 'urgente'
  observacao text,                      -- nas palavras de quem viu (vai nas OBSERVAÇÕES da ficha)
  fotos text[] not null default '{}',   -- caminhos dentro do bucket "alertas"
  capturado_em timestamptz not null,    -- quando a pessoa registrou (não quando o sinal voltou)
  autor_nome text,                      -- nome digitado no celular (sem login, não é verificado)
  dispositivo text,                     -- id aleatório guardado no celular — é o que alimenta "Meus alertas"
  -- o que o escritório faz com ele
  status text not null default 'novo',  -- 'novo' | 'visto' | 'em_andamento' | 'resolvido' | 'descartado'
  resposta text,                        -- retorno do escritório (aparece em "Meus alertas")
  ponto_critico text,                   -- se virou ponto crítico: "R1 nº 183", por exemplo
  tratado_por text,                     -- nome digitado no celular/computador de quem tratou
  tratado_em timestamptz,
  created_at timestamptz default now()
);

create index if not exists alertas_status_idx on alertas (status);
create index if not exists alertas_sre_idx on alertas (sre, km_sre);
create index if not exists alertas_criado_idx on alertas (created_at desc);
create index if not exists alertas_dispositivo_idx on alertas (dispositivo);

alter table alertas enable row level security;
drop policy if exists "alertas_select" on alertas;
drop policy if exists "alertas_insert" on alertas;
drop policy if exists "alertas_update" on alertas;
create policy "alertas_select" on alertas for select to anon, authenticated using (true);
create policy "alertas_insert" on alertas for insert to anon, authenticated
  with check (status = 'novo' and resposta is null and ponto_critico is null and tratado_por is null and tratado_em is null);
create policy "alertas_update" on alertas for update to anon, authenticated using (true) with check (true);

-- Trava por coluna: depois de criado, só o tratamento muda
revoke update on alertas from anon, authenticated;
grant update (status, resposta, ponto_critico, tratado_por, tratado_em) on alertas to anon, authenticated;
revoke delete on alertas from anon, authenticated;

-- ==========================================================================
-- Storage: bucket privado só das fotos de alerta (separado do "fotos-campo").
-- Privado = a foto só abre por link temporário gerado pelo site.
-- ==========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('alertas', 'alertas', false, 5242880, array['image/*'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "alertas_fotos_select" on storage.objects;
drop policy if exists "alertas_fotos_insert" on storage.objects;
create policy "alertas_fotos_select" on storage.objects for select to anon, authenticated using (bucket_id = 'alertas');
create policy "alertas_fotos_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'alertas');
