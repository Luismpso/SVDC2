"""
Fluxos de petróleo nos chokepoints — extração via EIA.
"""

import os
import sys
import io
import re
import pandas as pd
import requests

CSV_OVERVIEW     = 'data/processed/chokepoints.csv'
CSV_DESTINATIONS = 'data/processed/hormuz.csv'

EIA_URL = ("https://www.eia.gov/international/content/analysis/"
           "special_topics/World_Oil_Transit_Chokepoints/")

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml'
}

KNOWN_CHOKEPOINTS = {
    'Strait of Malacca', 'Strait of Hormuz', 'Suez Canal and SUMED Pipeline',
    'Bab el-Mandeb', 'Danish Straits', 'Turkish Straits (Dardanelles)',
    'Panama Canal', 'Cape of Good Hope',
}

def _fetch_eia_html() -> str:
    r = requests.get(EIA_URL, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.text

def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        new_cols = []
        for col in df.columns:
            useful = [str(c).strip() for c in col if not str(c).startswith('Unnamed')]
            new_cols.append(useful[-1] if useful else str(col[-1]).strip())
        df.columns = new_cols
    else:
        df.columns = [str(c).strip() for c in df.columns]
    return df

def _strip_footnote(name) -> str:
    s = str(name).strip()
    if s in KNOWN_CHOKEPOINTS: return s
    if len(s) > 1 and s[:-1] in KNOWN_CHOKEPOINTS: return s[:-1]
    return s

def _normalize_chokepoints(raw: pd.DataFrame) -> pd.DataFrame:
    raw = _flatten_columns(raw.copy())
    raw = raw.rename(columns={raw.columns[0]: 'chokepoint'})

    # Normalizar nomes temporais
    rename = {}
    for c in raw.columns:
        m = re.fullmatch(r'(\d[HQ])(\d{2})', str(c).strip())
        if m: rename[c] = f"{m.group(1)}20{m.group(2)}"
    raw = raw.rename(columns=rename)

    drop_rows = {'World maritime oil trade', 'World total oil supply', 'million barrels per day', 'Location'}
    df = raw[~raw['chokepoint'].astype(str).isin(drop_rows)].copy()
    df = df.dropna(subset=['chokepoint'])
    df = df[df['chokepoint'].astype(str).str.strip() != '']
    df['chokepoint'] = df['chokepoint'].map(_strip_footnote)

    # Identificar colunas temporais
    period_re = re.compile(r'^(\d{4}|\d[HQ]\d{4})$')
    period_cols = [c for c in df.columns if c != 'chokepoint' and period_re.match(str(c))]
    
    # ---------------------------------------------------------
    # NOVO: TRANSFORMAR EM SÉRIE TEMPORAL (MELT)
    # ---------------------------------------------------------
    df = df[['chokepoint'] + period_cols]
    df_long = df.melt(id_vars=['chokepoint'], value_vars=period_cols, var_name='periodo_original', value_name='value')
    df_long['value'] = pd.to_numeric(df_long['value'], errors='coerce')
    df_long = df_long.dropna(subset=['value'])

    # Converter "1H2025" em datas reais (para D3.js e Sliders temporais)
    def converter_para_data(p):
        s = str(p).strip()
        if re.fullmatch(r'\d{4}', s): return f"{s}-07-01" # Meio do ano
        m = re.fullmatch(r'([12])H(\d{4})', s)
        if m: return f"{m.group(2)}-04-01" if m.group(1) == '1' else f"{m.group(2)}-10-01"
        m = re.fullmatch(r'([1-4])Q(\d{4})', s)
        if m:
            mes = (int(m.group(1)) * 3) - 1
            return f"{m.group(2)}-{mes:02d}-15"
        return None

    df_long['date'] = df_long['periodo_original'].apply(converter_para_data)
    
    # Limpar e ordenar
    df_long = df_long[['date', 'periodo_original', 'chokepoint', 'value']]
    df_long = df_long.sort_values(['chokepoint', 'date']).reset_index(drop=True)
    
    return df_long

def _find_chokepoints_table(html: str) -> pd.DataFrame:
    tables = pd.read_html(io.StringIO(html))
    for t in tables:
        flat = _flatten_columns(t.copy())
        if flat.iloc[:, 0].astype(str).str.contains('Strait of Hormuz', regex=False).any():
            return t
    raise ValueError("Tabela de chokepoints não encontrada")

def fetch_chokepoints() -> pd.DataFrame:
    print("→ A atualizar fluxos dos chokepoints (EIA) em formato Time Series...")
    html = _fetch_eia_html()
    raw = _find_chokepoints_table(html)
    df = _normalize_chokepoints(raw)
    print(f"  ✓ Processados {len(df)} pontos de dados ao longo do tempo.")
    return df, html

def _parse_destination_aggregates(html: str) -> dict:
    text = re.sub(r'\s+', ' ', html)
    out = {}
    m = re.search(r'(\d{1,3})\s*%\s*of the crude.*went to Asian', text, re.I)
    if m: out['asia'] = float(m.group(1))
    m = re.search(r'China,\s*India,\s*Japan,?\s*and\s*South Korea.*?combined\s*(\d{1,3})\s*%', text, re.I)
    if m: out['top4'] = float(m.group(1))
    return out

def build_destinations(html: str) -> pd.DataFrame:
    print("→ A construir destinos do Ormuz...")
    base = [
        ('China', 'Ásia', 37.7, 'Maior destino'), ('Índia', 'Ásia', 14.7, 'Descontos russos'),
        ('Coreia do Sul', 'Ásia', 12.0, '68% via Ormuz'), ('Japão', 'Ásia', 10.9, '95% do Médio Oriente'),
        ('Outros Ásia', 'Ásia', 13.7, ''), ('EUA', 'Américas', 2.5, 'Mínimo de 40 anos'),
        ('Europa', 'Europa', 5.6, 'Rotas Suez/Cabo'), ('Resto', 'Resto', 2.9, '')
    ]
    df = pd.DataFrame(base, columns=['destination', 'region', 'share_percent', 'note'])
    agg = _parse_destination_aggregates(html)
    
    if 'asia' in agg and 'top4' in agg:
        asia_target, top4_target = agg['asia'], agg['top4']
        top4_mask = df['destination'].isin(['China', 'Índia', 'Coreia do Sul', 'Japão'])
        cur_top4 = df.loc[top4_mask, 'share_percent'].sum()
        df.loc[top4_mask, 'share_percent'] *= (top4_target / cur_top4)
        df.loc[df['destination'] == 'Outros Ásia', 'share_percent'] = asia_target - top4_target
        non_asia_mask = ~df['region'].eq('Ásia')
        df.loc[non_asia_mask, 'share_percent'] *= ((100 - asia_target) / df.loc[non_asia_mask, 'share_percent'].sum())
        df['share_percent'] = df['share_percent'].round(1)

    return df

def atualizar_fluxos():
    try:
        df_choke, html = fetch_chokepoints()
        os.makedirs(os.path.dirname(CSV_OVERVIEW), exist_ok=True)
        df_choke.to_csv(CSV_OVERVIEW, index=False)
        print(f"✅ {CSV_OVERVIEW} salvo com sucesso!")
    except Exception as e:
        print(f"❌ Falha nos chokepoints: {e}")
        sys.exit(1)

    try:
        df_dest = build_destinations(html)
        df_dest.to_csv(CSV_DESTINATIONS, index=False)
        print(f"✅ {CSV_DESTINATIONS} salvo com sucesso!")
    except Exception as e:
        print(f"❌ Falha nos destinos: {e}")
        sys.exit(1)

if __name__ == "__main__":
    atualizar_fluxos()