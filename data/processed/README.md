# data/processed/ — Ficheiros limpos para o site

CSVs finais consumidos pelo site (`js/main.js` e `js/api.js`). Cada ficheiro é
**produzido por um notebook** em `notebooks/` a partir dos raw em `data/raw/`.

**Não editar à mão.** Se precisares de mudar algo, edita o notebook e re-corre.

## Inventário

| Ficheiro | Notebook produtor | Usado em |
|----------|-------------------|----------|
| `brent_daily.csv` | `prep_brent.ipynb` | Secção IV (Brent + combustíveis) — fallback se FRED API falhar |
| `precos_combustiveis_pt.csv` | `prep_combustiveis.ipynb` | Secção IV + calculadora pessoal |
| `inflacao_pordata.csv` | `prep_inflacao.ipynb` | Secção IV (small multiples) — fallback se INE API falhar |
| `dormidas_regiao.csv` | `prep_turismo.ipynb` | (reservado para extensão futura — turismo) |
| `chokepoints_overview.csv` | `prep_chokepoints.ipynb` | Secção II (4 séries de fluxos por rota) |
| `hormuz_flows.csv` | `prep_chokepoints.ipynb` | Detalhe Estreito de Ormuz (crude vs produtos vs LNG) |
| `suez_babmandeb_flows.csv` | `prep_chokepoints.ipynb` | (reservado — comparação com Suez/Bab el-Mandeb) |
| `cape_good_hope_flows.csv` | `prep_chokepoints.ipynb` | (reservado — rota alternativa) |
| `hormuz_destinations.csv` | `prep_chokepoints.ipynb` | Secção III (Sankey de destinos) |

## Esquema dos ficheiros principais

**`brent_daily.csv`** — Brent diário, FRED format
```
observation_date,DCOILBRENTEU
2025-09-01,67.42
...
```

**`precos_combustiveis_pt.csv`** — DGEG semanal
```
date,gasoleo_pvp_eur_l,gasolina95_pvp_eur_l
2025-09-01,1.502,1.628
...
```

**`inflacao_pordata.csv`** — IPC anual por classe COICOP
```
ano,Total,Transportes,Habitação...,...,Serviços de educação
2025,2.4,1.8,3.1,...
```

**`chokepoints_overview.csv`** — fluxos por chokepoint (mb/d)
```
chokepoint,2020,2021,2022,2023,2024,1H2025
Strait of Hormuz,19.2,19.7,21.9,21.8,20.7,20.9
...
```

## Como regenerar

```bash
cd notebooks
jupyter notebook   # ou jupyter lab
# correr cada prep_*.ipynb (Cell → Run All)
```

Os notebooks são **idempotentes**: podes correr quantas vezes quiseres com o
mesmo input que o output fica idêntico.
