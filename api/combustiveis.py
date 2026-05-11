"""
Atualização incremental do CSV de combustíveis (DGEG — PMD).

Estratégia:
  1. Lê data/processed/combustiveis.csv (já carregado com o histórico
     exportado manualmente — utils/dgeg.py + data/raw/dgeg.csv).
  2. Vai buscar à API DGEG os últimos N dias (com overlap de segurança
     de 15 dias, para apanhar revisões retroativas da DGEG).
  3. Faz merge incremental: deduplica por data, mantendo o valor mais
     recente devolvido pela API (corrige automaticamente revisões).
  4. Não rebenta se a API falhar: o CSV existente fica intacto.

Anti-falhas:
  - Tenta GET e depois POST, ambos com retries+backoff.
  - Parse defensivo: aceita várias convenções de nomes (camelCase,
    PascalCase) e várias formas de envelope JSON.
  - Se a API devolver vazio ou falhar, sai em silêncio com aviso, sem
    estragar o CSV.
"""

import os
import time
import requests
import pandas as pd
from datetime import datetime, timedelta
import urllib3

# DGEG usa certificados problemáticos; silenciar avisos.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CSV_PATH = 'data/processed/combustiveis.csv'
API_URL = "https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PMD"

# Overlap em dias: vai buscar os últimos N dias mesmo que já estejam no CSV.
# Apanha revisões retroativas da DGEG e garante que se um dia falhar, o
# próximo run apanha-o.
OVERLAP_DAYS = 15

# Mais retries = mais robustez. Cada tentativa espera mais um pouco.
MAX_RETRIES = 3
TIMEOUT_S = 30

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://precoscombustiveis.dgeg.gov.pt/estatistica/preco-medio-diario/',
}


def _get_field(item, *candidates):
    """Tenta vários nomes de campo (case-insensitive) e devolve o primeiro
    que existir e não for vazio."""
    # Match exato primeiro
    for c in candidates:
        if c in item and item[c] not in (None, ''):
            return item[c]
    # Match case-insensitive (fallback)
    lowered = {k.lower(): v for k, v in item.items() if isinstance(k, str)}
    for c in candidates:
        v = lowered.get(c.lower())
        if v not in (None, ''):
            return v
    return None


def _parse_response(res_json):
    """Aceita várias formas de envelope JSON e devolve uma lista de items."""
    if isinstance(res_json, list):
        return res_json
    if isinstance(res_json, dict):
        for key in ('resultado', 'Resultado', 'result', 'data', 'Data', 'items'):
            v = res_json.get(key)
            if isinstance(v, list):
                return v
        # Último recurso: se for um dict com uma única lista lá dentro, usa-a.
        for v in res_json.values():
            if isinstance(v, list):
                return v
    return []


def _fetch_chunk(data_ini, data_fim):
    """Vai buscar um intervalo à API, com retries. Devolve lista de items
    ou [] se falhar."""
    params = {"dataIni": data_ini, "dataFim": data_fim}

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            # Tenta GET primeiro (é o que a UI da DGEG usa).
            r = requests.get(
                API_URL, params=params, headers=HEADERS,
                verify=False, timeout=TIMEOUT_S
            )
            if r.status_code == 405:
                # Algumas versões da API só aceitam POST com JSON body.
                r = requests.post(
                    API_URL, json=params, headers=HEADERS,
                    verify=False, timeout=TIMEOUT_S
                )
            r.raise_for_status()

            items = _parse_response(r.json())
            if items:
                return items
            print(f"  · Tentativa {attempt}: API respondeu mas sem dados.")
        except requests.exceptions.RequestException as e:
            print(f"  · Tentativa {attempt} falhou: {e}")
        except ValueError as e:
            # JSON inválido
            print(f"  · Tentativa {attempt}: resposta não é JSON ({e}).")

        if attempt < MAX_RETRIES:
            time.sleep(2 ** attempt)  # backoff: 2s, 4s, 8s

    return []


def _items_to_dataframe(items):
    """Converte a lista de items da API num DataFrame com as colunas que o
    site espera (date, gasolina95_pvp_eur_l, gasoleo_pvp_eur_l)."""
    dados = {}
    for item in items:
        # A API usa camelCase no preco-medio-diario, mas alguns endpoints
        # da DGEG usam PascalCase. Tentamos ambos.
        data_raw = _get_field(item, 'data', 'Data')
        tipo_raw = _get_field(item, 'tipoCombustivel', 'TipoCombustivel', 'tipo')
        preco_raw = _get_field(item, 'precoMedio', 'Preco', 'preco', 'PrecoMedio')

        if not data_raw or not tipo_raw or not preco_raw:
            continue

        # Normalizar data (vem como '2026-05-10T00:00:00' ou '2026-05-10')
        data_str = str(data_raw)[:10]

        # Normalizar preço (vem como "1,9942 €" ou "1.9942" ou 1.9942)
        preco_clean = (
            str(preco_raw).replace('€', '').replace(',', '.').strip()
        )
        try:
            preco = float(preco_clean)
        except ValueError:
            continue

        tipo_norm = str(tipo_raw).lower().strip()

        if data_str not in dados:
            dados[data_str] = {'date': data_str}

        if 'gasóleo simples' in tipo_norm or 'gasoleo simples' in tipo_norm:
            dados[data_str]['gasoleo_pvp_eur_l'] = preco
        elif 'gasolina simples 95' in tipo_norm:
            dados[data_str]['gasolina95_pvp_eur_l'] = preco

    return pd.DataFrame(list(dados.values()))


def _determinar_intervalo():
    """Decide que intervalo pedir à API com base no CSV existente."""
    hoje = datetime.now().date()

    if not os.path.exists(CSV_PATH):
        # Sem CSV ainda — vai buscar 1 mês para arrancar (o resto vem do
        # bootstrap manual em utils/dgeg.py).
        data_ini = hoje - timedelta(days=30)
        return data_ini.strftime('%Y-%m-%d'), hoje.strftime('%Y-%m-%d')

    df = pd.read_csv(CSV_PATH)
    if df.empty or 'date' not in df.columns:
        data_ini = hoje - timedelta(days=30)
    else:
        ultima = pd.to_datetime(df['date']).max().date()
        # Recuar OVERLAP_DAYS dias para apanhar revisões retroativas.
        data_ini = ultima - timedelta(days=OVERLAP_DAYS)

    return data_ini.strftime('%Y-%m-%d'), hoje.strftime('%Y-%m-%d')


def atualizar():
    print("→ A atualizar combustíveis (DGEG)...")

    if not os.path.exists(CSV_PATH):
        print(f"⚠️  {CSV_PATH} não existe. Corre primeiro 'python utils/dgeg.py'")
        print(f"    para criar o histórico inicial a partir de data/raw/dgeg.csv.")
        print(f"    Vou continuar e criar um CSV novo só com os dados da API.")

    data_ini, data_fim = _determinar_intervalo()
    print(f"  · A pedir à DGEG: {data_ini} → {data_fim}")

    items = _fetch_chunk(data_ini, data_fim)
    if not items:
        print("⚠️  API não devolveu dados. CSV existente fica intacto.")
        return

    df_novos = _items_to_dataframe(items)
    if df_novos.empty:
        print("⚠️  API respondeu mas não consegui extrair preços válidos. CSV intacto.")
        return

    print(f"  · Recebidos {len(df_novos)} dias da API.")

    # Merge com o existente (se houver).
    if os.path.exists(CSV_PATH):
        df_antigo = pd.read_csv(CSV_PATH)
        df_final = pd.concat([df_antigo, df_novos], ignore_index=True)
    else:
        df_final = df_novos

    # Garantir colunas certas e tipos certos.
    for col in ('gasolina95_pvp_eur_l', 'gasoleo_pvp_eur_l'):
        if col not in df_final.columns:
            df_final[col] = pd.NA

    # Dedupe por data, mantendo a versão mais recente (apanha revisões).
    df_final = (
        df_final
        .drop_duplicates(subset=['date'], keep='last')
        .sort_values('date')
        .reset_index(drop=True)
    )

    # Reordenar colunas para bater certo com o que o site espera.
    df_final = df_final[['date', 'gasolina95_pvp_eur_l', 'gasoleo_pvp_eur_l']]

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    df_final.to_csv(CSV_PATH, index=False)

    ultima_data = df_final['date'].iloc[-1]
    print(f"✅ {CSV_PATH} atualizado: {len(df_final)} registos. Última data: {ultima_data}")


if __name__ == "__main__":
    atualizar()