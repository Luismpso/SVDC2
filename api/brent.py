"""
Brent crude diario - pipeline robusto.

Fontes (com retries):
  1. FRED (DCOILBRENTEU)   - oficial St. Louis Fed; 1987 -> hoje
  2. Yahoo Finance (BZ=F)  - fallback

Salvaguardas:
  - Cada fonte tenta 3x com backoff
  - Validacao: >=3000 pontos, ultima obs <=10 dias atras, sem gaps >10d
  - Backup em .bak antes de sobrescrever
  - Recusa nova versao se for significativamente mais curta (anti-truncamento)

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
    print("  - A tentar FRED (St. Louis Fed)...")
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


def fetch_yfinance():
    print("  - Fallback: a tentar Yahoo Finance (BZ=F)...")
    import yfinance as yf

    def _do():
        ticker = yf.Ticker("BZ=F")
        df = ticker.history(start=HISTORY_START, auto_adjust=False)
        if df.empty:
            raise ValueError("Yahoo Finance devolveu vazio.")
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


def atualizar_brent():
    print("-> A atualizar Brent diario...")

    df = None
    for fonte in (fetch_fred, fetch_yfinance):
        try:
            cand = fonte()
            ok, msg = _validar(cand)
            if ok:
                print(f"  OK {fonte.__name__}: {len(cand)} pontos validos.")
                df = cand
                break
            print(f"  X  {fonte.__name__} validacao: {msg}")
        except Exception as e:
            print(f"  X  {fonte.__name__} falhou: {e}")

    if df is None:
        print("ERRO: todas as fontes falharam. CSV antigo preservado.")
        sys.exit(1)

    df['observation_date'] = pd.to_datetime(df['observation_date']).dt.strftime('%Y-%m-%d')
    df = df[df['observation_date'] >= HISTORY_START]
    df = df.sort_values('observation_date').drop_duplicates('observation_date', keep='last')
    df['DCOILBRENTEU'] = df['DCOILBRENTEU'].round(2)
    df = df.reset_index(drop=True)

    if os.path.exists(CSV_PATH):
        try:
            old = pd.read_csv(CSV_PATH, on_bad_lines='skip')
            if len(old) > len(df) * 1.05:
                print(f"ERRO: nova versao ({len(df)}) mais curta que antiga ({len(old)}). Abortado.")
                sys.exit(1)
            shutil.copy2(CSV_PATH, CSV_PATH + '.bak')
            print(f"  -> backup em {CSV_PATH}.bak")
        except Exception as e:
            print(f"  - Sem backup ({e}) - a continuar.")

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    df.to_csv(CSV_PATH, index=False, lineterminator='\n')
    print(f"OK! {len(df)} dias salvos ({df['observation_date'].iloc[0]} -> {df['observation_date'].iloc[-1]})")


if __name__ == "__main__":
    atualizar_brent()
