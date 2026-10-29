// GPS do celular + trecho mais próximo. Mesma lógica do Fotos de Campo
// (web - Fotos/js/envio.js), copiada pra cá porque os dois apps são separados.
// Se mudar a regra lá (ex.: DISTANCIA_MAXIMA_M), mudar aqui também.

const DISTANCIA_MAXIMA_M = 3000; // além disso, não confia no trecho mais próximo achado

// Se a pessoa negar a permissão de localização ou o aparelho não conseguir
// uma leitura, devolve null — nunca inventa coordenada.
function obterCoordenadasReais() {
  const leitura = new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precisao: pos.coords.accuracy }),
      (erro) => { console.error("Não foi possível obter o GPS:", erro); resolve(null); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });
  // alguns navegadores nunca chamam nenhum dos callbacks com a permissão bloqueada
  const limite = new Promise((resolve) => setTimeout(() => resolve(null), 13000));
  return Promise.race([leitura, limite]);
}

function distanciaPontoSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Projeção equiretangular local — precisa o bastante na escala de uma região.
// Retorna {regiao, trecho, sre, distancia (m)} ou null.
function encontrarTrechoMaisProximo(lat, lng) {
  const R = 6371000;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const proj = (lo, la) => [(lo - lng) * Math.PI / 180 * R * cosLat, (la - lat) * Math.PI / 180 * R];
  let melhor = null;
  for (const seg of SEGMENTOS_GEO) {
    const pts = seg.pontos.map((p) => proj(p[0], p[1]));
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distanciaPontoSegmento(0, 0, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (!melhor || d < melhor.distancia) melhor = { regiao: seg.regiao, trecho: seg.trecho, sre: seg.sre || "", distancia: d };
    }
  }
  return melhor;
}

// Em qual S.R.E. e em qual km dele o ponto está — o km da Ficha de Inspeção
// (km 0 = INÍCIO do S.R.E.). SRE_KM (js/sre-km.js) traz, em cada vértice, os
// metros desde o início, calculados pelo mesmo converter das fichas; aqui
// só projeta o ponto no trecho de reta mais perto e interpola.
// soDoTrecho: depois de uma correção manual, procura só nos S.R.E. daquele trecho.
// Retorna {regiao, sre, trecho, distancia (m do eixo), km} ou null.
function localizarNoSre(lat, lng, soDoTrecho) {
  const R = 6371000;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const proj = (lo, la) => [(lo - lng) * Math.PI / 180 * R * cosLat, (la - lat) * Math.PI / 180 * R];
  let melhor = null;
  for (const s of SRE_KM) {
    if (soDoTrecho && s.t !== soDoTrecho) continue;
    let ant = proj(s.p[0][0], s.p[0][1]);
    for (let i = 1; i < s.p.length; i++) {
      const atual = proj(s.p[i][0], s.p[i][1]);
      const dx = atual[0] - ant[0], dy = atual[1] - ant[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ant[0] * dx + ant[1] * dy) / len2));
      const d = Math.hypot(ant[0] + t * dx, ant[1] + t * dy);
      if (!melhor || d < melhor.distancia) {
        const metros = s.p[i - 1][2] + t * (s.p[i][2] - s.p[i - 1][2]);
        melhor = { regiao: s.r, sre: s.s, trecho: s.t, situacao: s.sit || "", ficha: s.f || "", distancia: d, km: Math.min(metros, s.c) / 1000, extensaoKm: s.c / 1000 };
      }
      ant = atual;
    }
  }
  return melhor;
}

// "km 3,42 · faixa 3–4 da ficha" — a ficha é de 1 em 1 km a partir do INÍCIO
// do S.R.E.; a última faixa vai só até o fim dele (ex.: 6–6,1).
function faixaKm(km, extensaoKm) {
  if (typeof km !== "number") return null;
  const ini = Math.min(Math.floor(km), Math.max(0, Math.ceil(extensaoKm || km + 1) - 1));
  const fim = Math.min(ini + 1, extensaoKm || ini + 1);
  return { ini, fim };
}

function textoKm(km, extensaoKm) {
  const f = faixaKm(km, extensaoKm);
  if (!f) return "";
  const n = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return "km " + km.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " · faixa " + n(f.ini) + "–" + n(f.fim) + " da ficha";
}

// Texto "S.R.E. X · km 3,42 · faixa 3–4 da ficha" de um alerta já gravado
function textoSreKmDoAlerta(a) {
  if (!a.sre) return "";
  const info = SRE_KM.find((x) => x.s === a.sre);
  const km = a.km_sre == null ? null : Number(a.km_sre);
  return "S.R.E. " + a.sre + (km == null ? "" : " · " + textoKm(km, info ? info.c / 1000 : null));
}

// Distância em metros entre dois pontos (pra achar alerta já aberto perto)
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function trechoCurto(trecho) {
  const m = (trecho || "").match(/TO-\d+/);
  return m ? m[0] : slugPath((trecho || "sem-trecho").slice(0, 20));
}

// Caminho no Storage não aceita acento nem espaço
function slugPath(texto) {
  return String(texto)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
