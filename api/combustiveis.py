import os
import re
import json
import pandas as pd
import requests

# Caminho direto para o ficheiro final
CSV_PATH = '../data/processed/combustiveis.csv'

def atualizar_combustiveis():
    print("A extrair dados históricos e recentes do maisgasolina.com...")
    url = "https://www.maisgasolina.com/estatisticas-dos-combustiveis/"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        html = response.text
        
        # Procura as séries do Highcharts no código-fonte
        series_re = re.finditer(r"name\s*:\s*['\"]([^'\"]+)['\"][\s\S]*?data\s*:\s*(\[[\s\S]*?\])\s*[,}]", html)
        
        dados_extraidos = {'gasoleo': {}, 'gasolina': {}}
        
        for match in series_re:
            name = match.group(1).lower()
            data_str = match.group(2)
            
            # Converte a data do formato Javascript (Date.UTC) para YYYY-MM-DD
            data_str_clean = re.sub(
                r'Date\.UTC\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)',
                lambda m: f'"{m.group(1)}-{int(m.group(2))+1:02d}-{int(m.group(3)):02d}"',
                data_str
            )
            
            try:
                data_str_clean = data_str_clean.replace("'", '"')
                pontos = json.loads(data_str_clean)
                
                for ponto in pontos:
                    if isinstance(ponto, list) and len(ponto) == 2:
                        data_iso = ponto[0]
                        preco = ponto[1]
                        
                        if 'gasóleo simples' in name or 'diesel' in name:
                            dados_extraidos['gasoleo'][data_iso] = preco
                        elif 'gasolina 95 simples' in name:
                            dados_extraidos['gasolina'][data_iso] = preco
                            
            except Exception as e:
                continue

        # Junta os dados do gasóleo e gasolina usando a data
        todas_datas = set(dados_extraidos['gasoleo'].keys()).union(set(dados_extraidos['gasolina'].keys()))
        linhas = []
        for d in sorted(todas_datas):
            linhas.append({
                'date': d,
                'gasoleo_pvp_eur_l': dados_extraidos['gasoleo'].get(d, None),
                'gasolina95_pvp_eur_l': dados_extraidos['gasolina'].get(d, None)
            })
            
        df_novo = pd.DataFrame(linhas)
        # Remove linhas que não tenham qualquer preço
        df_novo = df_novo.dropna(subset=['gasoleo_pvp_eur_l', 'gasolina95_pvp_eur_l'], how='all')
        
        # Se já tiveres um CSV antigo, fazemos um 'merge' inteligente (mantendo o mais recente)
        if os.path.exists(CSV_PATH):
            df_antigo = pd.read_csv(CSV_PATH)
            df_final = pd.concat([df_antigo, df_novo]).drop_duplicates(subset=['date'], keep='last')
        else:
            df_final = df_novo
            
        # Ordena cronologicamente
        df_final = df_final.sort_values('date')
        
        # Guarda o ficheiro final
        os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
        df_final.to_csv(CSV_PATH, index=False)
        print(f"✅ Sucesso! O ficheiro tem agora {len(df_final)} registos e está guardado em {CSV_PATH}")
        
    except Exception as e:
        print(f"❌ Erro ao atualizar combustíveis: {e}")

if __name__ == "__main__":
    atualizar_combustiveis()