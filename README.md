# Alertas de Campo RTA-MSI

App (PWA) pro pessoal de campo avisar o escritório do que está ruim na rodovia:
foto + GPS → S.R.E. e km da Ficha de Inspeção → coluna da ficha → gravidade →
observação. Funciona sem sinal (fila no celular). O escritório acompanha e
responde na aba **Painel** e baixa as **Linhas da ficha (CSV)**.

HTML/JS puro, sem build. Usa o **mesmo projeto Supabase do Fotos de Campo**
(mesmo login), com tabelas e bucket próprios.

## Publicar (primeira vez)

1. **Supabase** (projeto do Fotos de Campo) → SQL Editor → colar e rodar `schema.sql`.
2. **Authentication → URL Configuration → Redirect URLs**: incluir
   `https://<endereço-do-vercel>/redefinir-senha.html`.
3. **Vercel** → Add New Project → importar o repositório → Deploy (sem configuração).
4. Quem cuida do Painel: e-mails na tabela `alertas_admins`
   (`insert into alertas_admins (email) values ('fulano@...');`).

Usuários de campo são os mesmos do Fotos de Campo (Authentication → Users).

## Atualizar o km dos S.R.E.

`js/sre-km.js` é gerado a partir dos shapefiles usados pelas fichas
(`web - fichas/camadas/R*_TRECHOS.shp`) e da situação de cada S.R.E.
(`web/dados/trechos_shp.zip`). Quando eles mudarem:

    python ferramentas/gerar_sre_km.py

## Colunas da ficha

Ficam em `FICHAS` (`js/dados.js`), no modelo de set/2026. Se o modelo da ficha
mudar, atualizar lá.

## Testar sem Supabase

`_teste_local.html` + `_mock.js` (fora do git) rodam o app com banco e GPS
simulados: servidor `alertas-campo` (porta 8781) do `web/.claude/launch.json`.
