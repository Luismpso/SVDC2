# Notebooks de preparação de dados

Estes notebooks documentam, passo a passo, como cada CSV em `../data/`
foi gerado a partir das fontes originais.

## Como correr

```bash
cd notebooks
pip install pandas openpyxl matplotlib jupyter
jupyter lab
```

## Ordem sugerida

| # | Notebook | Fonte | Output |
|---|----------|-------|--------|
| 1 | `prep_brent.ipynb`          | FRED — DCOILBRENTEU      | `brent_daily.csv` |
| 2 | `prep_combustiveis.ipynb`   | DGEG — Histórico UE      | `precos_combustiveis_pt.csv` |
| 3 | `prep_inflacao.ipynb`       | PORDATA / INE            | `inflacao_pordata.csv` |
| 4 | `prep_chokepoints.ipynb`    | EIA — Chokepoints (Mar 2026) | 5 CSVs do dossiê do Estreito |
| 5 | `prep_turismo.ipynb`        | Turismo de Portugal      | `dormidas_regiao.csv` |

Cada notebook é independente — podes correr só o que te interessa.

## Reproducibilidade

Todos os notebooks usam **caminhos relativos** (`../data/`) e podem ser
re-executados se quiseres regenerar os CSVs limpos a partir dos ficheiros
originais. Os xlsx originais e os zips ficam em `../data/` (não-versionados
em git deveriam estar, mas mantêm-se aqui para a entrega).

— *Luis Miguel Pereira Silva · PG60390 · Universidade do Minho · Maio 2026*
