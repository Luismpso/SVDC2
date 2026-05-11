"""
Atualização do CSV do Brent diário (FRED + Yahoo).

Estratégia:
  1. FRED (DCOILBRENTEU) — fonte oficial, ~1 semana de atraso.
  2. Yahoo Finance (BZ=F, Brent futures) — atualiza diariamente.
  3. Merge: FRED prevalece em datas que ambos têm; Yahoo tapa o
     buraco dos últimos dias até a FRED apanhar.
  4. Limita o histórico desde START_DATE (2016-01-01).
  5. Limpeza agressiva em CADA passo: só sobrevivem linhas com
     data ISO válida e preço numérico positivo.

Anti-falhas:
  - 3 retries com backoff em cada fonte.
  - Limpeza dupla: por fonte e no fim.
  - Se ambas falharem, CSV existente fica intacto.
"""

import io
import os
import time

import pandas as pd
import requests

CSV_PATH = 'data/processed/brent.csv'
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU"

MAX_RETRIES = 3
TIMEOUT_S = 30

# Limite mínimo do histórico — a FRED guarda desde 1987 mas o projeto
# só precisa de 2016+. Mantém o CSV em ~2600 linhas em vez de 10000.
START_DATE = "2016-01-01"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
}


def _clean(df):
    """Filtra rigorosamente: só linhas com data ISO válida e preço
    numérico positivo. Apanha NaN, strings vazias, zeros, negativos."""
    if df is None or df.empty:
        return df

    # Forçar a data a string ISO 'YYYY-MM-DD' (apanha qualquer formato)
    df = df.copy()
    df['observation_date'] = pd.to_datetime(
        df['observation_date'], errors='coerce'
    )
    df = df.dropna(subset=['observation_date'])
    df['observation_date'] = df['observation_date'].dt.strftime('%Y-%m-%d')

    # Forçar o preço a numérico — string vazia, ".", None → NaN
    df['DCOILBRENTEU'] = pd.to_numeric(
        df['DCOILBRENTEU'], errors='coerce'
    )

    # Filtro estrito: tem de ser > 0 (apanha NaN, 0, negativos)
    df = df[df['DCOILBRENTEU'] > 0]
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

    # Limitar ao período do projeto
    df = df[df['observation_date'] >= START_DATE]

    return df[['observation_date', 'DCOILBRENTEU']]


def _retry(fn, label):
    """Corre fn() com retries+backoff. Devolve DataFrame limpo ou None."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            result = fn()
            cleaned = _clean(result)
            if cleaned is not None and not cleaned.empty:
                print(f"  ✓ {label}: {len(cleaned)} dias.")
                return cleaned
            print(f"  · {label}, tentativa {attempt}: devolveu vazio.")
        except Exception as e:
            print(f"  · {label}, tentativa {attempt} falhou: {e}")

        if attempt < MAX_RETRIES:
            time.sleep(2 ** attempt)
    return None


def fetch_fred():
    """FRED — DCOILBRENTEU spot."""
    print("  · A tentar FRED (DCOILBRENTEU)...")
    r = requests.get(FRED_URL, headers=HEADERS, timeout=TIMEOUT_S)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    df.columns = [c.strip() for c in df.columns]
    if 'DATE' in df.columns:
        df = df.rename(columns={'DATE': 'observation_date'})
    return df


def fetch_yfinance():
    """Yahoo — BZ=F futures (mesmo número do investing.com)."""
    print("  · A tentar Yahoo Finance (BZ=F)...")
    import yfinance as yf
    ticker = yf.Ticker("BZ=F")
    df = ticker.history(start=START_DATE)
    if df.empty:
        raise ValueError("Yahoo devolveu série vazia.")
    df = df.reset_index()
    df['Date'] = pd.to_datetime(df['Date']).dt.tz_localize(None)
    df = df[['Date', 'Close']].rename(
        columns={'Date': 'observation_date', 'Close': 'DCOILBRENTEU'}
    )
    return df


def atualizar():
    print("→ A atualizar Brent diário (FRED + Yahoo)...")

    df_fred = _retry(fetch_fred, "FRED")
    df_yahoo = _retry(fetch_yfinance, "Yahoo")

    if df_fred is None and df_yahoo is None:
        print("⚠️  Ambas as fontes falharam. CSV existente fica intacto.")
        return

    # Ordem: antigo → Yahoo → FRED. Com keep='last', FRED vence em duplicados,
    # Yahoo enche os buracos pós-FRED-lag.
    fontes = []
    if os.path.exists(CSV_PATH):
        df_antigo = _clean(pd.read_csv(CSV_PATH))
        if df_antigo is not None and not df_antigo.empty:
            fontes.append(df_antigo)
    if df_yahoo is not None:
        fontes.append(df_yahoo)
    if df_fred is not None:
        fontes.append(df_fred)

    df_final = pd.concat(fontes, ignore_index=True)
    df_final = _clean(df_final)  # limpeza final defensiva

    df_final = (
        df_final
        .drop_duplicates(subset=['observation_date'], keep='last')
        .sort_values('observation_date')
        .reset_index(drop=True)
    )

    # Sanity check antes de gravar — nunca escrever linhas más
    assert df_final['DCOILBRENTEU'].notna().all(), "Há NaN no resultado final"
    assert (df_final['DCOILBRENTEU'] > 0).all(), "Há preços não positivos"

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    df_final.to_csv(CSV_PATH, index=False)

    ultima = df_final['observation_date'].iloc[-1]
    print(f"✅ {CSV_PATH} atualizado: {len(df_final)} registos. Última data: {ultima}")


if __name__ == "__main__":
    atualizar()
