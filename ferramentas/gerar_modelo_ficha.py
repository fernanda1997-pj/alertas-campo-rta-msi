"""Gera js/modelo-ficha.js: as linhas de cada Ficha de Inspeção (trecho → S.R.E.
→ km início/fim), na ordem da própria ficha, pra o CSV "Linhas da ficha" do
Painel sair exatamente com as linhas da planilha — dá pra copiar a coluna inteira.

Por que não usar o cadastro (CADASTRO_SRE_TRECHOS_GEORREF_REV01.xlsx) nem o
shapefile: em 2026-10-29 os três não batiam entre si (ex.: 201ETO0250 é do
trecho 19 no cadastro e do trecho 20 na ficha; 201ETO0270 tem 12,468 km no
cadastro/shape e 12,570 na ficha). Como o CSV é pra colar NA FICHA, quem manda
é a ficha.

Lê as fichas com o próprio converter (web - fichas/ficha-inspecao/converter_fichas.py,
parse_ficha) e fica com a competência mais recente de cada região + tipo.
Rodar de novo quando chegar ficha de um mês novo (ou o modelo mudar):

    python ferramentas/gerar_modelo_ficha.py
"""
import contextlib
import glob
import io
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
FICHAS = os.path.join(RAIZ, '..', 'web - fichas', 'ficha-inspecao')
sys.path.insert(0, FICHAS)

with contextlib.redirect_stdout(io.StringIO()):
    import converter_fichas as cf  # noqa: E402


def tipo_do_arquivo(nome):
    n = cf._norm(os.path.basename(nome))
    return 'np' if 'NAO_PAVIMENTADA' in n.replace(' ', '_') or 'NAO PAVIMENTADA' in n else 'pav'


def main():
    arquivos = sorted(glob.glob(os.path.join(FICHAS, 'fichas', 'LOTE*', '**', '*.xlsx'), recursive=True))
    melhor = {}  # (regiao, tipo) -> (competencia, segmentos, arquivo)
    for arq in arquivos:
        if os.path.basename(arq).startswith('~$'):
            continue
        tipo = tipo_do_arquivo(arq)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                resultado = cf.parse_ficha(arq)
        except Exception as erro:  # ficha com formato estranho não derruba as outras
            print('pulando', os.path.basename(arq), '-', erro)
            continue
        for bloco in resultado:
            reg = 'R' + str(int(re.sub(r'\D', '', str(bloco['regiao'])) or 0))
            chave = (reg, tipo)
            comp = str(bloco['competencia'])
            if chave not in melhor or comp > melhor[chave][0]:
                melhor[chave] = (comp, bloco['segmentos'], arq)

    saida = []
    for (reg, tipo), (comp, segs, arq) in sorted(melhor.items(), key=lambda k: (int(k[0][0][1:]), k[0][1])):
        print(f'{reg} {tipo:3s} {comp[:7]}  {len(segs):4d} linhas  ({os.path.basename(arq)})')
        trechos = []
        por_trecho = {}
        for s in segs:  # mantém a ordem da ficha
            tr = str(s['trecho_num'])
            if tr not in por_trecho:
                por_trecho[tr] = {'tr': tr, 'tn': s.get('trecho_nome') or s.get('rodovia') or '', 'sres': []}
                trechos.append(por_trecho[tr])
            t = por_trecho[tr]
            sre = re.sub(r'\s', '', str(s['sre']).upper())
            if not t['sres'] or t['sres'][-1][0] != sre:
                t['sres'].append([sre, [s['km_ini']]])
            marcos = t['sres'][-1][1]
            if abs(marcos[-1] - s['km_ini']) > 1e-6:  # buraco na sequência: começa outro bloco do mesmo S.R.E.
                t['sres'].append([sre, [s['km_ini']]])
                marcos = t['sres'][-1][1]
            marcos.append(s['km_fim'])
        saida.append({'r': reg, 'f': tipo, 'comp': comp[:7], 'trechos': trechos})

    destino = os.path.join(RAIZ, 'js', 'modelo-ficha.js')
    with open(destino, 'w', encoding='utf-8') as f:
        f.write('// GERADO por ferramentas/gerar_modelo_ficha.py — não editar à mão.\n')
        f.write('// Linhas da Ficha de Inspeção: r=região, f=pav|np, comp=competência lida,\n')
        f.write('// trechos=[{tr=nº, tn=nome, sres=[[S.R.E., [km de cada divisa de linha: 0,1,2,…,fim]]]}]\n')
        f.write('const MODELO_FICHA = ' + json.dumps(saida, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'gravado {destino} ({os.path.getsize(destino) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
