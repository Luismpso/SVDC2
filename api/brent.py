import os
import pandas as pd
import yfinance as yf
import requests
import io

CSV_PATH = 'data/processed/brent.csv'

def fetch_yfinance():
    print("  · A tentar Yahoo Finance (BZ=F)...")
    # Puxa desde 2016 para garantir os teus 10 anos de histórico
    ticker = yf.Ticker("BZ=F")
    df = ticker.history(start="2016-01-01")
    if df.empty:
        raise ValueError("Yahoo Finance devolveu dados vazios.")
    
    df = df.reset_index()
    # Remover fuso horário e formatar data
    df['Date'] = pd.to_datetime(df['Date']).dt.tz_localize(None).dt.strftime('%Y-%m-%d')
    df = df[['Date', 'Close']].rename(columns={'Date': 'observation_date', 'Close': 'DCOILBRENTEU'})
    return df.dropna()

def fetch_fred():
    print("  · Fallback: A tentar FRED (St. Louis Fed)...")
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU"
    r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=20)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    if 'DATE' in df.columns:
        df = df.rename(columns={'DATE': 'observation_date'})
    df['DCOILBRENTEU'] = pd.to_numeric(df['DCOILBRENTEU'], errors='coerce')
    return df.dropna()

def atualizar_brent():
    print("→ A atualizar Brent diário (Histórico de 10 anos)...")
    df = None
    
    try:
        df = fetch_yfinance()
    except Exception as e:
        print(f"  ✗ Yahoo falhou: {e}")
        try:
            df = fetch_fred()
        except Exception as e2:
            print(f"  ✗ FRED falhou: {e2}")
            
    if df is None or df.empty:
        print("❌ Todas as fontes falharam. Brent não atualizado.")
        return

    df = df.sort_values('observation_date').reset_index(drop=True)
    df['DCOILBRENTEU'] = df['DCOILBRENTEU'].round(2)

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    df.to_csv(CSV_PATH, index=False)
    print(f"✅ Sucesso! O ficheiro Brent foi salvo com {len(df)} dias de histórico.")

if __name__ == "__main__":
    atualizar_brent()