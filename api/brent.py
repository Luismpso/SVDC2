"""
Brent crude diario - pipeline robusto.

Estrategia: combinar duas fontes para minimizar latencia:
  1. FRED (DCOILBRENTEU)   - oficial St. Louis Fed; 1987 -> hoje
                              autoritativa, mas com 2-3 dias de lag
  2. Yahoo Finance (BZ=F)  - top-up para os ultimos dias
                              (T+1 normalmente)

Em datas em comum, FRED ganha (e mais oficial).
yfinance so e usado para datas POSTERIORES ao ultimo ponto FRED.

Salvaguardas anti-truncamento:
  - Cada fonte tenta 3x com backoff
  - Validacao: >=3000 pontos, ultima obs <=10 dias atras, sem gaps >10d
  - Backup em .bak antes de sobrescrever
  - 3 checks contra escrita destrutiva (largura, regressao temporal, perda historia)

Output: data/processed/brent.csv
        Colunas: observation_date, DCOILBRENTEU
"""

import os
import io
import sys
import time
import shutil
import pandas as pd
import requests
from datetime import datetime

CSV_PATH = 'data/processed/brent.csv'
HISTORY_START = '2000-01-01'
MIN_ROWS_OK = 3000
MAX_LAG_DIAS = 10
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; SVDC3/1.0)'}


def _retry(fn, n=3, delay=2):
    last = None
    for i in range(n):
        try:
            return fn()
        except Exception as e:
            last = e
            if i < n - 1:
                wait = delay * (2 ** i)
                print(f"     retry em {wait}s ({i+1}/{n}) - {e}")
                time.sleep(wait)
    raise last


def fetch_fred():
    """Fonte primaria - serie oficial e completa, mas com 2-3 dias de lag."""
    print("  - FRED (St. Louis Fed)...")
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU"

    def _do():
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        text = r.text
        if not text.endswith('\n'):
            raise ValueError("Resposta FRED truncada (sem newline final).")
        df = pd.read_csv(io.StringIO(text))
        if 'DATE' in df.columns:
            df = df.rename(columns={'DATE': 'observation_date'})
        df['DCOILBRENTEU'] = pd.to_numeric(df['DCOILBRENTEU'], errors='coerce')
        df = df.dropna(subset=['DCOILBRENTEU'])
        if len(df) < MIN_ROWS_OK:
            raise ValueError(f"FRED devolveu poucos pontos ({len(df)} < {MIN_ROWS_OK})")
        return df
    return _retry(_do)


def fetch_yfinance(start='2025-01-01'):
    """Top-up: yfinance tem T+1. So usado para datas mais recentes que FRED."""
    print(f"  - yfinance (BZ=F, desde {start}) para top-up...")
    import yfinance as yf

    def _do():
        ticker = yf.Ticker("BZ=F")
        df = ticker.history(start=start, auto_adjust=False)
        if df.empty:
            raise ValueError("yfinance vazio.")
        df = df.reset_index()
        df['observation_date'] = (pd.to_datetime(df['Date'])
                                    .dt.tz_localize(None)
                                    .dt.strftime('%Y-%m-%d'))
        df = df[['observation_date', 'Close']].rename(columns={'Close': 'DCOILBRENTEU'})
        return df.dropna()
    return _retry(_do, n=2)


def _validar(df):
    if df is None or df.empty:
        return False, "DataFrame vazio."
    if len(df) < MIN_ROWS_OK:
        return False, f"Apenas {len(df)} pontos (min: {MIN_ROWS_OK})."
    last = pd.to_datetime(df['observation_date']).max()
    lag = (datetime.now() - last).days
    if lag > MAX_LAG_DIAS:
        return False, f"Ultima observacao ha {lag} dias (max: {MAX_LAG_DIAS})."
    dates = pd.to_datetime(df['observation_date']).sort_values()
    max_gap = dates.diff().dt.days.max()
    if max_gap > 10:
        return False, f"Gap suspeito de {max_gap} dias."
    return True, "ok"


def _verificar_nao_destrutivo(df_novo, csv_path):
    """3 checks contra perda de historico antes de escrever."""
    if not os.path.exists(csv_path):
        return
    try:
        old = pd.read_csv(csv_path, on_bad_lines='skip')
    except Exception as e:
        print(f"  - Nao li o antigo ({e}) - a continuar sem comparar.")
        return

    old_dates = pd.to_datetime(old['observation_date'], errors='coerce').dropna()
    new_dates = pd.to_datetime(df_novo['observation_date'], errors='coerce').dropna()
    if old_dates.empty or new_dates.empty:
        return

    if len(old) > len(df_novo) * 1.05:
        print(f"ERRO: nova versao ({len(df_novo)}) >5% mais curta que antiga ({len(old)}).")
        sys.exit(1)

    regressao = (old_dates.max() - new_dates.max()).days
    if regressao > 30:
        print(f"ERRO: nova ultima obs ({new_dates.max().date()}) regrediu "
              f"{regressao} dias face a antiga ({old_dates.max().date()}).")
        sys.exit(1)

    if new_dates.min() > old_dates.min() + pd.Timedelta(days=30):
        print(f"ERRO: nova primeira obs ({new_dates.min().date()}) perde historia "
              f"face a antiga ({old_dates.min().date()}).")
        sys.exit(1)


def atualizar_brent():
    print("-> A atualizar Brent diario (FRED + yfinance top-up)...")

    # 1) FRED - base historica autoritativa
    df_fred = None
    try:
        df_fred = fetch_fred()
        ok, msg = _validar(df_fred)
        if not ok:
            print(f"  X  FRED validacao: {msg}")
            df_fred = None
        else:
            print(f"  OK FRED: {len(df_fred)} pontos.")
    except Exception as e:
        print(f"  X  FRED falhou: {e}")

    # 2) yfinance - top-up dos ultimos dias
    df_yf = None
    try:
        df_yf = fetch_yfinance()
        print(f"  OK yfinance: {len(df_yf)} pontos.")
    except Exception as e:
        print(f"  - yfinance indisponivel ({e}) - so FRED.")

    # 3) Combinar: FRED como base; yfinance so para datas POSTERIORES ao ultimo FRED
    if df_fred is None and df_yf is None:
        print("ERRO: ambas as fontes falharam. CSV antigo preservado.")
        sys.exit(1)

    if df_fred is None:
        df = df_yf
        print("  ! Sem FRED - so com yfinance (historia limitada).")
    elif df_yf is None:
        df = df_fred
    else:
        last_fred = pd.to_datetime(df_fred['observation_date']).max()
        df_yf_recent = df_yf[pd.to_datetime(df_yf['observation_date']) > last_fred]
        if df_yf_recent.empty:
            df = df_fred
            print(f"  · yfinance nao tinha dados mais recentes que FRED ({last_fred.date()}).")
        else:
            df = pd.concat([df_fred, df_yf_recent], ignore_index=True)
            print(f"  + yfinance acrescentou {len(df_yf_recent)} dias apos {last_fred.date()}.")

    # Normalizar
    df['observation_date'] = pd.to_datetime(df['observation_date']).dt.strftime('%Y-%m-%d')
    df = df[df['observation_date'] >= HISTORY_START]
    df = df.sort_values('observation_date').drop_duplicates('observation_date', keep='first')
    df['DCOILBRENTEU'] = df['DCOILBRENTEU'].round(2)
    df = df.reset_index(drop=True)

    # Validar resultado final
    ok, msg = _validar(df)
    if not ok:
        print(f"ERRO: resultado final invalido ({msg}). CSV antigo preservado.")
        sys.exit(1)

    # Anti-destrutivo
    _verificar_nao_destrutivo(df, CSV_PATH)

    # Backup + escrita
    if os.path.exists(CSV_PATH):
        try:
            shutil.copy2(CSV_PATH, CSV_PATH + '.bak')
            print(f"  -> backup em {CSV_PATH}.bak")
        except Exception as e:
            print(f"  - Sem backup ({e}) - a continuar.")

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    df.to_csv(CSV_PATH, index=False, lineterminator='\n')
    print(f"OK! {len(df)} dias ({df['observation_date'].iloc[0]} -> {df['observation_date'].iloc[-1]})")


if __name__ == "__main__":
    atualizar_brent()
