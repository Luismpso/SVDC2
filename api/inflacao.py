import os
import requests
import pandas as pd
import urllib3

# Limpar o terminal de avisos desnecessários
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CSV_PATH = 'data/processed/inflacao.csv'

def atualizar_inflacao():
    print("A iniciar ligação ao BPstat (Endpoint OData /data/v1/)...")
    
    # Mapeamento dos BI das séries (Taxa variação média 12 meses)
    series_map = {
        '12521946': 'Total',
        '12521947': 'Alimentacao',
        '12521950': 'Energia',
        '12521953': 'Transportes'
    }
    
    ids_str = ",".join(series_map.keys())
    
    # O URL oficial para consumo de dados (OData)
    # Mudança crítica: de /api/v2 para /data/v1/series/observations
    url = f"https://bpstat.bportugal.pt/data/v1/series/observations?series_ids={ids_str}"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://bpstat.bportugal.pt/'
    }
    
    try:
        response = requests.get(url, headers=headers, verify=False, timeout=25)
        
        # Se este der 404, o BPstat mudou o endpoint para o formato de "Dataset"
        if response.status_code == 404:
            print("⚠️ Endpoint /series/ não encontrado. A tentar via /observations/series...")
            url = f"https://bpstat.bportugal.pt/data/v1/observations/series?series_ids={ids_str}"
            response = requests.get(url, headers=headers, verify=False, timeout=25)

        response.raise_for_status()
        data = response.json()
        
        registos = []
        
        # A estrutura da API v1/Data devolve uma lista de observações
        # Cada item no JSON costuma ser uma observação direta ou um agrupamento por série
        for item in data:
            s_id = str(item.get('series_id'))
            nome_indicador = series_map.get(s_id)
            
            if not nome_indicador:
                continue
                
            # Extrair observações (a estrutura pode vir como lista de dicts)
            for obs in item.get('observations', []):
                registos.append({
                    'date': obs['period'], # YYYY-MM-DD
                    'indicador': nome_indicador,
                    'valor': float(obs['value']) if obs['value'] is not None else None
                })
        
        if not registos:
            print("❌ O servidor respondeu, mas não foram encontradas observações.")
            return

        # Criar DataFrame e Pivotar
        df_raw = pd.DataFrame(registos)
        df_final = df_raw.pivot(index='date', columns='indicador', values='valor').reset_index()
        
        # Ordenar e guardar
        df_final = df_final.sort_values('date').dropna(subset=['Total'])
        
        os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
        df_final.to_csv(CSV_PATH, index=False)
        
        print(f"✅ SUCESSO! Inflação mensal atualizada em {CSV_PATH}")
        print(f"📅 Dados disponíveis até: {df_final['date'].max()}")

    except Exception as e:
        print(f"❌ Erro na extração: {e}")
        print("\n💡 Dica: Se o erro for 404, o BPstat pode estar em manutenção ou alterou radicalmente a API.")

if __name__ == "__main__":
    atualizar_inflacao()