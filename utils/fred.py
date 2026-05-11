"""
Bootstrap manual do CSV do Brent a partir do download da FRED.

Faz o equivalente do utils/dgeg.py mas para o Brent:
  - Lê data/raw/DCOILBRENTEU.csv (CSV descarregado manualmente da página
    https://fred.stlouisfed.org/series/DCOILBRENTEU)
  - Limpa (remove linhas com '.', converte para número, ordena)
  - Grava em data/processed/brent.csv no formato que o site espera
    (observation_date, DCOILBRENTEU)

Corre uma vez para iniciar/repor o histórico. Depois é o api/brent.py
que mantém o ficheiro atualizado todos os dias via API.
"""

import os
import pandas as pd

RAW_PATH = 'data/raw/FRED.csv'
OUT_PATH = 'data/processed/brent.csv'


def main():
    # Aceita FRED.csv (nome usado neste projeto) ou DCOILBRENTEU.csv
    # (nome original do download da FRED).
    raw = RAW_PATH if os.path.exists(RAW_PATH) else 'data/raw/DCOILBRENTEU.csv'
    if not os.path.exists(raw):
        raise FileNotFoundError(
            f"Não encontrei {RAW_PATH} nem data/raw/DCOILBRENTEU.csv. "
            f"Descarrega o CSV de "
            f"https://fred.stlouisfed.org/series/DCOILBRENTEU "
            f"(botão 'Download') e põe-no como {RAW_PATH}."
        )

    # 1. Lê o CSV da FRED (formato moderno: observation_date,DCOILBRENTEU;
    #    formato antigo: DATE,DCOILBRENTEU)
    df = pd.read_csv(raw)

    # 2. A FRED usa nomes consistentes mas em maiúsculas — normalizar.
    df.columns = [c.strip() for c in df.columns]
    if 'DATE' in df.columns:
        df = df.rename(columns={'DATE': 'observation_date'})
    elif 'observation_date' not in df.columns:
        # Fallback: assume que a primeira coluna é a data
        df = df.rename(columns={df.columns[0]: 'observation_date'})

    # 3. Limpar valores em falta (FRED usa '.' para feriados/fins de semana)
    df['DCOILBRENTEU'] = pd.to_numeric(df['DCOILBRENTEU'], errors='coerce')
    df = df.dropna(subset=['DCOILBRENTEU'])
    df['DCOILBRENTEU'] = df['DCOILBRENTEU'].round(2)

    # 4. Normalizar a data para 'YYYY-MM-DD'
    df['observation_date'] = (
        pd.to_datetime(df['observation_date']).dt.strftime('%Y-%m-%d')
    )

    df = df.sort_values('observation_date').reset_index(drop=True)
    df = df[['observation_date', 'DCOILBRENTEU']]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    df.to_csv(OUT_PATH, index=False)

    print(f"✅ SUCESSO! Histórico de {len(df)} dias limpo e gravado em {OUT_PATH}")
    print(f"   Primeiro dia: {df['observation_date'].iloc[0]}")
    print(f"   Último dia:   {df['observation_date'].iloc[-1]}")


if __name__ == "__main__":
    main()
