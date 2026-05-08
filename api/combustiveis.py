import os
import requests
import pandas as pd
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import urllib3
import time

# Ocultar avisos SSL comuns em sites governamentais
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Caminho correto para correr a partir da raiz do projeto (SVDC3)
CSV_PATH = 'data/processed/combustiveis.csv'

def buscar_dgeg_periodo(data_ini, data_fim):
    """Função auxiliar para fazer o pedido à DGEG num período específico."""
    url_api = "https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PMD"
    params = {"dataIni": data_ini, "dataFim": data_fim}
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://precoscombustiveis.dgeg.gov.pt',
        'Referer': 'https://precoscombustiveis.dgeg.gov.pt/estatistica/preco-medio-diario/'
    }
    
    response = requests.get(url_api, params=params, headers=headers, verify=False, timeout=15)
    # Se o método GET não for permitido (405), tenta POST
    if response.status_code == 405:
        response = requests.post(url_api, json=params, headers=headers, verify=False, timeout=15)
        
    response.raise_for_status()
    return response.json().get('resultado', [])

def extrair_dgeg(historico_completo=False):
    """Extrai da DGEG. Se historico_completo for True, saca 10 anos. Se não, saca 15 dias."""
    print("A aceder à fonte Primária: API DGEG...")
    resultados = []
    
    if historico_completo:
        print("⚠️ Base de dados não encontrada. A iniciar extração de 10 ANOS de histórico...")
        ano_atual = datetime.now().year
        # Vai buscar ano a ano para o servidor do Estado não bloquear o pedido
        for ano in range(ano_atual - 10, ano_atual + 1):
            data_ini = f"{ano}-01-01"
            data_fim = f"{ano}-12-31" if ano != ano_atual else datetime.now().strftime('%Y-%m-%d')
            print(f"  -> A descarregar ano {ano}...")
            try:
                res = buscar_dgeg_periodo(data_ini, data_fim)
                resultados.extend(res)
                time.sleep(1) # Pausa amigável de 1 segundo para não sobrecarregar o servidor
            except Exception as e:
                print(f"     Falha ao extrair {ano}: {e}")
    else:
        # Modo normal diário (margem de 15 dias para segurança)
        data_fim = datetime.now().strftime('%Y-%m-%d')
        data_ini = (datetime.now() - timedelta(days=15)).strftime('%Y-%m-%d')
        resultados = buscar_dgeg_periodo(data_ini, data_fim)
        
    # Processar o JSON resultante
    dados_por_data = {}
    for item in resultados:
        data_item = str(item.get('Data', ''))[:10]
        combustivel = str(item.get('TipoCombustivel', '')).lower()
        preco_str = str(item.get('Preco', ''))
        
        if not data_item or not preco_str:
            continue
            
        preco_float = float(preco_str.replace('€', '').replace(',', '.').strip())
        if data_item not in dados_por_data:
            dados_por_data[data_item] = {}
            
        if 'gasóleo' in combustivel or 'gasoleo' in combustivel:
            if 'simples' in combustivel:
                dados_por_data[data_item]['gasoleo_pvp_eur_l'] = preco_float
        if 'gasolina' in combustivel:
            if '95' in combustivel and 'simples' in combustivel:
                dados_por_data[data_item]['gasolina95_pvp_eur_l'] = preco_float

    linhas = []
    for data, precos in dados_por_data.items():
        if 'gasoleo_pvp_eur_l' in precos and 'gasolina95_pvp_eur_l' in precos:
            linhas.append({
                'date': data,
                'gasoleo_pvp_eur_l': precos['gasoleo_pvp_eur_l'],
                'gasolina95_pvp_eur_l': precos['gasolina95_pvp_eur_l']
            })
    return pd.DataFrame(linhas)

def extrair_ense():
    """Fallback: Extrai os preços de referência oficiais da ENSE usando BeautifulSoup."""
    print("A tentar fonte Secundária: ENSE...")
    url = "https://www.ense-epe.pt/precos-de-referencia/"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    response = requests.get(url, headers=headers, verify=False, timeout=15)
    response.raise_for_status()
    
    soup = BeautifulSoup(response.text, 'html.parser')
    tabela = soup.find('table', class_='table')
    if not tabela: 
        return pd.DataFrame()
        
    linhas = []
    for tr in tabela.find_all('tr'):
        tds = tr.find_all('td')
        if len(tds) >= 3:
            try:
                data_iso = datetime.strptime(tds[0].text.strip(), '%d/%m/%Y').strftime('%Y-%m-%d')
                gasolina_float = float(tds[1].text.replace('€', '').replace(',', '.').strip())
                gasoleo_float = float(tds[2].text.replace('€', '').replace(',', '.').strip())
                linhas.append({'date': data_iso, 'gasoleo_pvp_eur_l': gasoleo_float, 'gasolina95_pvp_eur_l': gasolina_float})
            except Exception:
                continue
    return pd.DataFrame(linhas)

def atualizar_combustiveis():
    print("A iniciar pipeline DataOps de Combustíveis...")
    df_novo = pd.DataFrame()
    
    # Lógica de Self-Healing: Se o ficheiro não existir, pede histórico completo (10 anos)
    precisa_historico = not os.path.exists(CSV_PATH)
    
    # 1. Tentar Fonte Primária (DGEG)
    try:
        df_novo = extrair_dgeg(historico_completo=precisa_historico)
        if not df_novo.empty:
            print(f"✅ SUCESSO: {len(df_novo)} dias de dados recolhidos da DGEG!")
    except Exception as e:
        print(f"⚠️ A DGEG falhou: {e}")
        
    # 2. Tentar Fonte Secundária (só para modo diário)
    if df_novo.empty and not precisa_historico:
        try:
            df_novo = extrair_ense()
            if not df_novo.empty:
                print(f"✅ SUCESSO: Dados recolhidos da ENSE!")
        except Exception as e:
            print(f"⚠️ A ENSE também falhou: {e}")
            
    if df_novo.empty:
        print("❌ ERRO CRÍTICO: Impossível aceder a fontes oficiais hoje.")
        return

    # 3. Guardar na Base de Dados
    try:
        if not precisa_historico:
            df_antigo = pd.read_csv(CSV_PATH)
            # Fundir com os dados antigos e manter sempre os mais recentes em caso de datas iguais
            df_final = pd.concat([df_antigo, df_novo]).drop_duplicates(subset=['date'], keep='last')
        else:
            df_final = df_novo
            
        df_final = df_final.sort_values('date')
        os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
        df_final.to_csv(CSV_PATH, index=False)
        print(f"🔥 Operação concluída! CSV conta agora com {len(df_final)} dias em: {CSV_PATH}")
        
    except Exception as e:
        print(f"❌ Erro ao gravar o CSV: {e}")

if __name__ == "__main__":
    atualizar_combustiveis()