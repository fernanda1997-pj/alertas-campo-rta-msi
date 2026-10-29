# Alertas de Campo RTA-MSI

App (PWA) pro pessoal de campo avisar o escritório do que está ruim na rodovia:
foto + GPS → S.R.E. e km da Ficha de Inspeção → coluna da ficha → gravidade →
observação. Funciona sem sinal (fila no celular). O escritório acompanha e
responde na aba **Painel** e baixa as **Linhas da ficha (CSV)**.

HTML/JS puro, sem build. Usa o **mesmo projeto Supabase do Fotos de Campo**,
com tabela e bucket próprios.

**Sem login** (decisão de 2026-10-29): quem tem o link usa tudo, inclusive o
Painel. A pessoa digita o nome uma vez e ele fica salvo no aparelho. As
travas que sobram estão no topo do `schema.sql`: ninguém apaga nada pelo
site e, depois de criado, o alerta só muda nos campos de tratamento.
**Não divulgar o link fora da equipe.**

## Publicar (primeira vez)

1. **Supabase** (projeto do Fotos de Campo) → SQL Editor → colar e rodar `schema.sql`.
2. **Vercel** → Add New Project → importar o repositório → Deploy (sem configuração).

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
