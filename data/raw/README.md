# data/raw/ — Ficheiros originais

Ficheiros tal como vieram das fontes oficiais. **Não editar.** Os notebooks em
`notebooks/` consomem estes ficheiros e produzem os CSVs limpos em
`data/processed/`.

## Inventário

| Ficheiro | Fonte | Descrição |
|----------|-------|-----------|
| `DCOILBRENTEU.csv` | [FRED](https://fred.stlouisfed.org/series/DCOILBRENTEU) | Brent crude oil — preço diário em USD/barril (1987→hoje) |
| `DCOILWTICO.csv` | [FRED](https://fred.stlouisfed.org/series/DCOILWTICO) | WTI crude oil — alternativa americana ao Brent |
| `dgeg-pcr-2004-2026_18_pt.xlsx` | [DGEG](https://www.dgeg.gov.pt/pt/estatistica/energia/precos-de-energia/) | Preços de combustíveis em Portugal (semanal) |
| `pordata_taxa_inflacao.xlsx` | [PORDATA](https://www.pordata.pt/) | IPC anual por classe COICOP, 1960→2025 |
| `wob_full.csv` | [EU Weekly Oil Bulletin](https://github.com/the-Hull/weekly_oil_bulletin) | Preços de combustíveis nos 27 países da UE |
| `serie_dormidas_NUTS2024.zip` | [Turismo de Portugal](https://travelbi.turismodeportugal.pt/) | Dormidas mensais por NUTS II, base 2024 |
| `serie_dormidas_NUTS2013.zip` | [Turismo de Portugal](https://travelbi.turismodeportugal.pt/) | Dormidas mensais por NUTS II, base 2013 |
| `50m_cultural.zip` | [Natural Earth](https://www.naturalearthdata.com/) | Shapefiles culturais 1:50m (mapas) |

## Como atualizar

Os ficheiros do FRED podem ser re-descarregados a qualquer momento. Os outros
exigem ir aos portais respetivos e baixar manualmente. Depois de substituir
um ficheiro raw, correr o notebook correspondente para regenerar o
`data/processed/...` correspondente.
