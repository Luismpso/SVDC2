# O Preço da Guerra

Visualização de dados sobre o impacto económico da guerra Irão–EUA (Fev 2026)
em Portugal — do Estreito de Ormuz à bomba de gasolina.

**Autores:** Luis Miguel Pereira Silva (PG60390) · Guilherme Lobo Pinto (PG60225) ·
Mestrado em Inteligência Artificial · Universidade do Minho ·
Sistemas de Visualização de Dados e Conhecimento · Maio 2026

## 🚀 Como correr

D3.js precisa de um servidor HTTP (não funciona com `file://`). Opções:

**Opção A — Python (mais simples)**
```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```

**Opção B — Node**
```bash
npx serve .
```

**Opção C — VS Code + Live Server**
Instalar a extensão *Live Server* e clicar em "Go Live" no `index.html`.

## 🟢 Dados ao vivo (pipeline DataOps via GitHub Actions)

Em vez de o navegador fazer scraping em tempo real (que esbarra em CORS e
proxies pouco fiáveis), o repo tem **um workflow diário** em
`.github/workflows/update.yml` que corre os scripts Python em `api/`,
atualiza os CSVs em `data/processed/` e faz commit para o `main`. A página
limita-se a ler esses CSVs com `d3.csv()` — rápido, fiável e sem chaves
de API.

Barra fixa no topo da página indica o estado de cada série:

| Símbolo | Significado |
|---------|-------------|
| 🟢 | CSV produzido pelo último GitHub Action (fonte oficial alcançada) |
| ⚪ | CSV em falha — uma das séries não conseguiu ser atualizada |

### Fontes (primária em cima, fallback em baixo)

| Dataset | Primária | Fallback | Script |
|---------|----------|----------|--------|
| **Brent diário** | [Yahoo Finance (`BZ=F`)](https://finance.yahoo.com/quote/BZ%3DF/) | [FRED (DCOILBRENTEU)](https://fred.stlouisfed.org/series/DCOILBRENTEU) | `api/brent.py` |
| **Combustíveis PT** | [DGEG — API PMD](https://precoscombustiveis.dgeg.gov.pt/) | [ENSE — Preços de referência](https://www.ense-epe.pt/precos-de-referencia/) | `api/combustiveis.py` |
| **Inflação** | [Eurostat HICP (`prc_hicp_manr`)](https://ec.europa.eu/eurostat/) — classes CP00/CP01/NRG/CP07 | [BPstat](https://bpstat.bportugal.pt/) (série 5721524) para o Total nos meses recentes | `api/inflacao.py` |
| **Chokepoints** | [EIA — World Oil Transit Chokepoints](https://www.eia.gov/international/analysis/special-topics/World_Oil_Transit_Chokepoints) | — | `api/fluxos.py` |
| **Portagens nos chokepoints** | Notícias e tratados (Mar–Abr 2026) | — | Snapshot editorial — Secção II½ |

### Self-healing

`api/combustiveis.py` deteta se o CSV existe. Se não existir, vai buscar
**10 anos de histórico** à DGEG (ano a ano, com pausa amigável). Se já
existir, só busca os últimos 15 dias e faz merge. `api/brent.py` faz
sempre fetch desde 2016 com fallback Yahoo → FRED. `api/inflacao.py` usa
Eurostat como canónico e completa os 1–2 meses mais recentes via BPstat
sem inventar valores.

### O que fazer se o pipeline falhar antes da apresentação

Os CSVs em `data/processed/` ficam guardados no repo. Mesmo que o Action
falhe num dia, a página continua a mostrar tudo com os últimos dados
disponíveis. **Não rebenta.**

## 📂 Estrutura

```
SVDC3/
├── index.html                       # Estrutura da página (5+1 secções narrativas)
├── README.md
├── .github/workflows/update.yml     # Pipeline diário de dados
├── css/
│   └── styles.css                   # Tema editorial dark
├── js/
│   ├── api.js                       # Camada de leitura dos CSV (D3)
│   └── main.js                      # Visualizações D3 + calculadora
├── api/                             # Scripts Python da pipeline
│   ├── brent.py                     # Yahoo Finance + FRED fallback
│   ├── combustiveis.py              # DGEG + ENSE fallback
│   ├── inflacao.py                  # Eurostat + BPstat fallback
│   └── fluxos.py                    # EIA chokepoints + destinos Ormuz
├── notebooks/
│   └── prep_combustiveis.ipynb      # Exploração inicial do dataset DGEG
└── data/
    ├── raw/                         # Originais das fontes (snapshot inicial)
    │   └── dgeg.xlsx
    └── processed/                   # CSVs limpos consumidos pelo site
        ├── brent.csv                ← api/brent.py
        ├── combustiveis.csv         ← api/combustiveis.py
        ├── inflacao.csv             ← api/inflacao.py
        ├── chokepoints.csv          ← api/fluxos.py
        └── hormuz.csv               ← api/fluxos.py
```

**Pipeline:** `api/*.py` (diariamente via GitHub Actions) → `data/processed/*.csv` → `js/api.js` → `js/main.js` → DOM

## ✅ O que está feito

- [x] Estrutura completa das 5+1 secções (HTML + CSS editorial)
- [x] **Secção I** — Mapa-mundo com chokepoints + Estreito de Ormuz destacado + rotas animadas
- [x] **Secção II** — Gráfico de fluxos por rota (4 séries, 2020–2025), eixo temporal real
- [x] **Secção II½** — **A nova guerra das portagens** — Hormuz (Mar 2026) + tentativa Malaca (Abr 2026); comparação com Suez, Panamá e Estreitos Turcos
- [x] **Secção III** — Sankey de destinos (Ormuz → Região → País), com regiões coloridas
- [x] **Secção IV** — Brent + combustíveis PT com a guerra marcada (gráfico principal)
- [x] **Secção IV** — Inflação mensal por classe (Total, Transportes, Energia, Alimentação) — escala temporal real, com hover por mês
- [x] **Secção V** — Calculadora pessoal interativa
- [x] Pipeline DataOps com GitHub Actions (commit diário automático)
- [x] Tooltip partilhado, animações de entrada, responsivo
- [x] Inflação sem dados inventados: Eurostat HICP + BPstat (Banco de Portugal) como fallback
- [x] Suporte `prefers-reduced-motion` (acessibilidade)
- [x] Header, rodapé e README com identificação dos autores

## 🎤 Para os 5 minutos da apresentação

| Tempo | Secção | Mensagem-chave |
|-------|--------|----------------|
| 0:00–0:30 | Hero + Cap I | "20% do petróleo mundial passa por uma faixa de 33 km" |
| 0:30–1:15 | Cap II | "A guerra reescreveu as rotas marítimas" |
| 1:15–2:00 | **Cap II½** | **"O Irão acaba de quebrar a UNCLOS — e a Indonésia tentou copiar"** |
| 2:00–2:45 | Cap III | "89% vai para a Ásia, mas o preço fixa-se em todo o mundo" |
| 2:45–4:00 | Cap IV | "Em PT: gasóleo de €1,60 → €2,13. Brent +60%. Energia +12% YoY" |
| 4:00–4:30 | Cap V | Calculadora ao vivo: "Quanto custa a ti?" |
| 4:30–5:00 | Fecho | Pergunta para a audiência + agradecimento |

## 🌐 Hospedagem (entrega)

GitHub Pages é gratuito e rapidíssimo:

```bash
git add . && git commit -m "Final"
git push origin main
# Settings → Pages → branch: main, folder: /
```

Depois é só partilhar o URL `https://luismpso.github.io/SVDC3/`.

## 📚 Fontes dos dados

| Dataset | Fonte primária | Fallback | Atualização |
|---------|----------------|----------|-------------|
| Brent diário | Yahoo Finance (`BZ=F`) | FRED (DCOILBRENTEU) | Diária |
| Combustíveis PT | DGEG — API PMD | ENSE — Preços de referência | Diária |
| Inflação | Eurostat HICP (PT) | BPstat / Banco de Portugal | Mensal |
| Portagens (II½) | Notícias Mar–Abr 2026 + tratados (Suez Canal Authority, Panama Canal Authority, Convenção de Montreux) | — | Snapshot |
| Chokepoints | EIA — U.S. Energy Information Administration | — | Anual |
| Mapa-mundo | Natural Earth via world-atlas TopoJSON | — | — |

## 🏗️ Tecnologia

- **D3.js v7** — visualizações
- **TopoJSON Client** — mapa-mundo
- **d3-sankey** — Secção III
- **Vanilla JS** — sem build, sem npm, basta servir os ficheiros
- **CSS3** — variáveis CSS, grid, transitions, `prefers-reduced-motion`
- **GitHub Actions** — pipeline diária dos dados
- **Python (pandas, requests, beautifulsoup4, lxml, yfinance)** — scripts de ETL
- **Google Fonts** — Fraunces (display), Newsreader (corpo), JetBrains Mono (dados)
