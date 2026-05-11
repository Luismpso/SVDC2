import pandas as pd
import os

# 1. Lê o CSV bruto exportado manualmente (separado por ponto e vírgula)
df_raw = pd.read_csv('data/raw/dgeg.csv', sep=';', header=0, names=['Data', 'Tipo', 'Preco'])

# 2. Limpar os preços (remover o símbolo ' €', trocar ',' por '.' e converter para número)
df_raw['Preco'] = df_raw['Preco'].str.replace(' €', '', regex=False).str.replace(',', '.').astype(float)

# 3. Reorganizar a tabela (Pivot) para ter as datas nas linhas e os combustíveis nas colunas
df_pivot = df_raw.pivot(index='Data', columns='Tipo', values='Preco').reset_index()

# 4. Renomear as colunas para os nomes que o teu 'api.js' e o D3.js esperam
df_pivot = df_pivot.rename(columns={
    'Data': 'date',
    'Gasóleo simples': 'gasoleo_pvp_eur_l',
    'Gasolina simples 95': 'gasolina95_pvp_eur_l'
})

# Garantir que a pasta processada existe
os.makedirs('data/processed', exist_ok=True)

# 5. Gravar o ficheiro final limpo e ordenado
df_pivot = df_pivot.sort_values('date')
df_pivot.to_csv('data/processed/combustiveis.csv', index=False)

print(f"✅ SUCESSO! Histórico de {len(df_pivot)} dias limpo e gravado em data/processed/combustiveis.csv")