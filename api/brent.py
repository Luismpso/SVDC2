import os
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta

CSV_PATH = '../data/processed/brent.csv'

def atualizar_brent():
    print("A atualizar dados do Brent (Yahoo Finance)...")
    
    data_inicio = "2020-01-01" # Data por defeito para criar histórico inicial
    df_antigo = None
    
    # Se o ficheiro já existir, vamos procurar apenas os últimos dias
    if os.path.exists(CSV_PATH):
        try:
            df_antigo = pd.read_csv(CSV_PATH)
            if not df_antigo.empty:
                # Pega na última data existente e recua 5 dias por segurança 
                # (para cobrir fins de semana, feriados ou correções de mercado)
                ultima_data_str = df_antigo['observation_date'].max()
                ultima_data = datetime.strptime(ultima_data_str, '%Y-%m-%d')
                data_inicio = (ultima_data - timedelta(days=5)).strftime('%Y-%m-%d')
                print(f"CSV encontrado. A procurar dados apenas a partir de {data_inicio}...")
        except Exception as e:
            print(f"Aviso: Não foi possível ler o CSV antigo, a recriar histórico inteiro. Erro: {e}")

    try:
        # Fazer o fetch ao Yahoo Finance
        brent = yf.Ticker("BZ=F")
        df_novo = brent.history(start=data_inicio)
        
        if df_novo.empty:
            print("Nenhum dado novo encontrado para o Brent.")
            return

        # Limpar e formatar os dados novos
        df_novo = df_novo.reset_index()
        
        # Garantir que extraímos a data corretamente (o yfinance devolve com timezone)
        if 'Date' in df_novo.columns:
            df_novo['observation_date'] = df_novo['Date'].dt.strftime('%Y-%m-%d')
        else:
            df_novo['observation_date'] = df_novo['Datetime'].dt.strftime('%Y-%m-%d')
            
        df_novo = df_novo[['observation_date', 'Close']]
        df_novo.columns = ['observation_date', 'DCOILBRENTEU']
        df_novo['DCOILBRENTEU'] = df_novo['DCOILBRENTEU'].round(2)

        # Fundir com os dados antigos (se existirem)
        if df_antigo is not None and not df_antigo.empty:
            # Junta tudo e, se houver datas repetidas, mantém a observação mais recente
            df_final = pd.concat([df_antigo, df_novo]).drop_duplicates(subset=['observation_date'], keep='last')
        else:
            df_final = df_novo
            
        # Ordenar cronologicamente
        df_final = df_final.sort_values('observation_date')

        # Guardar
        os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
        df_final.to_csv(CSV_PATH, index=False)
        print(f"✅ Sucesso! Brent atualizado. O ficheiro tem agora {len(df_final)} registos e está guardado em {CSV_PATH}")

    except Exception as e:
        print(f"❌ Erro ao atualizar Brent: {e}")

if __name__ == "__main__":
    atualizar_brent()