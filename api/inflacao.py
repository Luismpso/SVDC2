"""
Atualizacao do CSV de inflacao mensal por classe COICOP (PT).

Estrategia (segue o mesmo padrao de api/brent.py - multi-fonte que se completa):
  1. Eurostat HICP (prc_hicp_manr)  - canonico, todas as 4 colunas
                                       (Total, Alimentacao, Energia, Transportes).
                                       Cobre 1996-presente, ~6 semanas de lag.
  2. BPstat (Banco de Portugal)     - series por classe COICOP:
                                        5721524 -> Total
                                        5721525 -> Alimentacao
                                        5721531 -> Transportes
                                       Publicado ~12 dias apos o mes - apanha
                                       a janela cega de 1-2 meses.
  3. CSV existente em data/processed/ - base se as 2 acima falharem.

Merge: ordem antigo -> BPstat -> Eurostat, celula a celula via combine_first.
       Para cada (mes, classe), Eurostat vence quando publicado; BPstat tapa
       os meses recentes que o Eurostat ainda nao tem.

Nota sobre Energia:
  O BPstat nao tem o agregado especial NRG do Eurostat (combustiveis para casa
  + combustiveis para veiculos). Por isso "Energia" nos meses mais recentes
  pode ficar em branco ate o Eurostat publicar. As outras 3 ficam preenchidas
  quase em tempo real.

Anti-falhas (igual ao Brent):
  - 3 retries com backoff em cada fonte.
  - _clean() rigoroso por linha.
  - Se TUDO falhar, o CSV existente fica intacto.
  - asserts antes de gravar.
"""

import io
import os
import time

import pandas as pd
import requests


CSV_PATH = 'data/processed/inflacao.csv'

# O Eurostat HICP comeca em 1996; o BPstat traz desde 1949 mas isso polui
# o grafico do site (que mostra 2000-2025). Limitar ao periodo do projeto.
START_DATE = '1996-01-01'

MAX_RETRIES = 3
TIMEOUT_S = 30

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/csv, */*',
}

COLS = ['date', 'Total', 'Alimentacao', 'Energia', 'Transportes']
NUM_COLS = ['Total', 'Alimentacao', 'Energia', 'Transportes']


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean(df):
    """Filtra e normaliza um DataFrame wide (date + classes)."""
    if df is None or df.empty:
        return df

    df = df.copy()

    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date'])
    df['date'] = df['date'].dt.to_period('M').dt.to_timestamp().dt.strftime('%Y-%m-%d')

    for col in NUM_COLS:
        if col not in df.columns:
            df[col] = pd.NA

    for col in NUM_COLS:
        df[col] = pd.to_numeric(df[col], errors='coerce')
        df[col] = df[col].round(1)

    df = df.dropna(subset=NUM_COLS, how='all')

    # Limitar ao periodo do projeto
    df = df[df['date'] >= START_DATE]

    return df[COLS]


def _retry(fn, label):
    """Corre fn() com retries+backoff. Devolve DF limpo ou None."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            result = fn()
            cleaned = _clean(result)
            if cleaned is not None and not cleaned.empty:
                ultima = cleaned['date'].iloc[-1][:7]
                print(f"  ok {label}: {len(cleaned)} meses (ate {ultima}).")
                return cleaned
            print(f"  - {label}, tentativa {attempt}: devolveu vazio.")
        except Exception as e:
            print(f"  - {label}, tentativa {attempt} falhou: {e}")

        if attempt < MAX_RETRIES:
            time.sleep(2 ** attempt)

    return None


# ---------------------------------------------------------------------------
# 1. Eurostat
# ---------------------------------------------------------------------------

EUROSTAT_URL = (
    "https://ec.europa.eu/eurostat/api/dissemination/"
    "statistics/1.0/data/prc_hicp_manr"
)

EUROSTAT_COICOP_MAP = [
    ('CP00', 'Total'),
    ('CP01', 'Alimentacao'),
    ('NRG',  'Energia'),
    ('CP07', 'Transportes'),
]

EUROSTAT_NRG_FALLBACK = 'CP045'


def _fetch_eurostat_one(coicop):
    params = {
        'format': 'JSON', 'lang': 'EN', 'geo': 'PT',
        'unit': 'RCH_A', 'coicop': coicop,
    }
    r = requests.get(EUROSTAT_URL, params=params, headers=HEADERS,
                     timeout=TIMEOUT_S)
    r.raise_for_status()
    js = r.json()

    values = js.get('value', {}) or {}
    time_dim = (js.get('dimension', {}).get('time', {})
                  .get('category', {}).get('index', {}) or {})
    if not values or not time_dim:
        raise ValueError(f"Eurostat: resposta vazia para {coicop}")

    idx_to_period = {v: k for k, v in time_dim.items()}
    rows = []
    for idx_str, val in values.items():
        period = idx_to_period.get(int(idx_str))
        if period is not None and val is not None:
            rows.append({'date': period, 'value': float(val)})

    if not rows:
        raise ValueError(f"Eurostat: sem linhas validas para {coicop}")

    return pd.DataFrame(rows)


def fetch_eurostat():
    """Devolve DF wide com as 4 classes."""
    print("-> Eurostat HICP (PT)...")
    series = {}

    for coicop, coluna in EUROSTAT_COICOP_MAP:
        try:
            df = _fetch_eurostat_one(coicop)
            series[coluna] = df.set_index('date')['value']
            print(f"  - {coluna:12s} ({coicop}): {len(df)} meses.")
        except Exception as e:
            print(f"  - {coluna:12s} ({coicop}): falhou - {e}")
            if coicop == 'NRG':
                try:
                    df = _fetch_eurostat_one(EUROSTAT_NRG_FALLBACK)
                    series[coluna] = df.set_index('date')['value']
                    print(f"      fallback {EUROSTAT_NRG_FALLBACK}: {len(df)} meses.")
                except Exception as e2:
                    print(f"      fallback {EUROSTAT_NRG_FALLBACK} falhou: {e2}")

    if not series:
        raise RuntimeError("Eurostat: nenhuma classe recolhida.")

    wide = pd.concat(series, axis=1).reset_index()
    wide = wide.rename(columns={'index': 'date'})
    return wide


# ---------------------------------------------------------------------------
# 2. BPstat
# ---------------------------------------------------------------------------
#
# IDs descobertos por sondagem da API (Maio 2026):
#   5721524 - CPI (inflation rate)            -> Total
#   5721525 - CPI food and non-alc beverages  -> Alimentacao
#   5721531 - CPI transport                   -> Transportes

BPSTAT_CSV_URL = "https://bpstat.bportugal.pt/api/observations/csv/"

BPSTAT_SERIES = {
    '5721524': 'Total',
    '5721525': 'Alimentacao',
    '5721531': 'Transportes',
}


def _parse_bpstat_csv(text):
    df = pd.read_csv(
        io.StringIO(text), sep=';', comment='#', header=None,
        names=['series', 'desc', 'metric', 'unit', 'date', 'value', 'state'],
        engine='python',
    )
    df = df[['series', 'date', 'value']].dropna(subset=['date'])
    df['series'] = df['series'].astype(str).str.strip()
    return df


def fetch_bpstat():
    print("-> BPstat (Banco de Portugal)...")
    series_ids = ','.join(BPSTAT_SERIES.keys())

    r = requests.get(
        BPSTAT_CSV_URL,
        params={'series_ids': series_ids, 'language': 'EN'},
        headers=HEADERS, timeout=TIMEOUT_S,
    )
    r.raise_for_status()
    text = r.content.decode('latin-1', errors='replace')

    raw = _parse_bpstat_csv(text)
    if raw.empty:
        raise ValueError("BPstat: resposta sem linhas.")

    raw['coluna'] = raw['series'].map(BPSTAT_SERIES)
    raw = raw.dropna(subset=['coluna'])
    raw['value'] = pd.to_numeric(raw['value'], errors='coerce')

    wide = (
        raw.pivot_table(index='date', columns='coluna',
                        values='value', aggfunc='last')
           .reset_index()
    )
    wide.columns.name = None

    encontradas = [c for c in BPSTAT_SERIES.values() if c in wide.columns]
    print(f"  - classes obtidas: {', '.join(encontradas) or '(nenhuma)'}")

    return wide


# ---------------------------------------------------------------------------
# 3. Pipeline
# ---------------------------------------------------------------------------

def _ler_existente():
    if not os.path.exists(CSV_PATH):
        return None
    try:
        df = pd.read_csv(CSV_PATH)
        df = _clean(df)
        if df is None or df.empty:
            return None
        print(f"  - CSV existente: {len(df)} meses (ate {df['date'].iloc[-1][:7]}).")
        return df
    except Exception as e:
        print(f"  ! Nao consegui ler CSV existente: {e}")
        return None


def _merge_por_classe(antigo, bpstat, eurostat):
    fontes = []
    if antigo   is not None and not antigo.empty:   fontes.append(antigo)
    if bpstat   is not None and not bpstat.empty:   fontes.append(bpstat)
    if eurostat is not None and not eurostat.empty: fontes.append(eurostat)

    if not fontes:
        return None

    todas_datas = sorted(set().union(*(set(f['date']) for f in fontes)))
    final = pd.DataFrame({'date': todas_datas})

    for col in NUM_COLS:
        s = pd.Series(index=todas_datas, dtype='float64')
        for f in fontes:
            if col not in f.columns:
                continue
            f_ind = f.set_index('date')[col]
            s = f_ind.combine_first(s)
        final[col] = final['date'].map(s)

    final = final.sort_values('date').reset_index(drop=True)
    return final


def atualizar():
    print("-> A atualizar inflacao (Eurostat + BPstat)...")

    antigo = _ler_existente()

    df_euro = _retry(fetch_eurostat, "Eurostat")
    df_bp   = _retry(fetch_bpstat,   "BPstat")

    if df_euro is None and df_bp is None:
        if antigo is None:
            print("X Tudo falhou e nao ha CSV existente. Nada a fazer.")
            return
        print("! Ambas as fontes falharam. CSV existente fica intacto.")
        return

    df_final = _merge_por_classe(antigo, df_bp, df_euro)
    if df_final is None or df_final.empty:
        print("! Merge produziu resultado vazio. CSV existente fica intacto.")
        return

    df_final = _clean(df_final)

    # Sanity checks antes de gravar
    assert df_final['date'].notna().all(), "Datas em falta no resultado"
    assert df_final['date'].is_monotonic_increasing, "Datas nao ordenadas"
    cobertura_total = df_final['Total'].notna().mean()
    assert cobertura_total > 0.9, (
        f"Cobertura suspeita: so {cobertura_total:.1%} dos meses tem Total."
    )

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    df_final.to_csv(CSV_PATH, index=False)

    ultima = df_final['date'].iloc[-1][:7]
    preenchidas = {c: int(df_final[c].notna().sum()) for c in NUM_COLS}
    print(f"OK {CSV_PATH} atualizado: {len(df_final)} meses. Ultima: {ultima}")
    print(f"   Preenchimento por classe: {preenchidas}")


if __name__ == "__main__":
    atualizar()
