// Gera a Ficha de Inspeção .xlsx preenchida, a partir da ficha real usada como
// molde (modelos/ficha_<R>_<pav|np>.xlsx, ver ferramentas/gerar_modelo_ficha.py).
//
// Mexe direto no XML de cada aba (com JSZip), célula por célula: apaga os X
// antigos das colunas de condição nas linhas de dados e escreve "X" nas
// marcações juntadas de todo mundo. Nada mais da planilha é tocado —
// formatação, fórmulas, conferência e gráficos ficam como estão; o Excel
// recalcula tudo ao abrir (fullCalcOnLoad). Linha sem marcação sai em branco
// pro técnico completar. As OBSERVAÇÕES do molde (de outro mês) são apagadas.

const NS_PLANILHA = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function colunaParaNumero(letras) {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// Acha (ou cria, na posição certa) a <c r="F12"> dentro da <row r="12">
function celulaXml(doc, sheetData, ref, linha) {
  let row = null;
  for (const r of sheetData.children) if (r.getAttribute("r") === String(linha)) { row = r; break; }
  if (!row) {
    row = doc.createElementNS(NS_PLANILHA, "row");
    row.setAttribute("r", String(linha));
    const depois = Array.from(sheetData.children).find((r) => Number(r.getAttribute("r")) > linha);
    sheetData.insertBefore(row, depois || null);
  }
  for (const c of row.children) if (c.getAttribute("r") === ref) return c;
  const col = colunaParaNumero(ref.replace(/\d+/g, ""));
  const c = doc.createElementNS(NS_PLANILHA, "c");
  c.setAttribute("r", ref);
  const depois = Array.from(row.children).find((x) => colunaParaNumero(x.getAttribute("r").replace(/\d+/g, "")) > col);
  row.insertBefore(c, depois || null);
  return c;
}

function escreverCelula(doc, c, texto) {
  while (c.firstChild) c.removeChild(c.firstChild);
  c.removeAttribute("t");
  if (!texto) return; // vazia (mantém o estilo da célula: bordas, cor)
  c.setAttribute("t", "inlineStr");
  const is = doc.createElementNS(NS_PLANILHA, "is");
  const t = doc.createElementNS(NS_PLANILHA, "t");
  t.textContent = texto;
  is.appendChild(t);
  c.appendChild(is);
}

// Coluna "OBSERVAÇÕES" da aba (procura o cabeçalho; texto compartilhado ou na própria célula)
function colunaObservacoes(doc, textos) {
  for (const c of doc.getElementsByTagNameNS(NS_PLANILHA, "c")) {
    const v = c.getAttribute("t") === "s" ? textos[Number(c.textContent)] : c.textContent;
    if (String(v || "").trim().toUpperCase() === "OBSERVAÇÕES") return c.getAttribute("r").replace(/\d+/g, "");
  }
  return null;
}

async function textosCompartilhados(zip) {
  const arq = zip.file("xl/sharedStrings.xml");
  if (!arq) return [];
  const doc = new DOMParser().parseFromString(await arq.async("string"), "application/xml");
  return Array.from(doc.getElementsByTagNameNS(NS_PLANILHA, "si"), (si) => si.textContent);
}

// Caminho de cada aba dentro do .xlsx: nome da aba -> "xl/worksheets/sheetN.xml"
async function mapaDeAbas(zip) {
  const parser = new DOMParser();
  const wb = parser.parseFromString(await zip.file("xl/workbook.xml").async("string"), "application/xml");
  const rels = parser.parseFromString(await zip.file("xl/_rels/workbook.xml.rels").async("string"), "application/xml");
  const alvo = {};
  for (const r of rels.getElementsByTagName("Relationship")) alvo[r.getAttribute("Id")] = r.getAttribute("Target");
  const mapa = {};
  for (const s of wb.getElementsByTagName("sheet")) {
    const id = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const t = alvo[id] || "";
    mapa[s.getAttribute("name")] = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
  }
  return mapa;
}

// marcasPorTrecho: { nºTrecho: { "SRE|km": { grupo: {c} } } }
async function montarFichaXlsx(bloco, marcasPorTrecho) {
  const resp = await fetch(bloco.arq);
  if (!resp.ok) throw new Error("não achei a planilha-molde " + bloco.arq);
  const zip = await JSZip.loadAsync(await resp.arrayBuffer());
  const abas = await mapaDeAbas(zip);
  const parser = new DOMParser(), ser = new XMLSerializer();
  const textos = await textosCompartilhados(zip);
  let marcadas = 0;
  for (const trecho of bloco.trechos) {
    const caminho = abas[trecho.aba];
    if (!caminho || !zip.file(caminho)) continue;
    const doc = parser.parseFromString(await zip.file(caminho).async("string"), "application/xml");
    const sheetData = doc.getElementsByTagNameNS(NS_PLANILHA, "sheetData")[0];
    const colObs = colunaObservacoes(doc, textos);
    const marcas = marcasPorTrecho[trecho.tr] || {};
    for (const [sre, marcos, linhasExcel] of trecho.sres) {
      for (let i = 0; i < linhasExcel.length; i++) {
        const linha = linhasExcel[i];
        const mk = marcas[sre + "|" + marcos[i]] || {};
        const obs = [];
        for (const g of bloco.grupos) {
          // mais de um problema no grupo (remendo E buraco): a conferência da ficha
          // aceita UM X por grupo, então o X vai no pior e o conjunto vai nas OBSERVAÇÕES
          const c = mk[g.id] && mk[g.id].c;
          const k0 = piorIndice(g, c);
          if (listaCodigos(c).length > 1) obs.push(g.nome + ": " + textoExtenso(bloco.f, g, c));
          g.cols.forEach((col, k) => {
            const x = k === k0;
            escreverCelula(doc, celulaXml(doc, sheetData, col + linha, linha), x ? "X" : "");
            if (x) marcadas++;
          });
        }
        // a observação do mês do molde não vale pra esta ficha
        if (colObs) escreverCelula(doc, celulaXml(doc, sheetData, colObs + linha, linha), obs.join("; "));
      }
    }
    zip.file(caminho, ser.serializeToString(doc));
  }
  // Excel recalcula conferência/resumo/gráficos ao abrir
  const wbXml = parser.parseFromString(await zip.file("xl/workbook.xml").async("string"), "application/xml");
  let calc = wbXml.getElementsByTagNameNS(NS_PLANILHA, "calcPr")[0];
  if (!calc) { calc = wbXml.createElementNS(NS_PLANILHA, "calcPr"); wbXml.documentElement.appendChild(calc); }
  calc.setAttribute("fullCalcOnLoad", "1");
  zip.file("xl/workbook.xml", ser.serializeToString(wbXml));
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
  return { blob, marcadas };
}

// Junta o que tem no SharePoint (todos os trechos, todo mundo) com o que está
// só neste celular, monta a planilha e baixa.
async function baixarFichaXlsx(r, f, comp, botaoTocado) {
  const bloco = blocoFicha(r, f);
  const botao = botaoTocado || document.getElementById("btn-baixar-ficha");
  const textoBotao = botao ? botao.textContent : "";
  if (botao) { botao.disabled = true; botao.textContent = "Montando a planilha…"; }
  try {
    let docs = [];
    if (!semSinal()) {
      try { docs = await apiLerFicha(comp, r, f); } catch (erro) { console.error("Sem as marcações do SharePoint:", erro); }
    }
    const locais = (await listarFichasLocais()).filter((d) => d.comp === comp && d.r === r && d.f === f);
    const porTrecho = {};
    for (const d of docs) if (d.dispositivo !== DISPOSITIVO) (porTrecho[d.tr] = porTrecho[d.tr] || []).push(d);
    for (const d of locais) (porTrecho[d.tr] = porTrecho[d.tr] || []).push({ marcas: d.marcas });
    // o que está aberto agora (pode ter mudado há menos de 1 s e ainda não foi gravado)
    if (fichaState.tr && fichaState.r === r && fichaState.f === f && fichaState.comp === comp) {
      porTrecho[fichaState.tr] = (porTrecho[fichaState.tr] || []).concat([{ marcas: fichaState.minhas }]);
    }
    const marcasPorTrecho = {};
    for (const [tr, lista] of Object.entries(porTrecho)) marcasPorTrecho[tr] = juntarMarcacoes(lista);
    const { blob, marcadas } = await montarFichaXlsx(bloco, marcasPorTrecho);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "FICHA INSPECAO " + comp + " " + r + " " + (f === "np" ? "NAO PAVIMENTADAS" : "PAVIMENTADAS") + ".xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    if (botao) botao.textContent = "Baixada (" + marcadas + " marcações)" + (semSinal() ? " — sem sinal: só o que está neste celular" : "");
    setTimeout(() => { if (botao) { botao.textContent = textoBotao; botao.disabled = false; } }, 4000);
    return { marcadas };
  } catch (erro) {
    console.error(erro);
    alert("Não consegui montar a planilha: " + (erro.message || erro));
    if (botao) { botao.textContent = textoBotao; botao.disabled = false; }
  }
}
