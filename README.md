# Alertas de Campo RTA-MSI

App (PWA) pro pessoal de campo avisar o escritório do que está ruim na rodovia:
foto + GPS → S.R.E. e km da Ficha de Inspeção → coluna da ficha → gravidade →
observação. Funciona sem sinal (fila no celular). O escritório acompanha e
responde na aba **Painel** e baixa as **Linhas da ficha (CSV)**.

Publicado em **https://alertas-campo-rta-msi-6qu1.vercel.app**.

HTML/JS puro, sem build. Os dados ficam no **SharePoint da empresa**, pela
mesma conexão (aplicativo do Microsoft 365) do Fotos de Campo:

    Alertas-Campo/dados/<id>.json                       um arquivo por alerta
    Alertas-Campo/fotos/R1/TO-201/2026-10-29/<id>/1.jpg

Quem fala com o SharePoint são as functions `api/alertas.js` e `api/foto.js`
(o navegador nunca vê as credenciais).

**Sem login** (decisão de 2026-10-29): quem tem o link usa tudo, inclusive o
Painel. A pessoa digita o nome uma vez e ele fica salvo no aparelho. As
travas ficam nas functions: ninguém apaga nada pelo site, o alerta nasce
sempre "novo", depois de criado só mudam status/resposta/ponto crítico, e só
entra foto JPEG no caminho que o site gera. **Não divulgar o link fora da equipe.**

## Publicar (primeira vez)

1. **Vercel** → projeto do **Fotos de Campo** → Settings → Environment Variables:
   copiar os valores de `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`,
   `MS_SITE_ID` (e `MS_PASTA_BASE`, se existir).
2. **Vercel** → projeto **alertas-campo-rta-msi** → Settings → Environment
   Variables: criar as mesmas, com os mesmos valores.
3. Deployments → último → **Redeploy** (variável nova só vale depois de publicar de novo).

Se faltar alguma variável, o app mostra "SharePoint não configurado".

## Atualizar o km dos S.R.E.

`js/sre-km.js` é gerado a partir dos shapefiles usados pelas fichas
(`web - fichas/camadas/R*_TRECHOS.shp`) e da situação de cada S.R.E.
(`web/dados/trechos_shp.zip`). Quando eles mudarem:

    python ferramentas/gerar_sre_km.py

## Colunas da ficha

Ficam em `FICHAS` (`js/dados.js`), no modelo de set/2026. Se o modelo da ficha
mudar, atualizar lá.

## Testar sem SharePoint

`_teste_local.html` + `_mock.js` (fora do git) rodam o app com as functions
de verdade no navegador, um SharePoint falso em memória e GPS simulado:
servidor `alertas-campo` (porta 8781) do `web/.claude/launch.json`.

## Limite conhecido

Cada abertura do Painel lê todos os arquivos de alerta do SharePoint. Com
algumas centenas é rápido; se passar de ~2.000, vale arquivar os resolvidos
numa subpasta.
