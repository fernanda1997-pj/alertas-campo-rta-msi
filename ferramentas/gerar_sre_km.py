"""Gera js/sre-km.js: a geometria de cada S.R.E. com a distância acumulada
(em metros) em cada vértice, pra o app achar em qual km do S.R.E. a foto foi
tirada — o mesmo km que a Ficha de Inspeção usa (km 0 = INÍCIO do S.R.E.).

Lê os shapefiles PELO PRÓPRIO converter das fichas (web - fichas/ficha-inspecao/
converter_fichas.py → carregar_linhas_regiao), pra o sentido da linha, o
encadeamento das partes e o comprimento serem exatamente os mesmos da ficha.
Rodar de novo sempre que os R*_TRECHOS.shp de web - fichas/camadas mudarem:

    python ferramentas/gerar_sre_km.py
"""
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
FICHAS = os.path.join(RAIZ, '..', 'web - fichas', 'ficha-inspecao')
sys.path.insert(0, FICHAS)

import converter_fichas as cf  # noqa: E402
import geopandas as gpd  # noqa: E402
from shapely.geometry import LineString  # noqa: E402

REGIOES = ['R1', 'R2', 'R3', 'R11', 'R12', 'R13']
TOLERANCIA_M = 3  # simplificação: erro de no máx. ~3 m no traçado, arquivo bem menor


def nomes_de_trecho():
    """SRE -> nome do trecho, tirado do js/trechos-geo.js (mesmos nomes do app)."""
    texto = open(os.path.join(RAIZ, 'js', 'trechos-geo.js'), encoding='utf-8').read()
    dados = json.loads(texto[texto.index('['):texto.rindex(']') + 1])
    return {re.sub(r'\s', '', (d.get('sre') or '').upper()): d['trecho'] for d in dados if d.get('sre')}


# Situação do S.R.E. -> qual ficha usar (legenda da própria ficha):
# PPS/PSU/PDU/DUP = pavimentada; LEN (leito natural) / EOP (em obras) = não pavimentada
SITUACAO_NAO_PAVIMENTADA = {'LEN', 'EOP'}


def situacoes_do_sre():
    """SRE -> SITUACAO, do shapefile consolidado do geoportal principal (web/dados)."""
    import io
    import zipfile
    import shapefile
    z = zipfile.ZipFile(os.path.join(RAIZ, '..', 'web', 'dados', 'trechos_shp.zip'))
    r = shapefile.Reader(shp=io.BytesIO(z.read('trechos.shp')), dbf=io.BytesIO(z.read('trechos.dbf')),
                         shx=io.BytesIO(z.read('trechos.shx')), encoding='utf-8', encodingErrors='replace')
    return {re.sub(r'\s', '', str(x['SRE']).upper()): str(x['SITUACAO'] or '').strip().upper() for x in r.records()}


def main():
    nomes = nomes_de_trecho()
    situacoes = situacoes_do_sre()
    saida = []
    sem_nome = []
    sem_situacao = []
    for reg in REGIOES:
        linhas = cf.carregar_linhas_regiao(reg)
        for sre, info in linhas.items():
            geom_m = info['geom_m'].simplify(TOLERANCIA_M, preserve_topology=False)
            coords_m = list(geom_m.coords)
            # distância acumulada no MESMO sistema métrico da ficha (EPSG do converter)
            acum = [0.0]
            for a, b in zip(coords_m, coords_m[1:]):
                acum.append(acum[-1] + ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5)
            # o comprimento da linha simplificada é um tiquinho menor — reescala pra
            # bater com o comprimento original (é ele que a ficha usa pra cortar os km)
            fator = info['comprimento_m'] / acum[-1] if acum[-1] else 1.0
            geom_deg = gpd.GeoSeries([LineString(coords_m)], crs=cf.EPSG_METRICO).to_crs(4326).iloc[0]
            pontos = [[round(x, 6), round(y, 6), round(d * fator, 1)] for (x, y), d in zip(geom_deg.coords, acum)]
            trecho = nomes.get(sre, '')
            if not trecho:
                sem_nome.append(reg + '/' + sre)
            sit = situacoes.get(sre, '')
            if not sit:
                sem_situacao.append(reg + '/' + sre)
            tipo = 'np' if sit in SITUACAO_NAO_PAVIMENTADA else ('pav' if sit else '')
            saida.append({'r': reg, 's': sre, 't': trecho, 'sit': sit, 'f': tipo, 'c': round(info['comprimento_m'], 1), 'p': pontos})
    destino = os.path.join(RAIZ, 'js', 'sre-km.js')
    with open(destino, 'w', encoding='utf-8') as f:
        f.write('// GERADO por ferramentas/gerar_sre_km.py — não editar à mão.\n')
        f.write('// r=região, s=S.R.E., t=trecho, sit=situação, f=ficha (pav|np|""), c=comprimento (m), p=[lng, lat, metros desde o INÍCIO]\n')
        f.write('const SRE_KM = ' + json.dumps(saida, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'{len(saida)} S.R.E. gravados em {destino} ({os.path.getsize(destino) / 1024:.0f} KB)')
    if sem_situacao:
        print(f'{len(sem_situacao)} S.R.E. sem situação (o campo escolhe o tipo de ficha à mão): {", ".join(sem_situacao[:15])}{" ..." if len(sem_situacao) > 15 else ""}')
    if sem_nome:
        print(f'{len(sem_nome)} S.R.E. sem nome de trecho no trechos-geo.js: {", ".join(sem_nome[:15])}{" ..." if len(sem_nome) > 15 else ""}')


if __name__ == '__main__':
    main()
