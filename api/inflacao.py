"""
Inflação Portugal — pipeline mensal a partir do Eurostat (HICP).

A fonte é a API JSON pública do Eurostat (sem chave). Puxamos as 4 classes
COICOP usadas nos small multiples:

  CP00  → Total
  CP01  → Alimentação e bebidas não alcoólicas
  NRG   → Energia (com fallback para CP045 — Eletricidade, gás)
  CP07  → Transportes

Output: data/processed/inflacao.csv
        Colunas: date (YYYY-MM-01), Total, Alimentacao, Energia, Transportes
"""

import os
import sys
import pandas as pd
import requests

CSV_PATH = 'data/processed/inflacao.csv'

COICOP_MAP = [
    ('CP00',  'Total'),
    ('CP01',  'Alimentacao'),
    ('NRG',   'Energia'),
    ('CP07',  'Transportes'),
]
COICOP_FALLBACK_ENERGIA = 'CP045'   # Gás e Eletricidade (se NRG falhar)

BASE_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'application/json',
}


def _fetch_eurostat(coicop_code: str) -> pd.DataFrame:
    """Pede uma classe COICOP ao Eurostat e devolve DF [date, value]."""
    params = {
        'format': 'JSON', 'lang': 'EN', 'geo': 'PT',
        'unit': 'RCH_A', 'coicop': coicop_code,
    }
    r = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    js = r.json()

    values = js.get('value', {})
    time_idx = (js.get('dimension', {})
                  .get('time', {})
                  .get('category', {})
                  .get('index', {}))

    if not values or not time_idx:
        raise ValueError(f"Sem dados para {coicop_code}")

    idx_to_period = {v: k for k, v in time_idx.items()}

    rows = [{'date': idx_to_period[int(i)], 'value': float(v)}
            for i, v in values.items()
            if v is not None and idx_to_period.get(int(i))]

    return (pd.DataFrame(rows)
              .sort_values('date')
              .reset_index(drop=True))


def atualizar_inflacao() -> None:
    print("→ A aceder à API oficial do Eurostat (HICP Portugal)…")
    series = {}

    for coicop, nome in COICOP_MAP:
        try:
            print(f"  · {nome:12s} ({coicop})…", end=' ', flush=True)
            df = _fetch_eurostat(coicop)
            print(f"✓ {len(df)} meses")
            series[nome] = df.set_index('date')['value']
        except Exception as e:
            if coicop == 'NRG':
                print("falhou; a tentar fallback CP045 (eletricidade/gás)…")
                try:
                    df = _fetch_eurostat(COICOP_FALLBACK_ENERGIA)
                    print(f"     ↳ fallback OK: {len(df)} meses")
                    series[nome] = df.set_index('date')['value']
                except Exception as e2:
                    print(f"     ↳ falhou também: {e2}")
            else:
                print(f"falhou: {e}")

    if not series:
        print("❌ Nenhuma série recolhida do Eurostat.")
        sys.exit(1)

    # Juntar tudo numa tabela única, indexada por mês
    df_final = pd.concat(series, axis=1).reset_index().rename(columns={'index': 'date'})
    df_final['date'] = pd.to_datetime(df_final['date'], format='%Y-%m').dt.strftime('%Y-%m-%d')
    df_final = df_final.sort_values('date').reset_index(drop=True)

    # Manter ordem de colunas previsível
    cols = ['date'] + [n for _, n in COICOP_MAP if n in df_final.columns]
    df_final = df_final[cols]

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    df_final.to_csv(CSV_PATH, index=False)

    print(f"✅ Sucesso! Histórico mensal salvo até {df_final['date'].iloc[-1][:7]} "
          f"({len(df_final)} meses) em {CSV_PATH}.")


if __name__ == "__main__":
    atualizar_inflacao()
