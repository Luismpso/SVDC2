"""
Fluxos de petróleo nos chokepoints — EIA (atual) + Wayback Machine (histórico).

Estratégia em duas fases:
  1. **Live EIA**: faz scrape da página atual do EIA. Cobre 2020–presente.
  2. **Wayback Machine**: pede ao archive.org snapshots antigos da mesma
     página (1 por ano desde 2017). Extrai as tabelas dessas versões
     para estender o histórico até ~2017.

Outputs:
  - data/processed/chokepoints.csv  → série temporal (todos os anos).
  - data/processed/hormuz.csv       → snapshot ATUAL dos destinos.

Anti-falhas:
  - Wayback é melhor-esforço: se falhar parcialmente, usa o que conseguir.
  - Se Wayback falhar inteiramente, o live scrape ainda produz saída.
  - Cada snapshot é tentado isoladamente — uma falha não rebenta as outras.
"""

import os
import sys
import io
import re
import time
from datetime import datetime

import pandas as pd
import requests

CSV_OVERVIEW     = 'data/processed/chokepoints.csv'
CSV_DESTINATIONS = 'data/processed/hormuz.csv'

EIA_URL = ("https://www.eia.gov/international/content/analysis/"
           "special_topics/World_Oil_Transit_Chokepoints/")

WAYBACK_CDX    = "https://web.archive.org/cdx/search/cdx"
WAYBACK_PREFIX = "https://web.archive.org/web/"

# Vai buscar snapshots desde este ano (EIA começou a publicar tabela
# consistente por volta de 2017).
WAYBACK_FROM_YEAR = 2017

# Pausa entre fetches da Wayback para sermos educados com o servidor.
WAYBACK_DELAY_S = 1.5

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml'
}

KNOWN_CHOKEPOINTS = {
    'Strait of Malacca', 'Strait of Hormuz', 'Suez Canal and SUMED Pipeline',
    'Bab el-Mandeb', 'Danish Straits', 'Turkish Straits (Dardanelles)',
    'Panama Canal', 'Cape of Good Hope',
}


# ---------------------------------------------------------------------------
# Helpers de tabela (partilhados entre live e Wayback)
# ---------------------------------------------------------------------------

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
    if s in KNOWN_CHOKEPOINTS:
        return s
    # Remove até 2 caracteres finais (footnotes tipo "Bab el-Mandeb a" ou similar)
    for trim in (1, 2):
        if len(s) > trim and s[:-trim].strip() in KNOWN_CHOKEPOINTS:
            return s[:-trim].strip()
    return s


def _normalize_chokepoints(raw: pd.DataFrame) -> pd.DataFrame:
    raw = _flatten_columns(raw.copy())
    raw = raw.rename(columns={raw.columns[0]: 'chokepoint'})

    # Normalizar nomes temporais "1H25" → "1H2025"
    rename = {}
    for c in raw.columns:
        m = re.fullmatch(r'(\d[HQ])(\d{2})', str(c).strip())
        if m:
            rename[c] = f"{m.group(1)}20{m.group(2)}"
    raw = raw.rename(columns=rename)

    drop_rows = {'World maritime oil trade', 'World total oil supply',
                 'million barrels per day', 'Location'}
    df = raw[~raw['chokepoint'].astype(str).isin(drop_rows)].copy()
    df = df.dropna(subset=['chokepoint'])
    df = df[df['chokepoint'].astype(str).str.strip() != '']
    df['chokepoint'] = df['chokepoint'].map(_strip_footnote)
    # Só mantém chokepoints conhecidos (filtra ruído tipo cabeçalhos errados)
    df = df[df['chokepoint'].isin(KNOWN_CHOKEPOINTS)]

    period_re = re.compile(r'^(\d{4}|\d[HQ]\d{4})$')
    period_cols = [c for c in df.columns if c != 'chokepoint' and period_re.match(str(c))]

    df = df[['chokepoint'] + period_cols]
    df_long = df.melt(id_vars=['chokepoint'], value_vars=period_cols,
                      var_name='periodo_original', value_name='value')
    df_long['value'] = pd.to_numeric(df_long['value'], errors='coerce')
    df_long = df_long.dropna(subset=['value'])

    def converter_para_data(p):
        s = str(p).strip()
        if re.fullmatch(r'\d{4}', s):
            return f"{s}-07-01"
        m = re.fullmatch(r'([12])H(\d{4})', s)
        if m:
            return f"{m.group(2)}-04-01" if m.group(1) == '1' else f"{m.group(2)}-10-01"
        m = re.fullmatch(r'([1-4])Q(\d{4})', s)
        if m:
            mes = (int(m.group(1)) * 3) - 1
            return f"{m.group(2)}-{mes:02d}-15"
        return None

    df_long['date'] = df_long['periodo_original'].apply(converter_para_data)
    df_long = df_long.dropna(subset=['date'])
    df_long = df_long[['date', 'periodo_original', 'chokepoint', 'value']]
    return df_long.sort_values(['chokepoint', 'date']).reset_index(drop=True)


def _find_chokepoints_table(html: str) -> pd.DataFrame:
    tables = pd.read_html(io.StringIO(html))
    for t in tables:
        flat = _flatten_columns(t.copy())
        if flat.iloc[:, 0].astype(str).str.contains('Strait of Hormuz', regex=False).any():
            return t
    raise ValueError("Tabela de chokepoints não encontrada")


# ---------------------------------------------------------------------------
# Live EIA (página atual)
# ---------------------------------------------------------------------------

def _fetch_eia_html() -> str:
    r = requests.get(EIA_URL, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.text


def fetch_chokepoints_live() -> tuple[pd.DataFrame, str]:
    print("→ EIA live (página atual)...")
    html = _fetch_eia_html()
    raw = _find_chokepoints_table(html)
    df = _normalize_chokepoints(raw)
    print(f"  ✓ {len(df)} pontos de dados ({df['chokepoint'].nunique()} chokepoints, "
          f"{df['periodo_original'].nunique()} períodos)")
    return df, html


# ---------------------------------------------------------------------------
# Wayback Machine (snapshots históricos)
# ---------------------------------------------------------------------------

def _list_wayback_snapshots(target_url: str, from_year: int) -> list[tuple[int, str]]:
    """Devolve [(ano, timestamp)] — um snapshot por ano, escolhido como o
    primeiro disponível em cada ano civil."""
    params = {
        'url': target_url,
        'output': 'json',
        'from': f'{from_year}0101',
        'to': f'{datetime.now().year}1231',
        'filter': 'statuscode:200',
        'filter': 'mimetype:text/html',
        'collapse': 'timestamp:4',  # 1 por ano (4 dígitos = YYYY)
    }
    r = requests.get(WAYBACK_CDX, params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    rows = r.json()
    if len(rows) < 2:
        return []

    # rows[0] é o cabeçalho. Campos: urlkey, timestamp, original, mimetype, statuscode, digest, length
    snapshots = []
    seen_years = set()
    for row in rows[1:]:
        timestamp = row[1]
        try:
            year = int(timestamp[:4])
        except ValueError:
            continue
        if year < from_year or year in seen_years:
            continue
        seen_years.add(year)
        snapshots.append((year, timestamp))
    return sorted(snapshots)


def _fetch_wayback_html(timestamp: str, url: str) -> str:
    """Vai buscar o HTML cru de um snapshot (sufixo 'id_' evita a injeção
    do banner da Wayback)."""
    full_url = f"{WAYBACK_PREFIX}{timestamp}id_/{url}"
    r = requests.get(full_url, headers=HEADERS, timeout=45)
    r.raise_for_status()
    return r.text


def fetch_chokepoints_historico() -> pd.DataFrame:
    """Snapshots da Wayback ano a ano."""
    print(f"→ Wayback Machine (desde {WAYBACK_FROM_YEAR})...")
    try:
        snapshots = _list_wayback_snapshots(EIA_URL, WAYBACK_FROM_YEAR)
    except Exception as e:
        print(f"  ⚠ CDX falhou ({e}). A continuar só com live EIA.")
        return pd.DataFrame()

    if not snapshots:
        print("  · Nenhum snapshot histórico encontrado.")
        return pd.DataFrame()

    print(f"  · {len(snapshots)} snapshots encontrados.")
    partes = []
    for year, ts in snapshots:
        try:
            html = _fetch_wayback_html(ts, EIA_URL)
            raw = _find_chokepoints_table(html)
            df = _normalize_chokepoints(raw)
            if not df.empty:
                partes.append(df)
                print(f"  · {year} ({ts[:8]}): {len(df)} pontos.")
            else:
                print(f"  · {year} ({ts[:8]}): tabela vazia após normalização.")
        except Exception as e:
            print(f"  · {year} ({ts[:8]}): {type(e).__name__} — {e}")
        time.sleep(WAYBACK_DELAY_S)  # ser educado com o archive

    if partes:
        return pd.concat(partes, ignore_index=True)
    return pd.DataFrame()


# ---------------------------------------------------------------------------
# Hormuz destinations
# ---------------------------------------------------------------------------

# Base atual (último relatório EIA) — usada como snapshot em hormuz.csv.
# Os valores são ajustados via regex se as percentagens "Asia" e "Top4"
# forem encontradas no HTML mais recente.
DEST_BASE = [
    ('China',         'Ásia',     37.7, 'Maior destino'),
    ('Índia',         'Ásia',     14.7, 'Descontos russos'),
    ('Coreia do Sul', 'Ásia',     12.0, '68% via Ormuz'),
    ('Japão',         'Ásia',     10.9, '95% do Médio Oriente'),
    ('Outros Ásia',   'Ásia',     13.7, ''),
    ('EUA',           'Américas',  2.5, 'Mínimo de 40 anos'),
    ('Europa',        'Europa',    5.6, 'Rotas Suez/Cabo'),
    ('Resto',         'Resto',     2.9, ''),
]


def _parse_destination_aggregates(html: str) -> dict:
    """Extrai % Ásia e % Top4 (China+India+Japão+Coreia) do texto do EIA."""
    text = re.sub(r'\s+', ' ', html)
    out = {}
    # "X% of the crude ... went to Asian markets" (forma comum)
    for pat in [
        r'(\d{1,3}(?:\.\d)?)\s*%\s*of the crude.*?(?:went|moved).*?Asian',
        r'Asian (?:markets|destinations|countries)[^%]*?(\d{1,3}(?:\.\d)?)\s*%',
    ]:
        m = re.search(pat, text, re.I)
        if m:
            try:
                out['asia'] = float(m.group(1))
                break
            except ValueError:
                pass
    # "China, India, Japan, and South Korea combined X%"
    for pat in [
        r'China,?\s*India,?\s*Japan,?\s*and\s*South\s*Korea.*?(\d{1,3}(?:\.\d)?)\s*%',
        r'(\d{1,3}(?:\.\d)?)\s*%.*?China,?\s*India,?\s*Japan,?\s*and\s*South\s*Korea',
    ]:
        m = re.search(pat, text, re.I)
        if m:
            try:
                out['top4'] = float(m.group(1))
                break
            except ValueError:
                pass
    return out


def build_destinations(html: str) -> pd.DataFrame:
    """Snapshot atual dos destinos (mantém formato do hormuz.csv original)."""
    df = pd.DataFrame(DEST_BASE,
                      columns=['destination', 'region', 'share_percent', 'note'])
    agg = _parse_destination_aggregates(html)
    if 'asia' in agg and 'top4' in agg:
        asia_target, top4_target = agg['asia'], agg['top4']
        top4_mask = df['destination'].isin(['China', 'Índia', 'Coreia do Sul', 'Japão'])
        cur_top4 = df.loc[top4_mask, 'share_percent'].sum()
        df.loc[top4_mask, 'share_percent'] *= (top4_target / cur_top4)
        df.loc[df['destination'] == 'Outros Ásia', 'share_percent'] = asia_target - top4_target
        non_asia_mask = ~df['region'].eq('Ásia')
        df.loc[non_asia_mask, 'share_percent'] *= (
            (100 - asia_target) / df.loc[non_asia_mask, 'share_percent'].sum()
        )
        df['share_percent'] = df['share_percent'].round(1)
    return df


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def atualizar_fluxos():
    # 1. Live EIA
    try:
        df_live, html_live = fetch_chokepoints_live()
    except Exception as e:
        print(f"❌ Live EIA falhou completamente: {e}")
        sys.exit(1)

    # 2. Wayback histórico (best-effort)
    df_hist = fetch_chokepoints_historico()

    # 3. Combinar chokepoints (histórico primeiro, live por cima)
    df_choke = pd.concat([df_hist, df_live], ignore_index=True)
    df_choke = (df_choke.drop_duplicates(
                    subset=['chokepoint', 'periodo_original'], keep='last')
                .sort_values(['chokepoint', 'date'])
                .reset_index(drop=True))

    os.makedirs(os.path.dirname(CSV_OVERVIEW), exist_ok=True)
    df_choke.to_csv(CSV_OVERVIEW, index=False)
    print(f"✅ {CSV_OVERVIEW}: {len(df_choke)} pontos "
          f"({df_choke['chokepoint'].nunique()} chokepoints, "
          f"{df_choke['periodo_original'].nunique()} períodos).")

    # 4. Destinos do Ormuz — snapshot atual
    try:
        df_dest = build_destinations(html_live)
        df_dest.to_csv(CSV_DESTINATIONS, index=False)
        print(f"✅ {CSV_DESTINATIONS}: {len(df_dest)} destinos (snapshot atual).")
    except Exception as e:
        print(f"⚠ Falha em hormuz.csv ({e}); a continuar.")


if __name__ == "__main__":
    atualizar_fluxos()