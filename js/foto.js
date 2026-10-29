// Preparo da foto antes de subir: reduz pra no máximo 1600 px (sinal fraco
// na rodovia) e grava uma faixa no rodapé com local + coordenada + data/hora
// + categoria. A faixa fica nos pixels, então sobrevive a reenvio por WhatsApp
// (que apaga o GPS do EXIF). Mesmo carimbo do Fotos de Campo, com a categoria.

async function carregarImagem(arquivo) {
  // createImageBitmap corrige a rotação EXIF sozinho — tenta primeiro
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    } catch (e) {
      console.error("createImageBitmap falhou, tentando com <img>:", e);
    }
  }
  const url = URL.createObjectURL(arquivo);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Não foi possível abrir a imagem (formato não suportado?)"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepararFotoAlerta(arquivo, info) {
  const imagem = await carregarImagem(arquivo);
  const largOriginal = imagem.width || imagem.naturalWidth;
  const altOriginal = imagem.height || imagem.naturalHeight;
  const escala = Math.min(1, 1600 / Math.max(largOriginal, altOriginal));
  const largura = Math.round(largOriginal * escala);
  const altura = Math.round(altOriginal * escala);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imagem, 0, 0, largura, altura);

  const quando = info.capturadoEm ? new Date(info.capturadoEm) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  const dataHora = p(quando.getDate()) + "/" + p(quando.getMonth() + 1) + "/" + quando.getFullYear() + " " + p(quando.getHours()) + ":" + p(quando.getMinutes());
  const temCoord = typeof info.gpsLat === "number" && typeof info.gpsLng === "number";
  const linha1 = "ALERTA · " + info.categoria + (info.regiao && info.trecho ? " · " + info.regiao + " › " + info.trecho : "");
  const linha2 = (temCoord ? info.gpsLat.toFixed(5) + ", " + info.gpsLng.toFixed(5) : "Sem coordenada GPS") + " · " + dataHora + (info.sre ? " · SRE " + info.sre : "")
    + (typeof info.kmSre === "number" ? " km " + info.kmSre.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

  const k = largura / 1000;
  const alturaFaixa = Math.max(64, Math.round(96 * k));
  const padX = Math.max(14, Math.round(18 * k));
  const larguraMax = largura - 2 * padX;
  const caber = (texto, tamanho, peso) => {
    let t = tamanho;
    ctx.font = peso + t + "px sans-serif";
    while (t > 10 && ctx.measureText(texto).width > larguraMax) { t -= 1; ctx.font = peso + t + "px sans-serif"; }
    return t;
  };
  const f1Base = Math.max(20, Math.round(34 * k));
  const f1 = caber(linha1, f1Base, "bold ");
  const f2 = caber(linha2, Math.max(15, Math.round(23 * k)), "");

  ctx.fillStyle = "rgba(15,23,42,0.72)";
  ctx.fillRect(0, altura - alturaFaixa, largura, alturaFaixa);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold " + f1 + "px sans-serif";
  ctx.fillText(linha1, padX, altura - alturaFaixa + Math.round(6 * k));
  ctx.fillStyle = "#cbd5e1";
  ctx.font = f2 + "px sans-serif";
  ctx.fillText(linha2, padX, altura - alturaFaixa + Math.round(6 * k) + f1Base + Math.round(3 * k));

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  canvas.width = 0; canvas.height = 0; // solta a memória (Safari tem teto de canvas)
  if (imagem.close) imagem.close();
  if (!blob) throw new Error("canvas.toBlob retornou vazio");
  return new File([blob], "foto.jpg", { type: "image/jpeg" });
}
