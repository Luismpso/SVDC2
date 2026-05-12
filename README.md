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
| **Brent diário** | [FRED (DCOILBRENTEU)](https://fred.stlouisfed.org/series/DCOILBRENTEU) | [Yahoo Finance (`BZ=F`)](https://finance.yahoo.com/quote/BZ%3DF/) — apanha os últimos dias enquanto a FRED não publica | `api/brent.py` |
| **Combustíveis PT** | [DGEG — API PMD](https://precoscombustiveis.dgeg.gov.pt/) (GET, com POST como fallback dentro da própria API) | — | `api/combustiveis.py` |
| **Inflação** | [Eurostat HICP (`prc_hicp_manr`)](https://ec.europa.eu/eurostat/) — classes CP00/CP01/NRG/CP07 | [BPstat](https://bpstat.bportugal.pt/) (séries 5721524/5721525/5721531) para Total, Alimentação e Transportes nos meses que o Eurostat ainda não publicou | `api/inflacao.py` |
| **Chokepoints** | [EIA — World Oil Transit Chokepoints](https://www.eia.gov/international/analysis/special-topics/World_Oil_Transit_Chokepoints) (live) | Wayback Machine — snapshots anuais desde 2017 para o histórico | `api/fluxos.py` |
| **Destinos do Ormuz** | EIA — texto do relatório (parsing % Ásia + % Top 4) | Tabela base editorial caso o regex não case | `api/fluxos.py` |
| **Portagens nos chokepoints** | Notícias e tratados (Mar–Abr 2026) | — | Snapshot editorial — Secção II½ |

### Self-healing

- `api/brent.py` faz fetch desde 2016 nas duas fontes (FRED + Yahoo) e
  faz merge com `keep='last'` — FRED vence em datas que ambos têm, Yahoo
  enche os últimos dias até a FRED publicar. 3 retries com backoff por
  fonte; se ambas falharem, o CSV existente fica intacto.
- `api/combustiveis.py` lê o CSV existente e vai buscar à API DGEG os
  últimos 15 dias (overlap de segurança para apanhar revisões retroativas).
  Faz merge incremental por data, mantendo o valor mais recente. Tenta
  GET, faz fallback para POST se a API responder 405. Se a API falhar, o
  CSV fica intacto.
- `api/inflacao.py` combina Eurostat + BPstat célula a célula via
  `combine_first`. Cada (mês, classe) vence pela primeira fonte que o
  publica, com Eurostat a sobrepor-se quando finalmente o publica.
  Sem dados inventados.
- `api/fluxos.py` faz scrape da página atual da EIA + best-effort do
  Wayback Machine para snapshots anuais. Uma falha por ano não rebenta os
  outros; se o Wayback falhar inteiramente, ainda há saída do live EIA.

### Bootstrap inicial (raramente necessário)

Os scripts em `api/` mantêm os CSVs atualizados em produção. Mas para
arrancar do zero (ou repor o histórico), existem dois utilitários em
`utils/` que partem dos snapshots brutos em `data/raw/`:

| Script | Fonte | Produz |
|--------|-------|--------|
| `utils/dgeg.py` | `data/raw/dgeg.csv` (export manual da DGEG, separado por `;`) | `data/processed/combustiveis.csv` em formato `date,gasolina95_pvp_eur_l,gasoleo_pvp_eur_l` |
| `utils/fred.py` | `data/raw/FRED.csv` (download manual da página da FRED) | `data/processed/brent.csv` em formato `observation_date,DCOILBRENTEU` |

Correm uma vez para arrancar; depois é o `api/*.py` que mantém os
ficheiros vivos.

### O que fazer se o pipeline falhar antes da apresentação

Os CSVs em `data/processed/` ficam guardados no repo. Mesmo que o Action
falhe num dia, a página continua a mostrar tudo com os últimos dados
disponíveis. **Não rebenta.**

## 📂 Estrutura

```
SVDC3/
├── index.html                       # Estrutura da página (5+1 secções narrativas)
├── README.md
├── requirements.txt                 # Dependências Python da pipeline
├── .gitignore
├── .github/workflows/update.yml     # Pipeline diário de dados
├── css/
│   └── styles.css                   # Tema editorial dark
├── js/
│   ├── api.js                       # Camada de leitura dos CSV (D3)
│   └── main.js                      # Visualizações D3 + calculadora
├── api/                             # Scripts Python da pipeline (corridos no CI)
│   ├── brent.py                     # FRED + Yahoo Finance
│   ├── combustiveis.py              # DGEG (incremental, GET→POST fallback)
│   ├── inflacao.py                  # Eurostat HICP + BPstat fallback
│   └── fluxos.py                    # EIA live + Wayback Machine + destinos Ormuz
├── utils/                           # Bootstraps a partir de exports manuais
│   ├── dgeg.py                      # raw/dgeg.csv → processed/combustiveis.csv
│   └── fred.py                      # raw/FRED.csv → processed/brent.csv
└── data/
    ├── raw/                         # Snapshots originais (uma vez, para bootstrap)
    │   ├── dgeg.csv                 # Export manual da DGEG (CSV ;)
    │   └── FRED.csv                 # Download manual da página DCOILBRENTEU
    └── processed/                   # CSVs limpos consumidos pelo site
        ├── brent.csv                ← api/brent.py (ou utils/fred.py no bootstrap)
        ├── combustiveis.csv         ← api/combustiveis.py (ou utils/dgeg.py no bootstrap)
        ├── inflacao.csv             ← api/inflacao.py
        ├── chokepoints.csv          ← api/fluxos.py
        └── hormuz.csv               ← api/fluxos.py
```

**Pipeline:** `api/*.py` (diariamente via GitHub Actions) → `data/processed/*.csv` → `js/api.js` → `js/main.js` → DOM

## ✅ O que está feito

- [x] Estrutura completa das 5+1 secções (HTML + CSS editorial)
- [x] **Secção I** — Mapa-mundo com chokepoints + Estreito de Ormuz destacado + rotas animadas
- [x] **Secção II** — Gráfico de fluxos por rota (8 séries, 2017–2025 via live EIA + Wayback Machine), eixo temporal real, hover-to-highlight
- [x] **Secção II½** — **A nova guerra das portagens** — Hormuz (Mar 2026) + tentativa Malaca (Abr 2026); comparação com Suez, Panamá e Estreitos Turcos
- [x] **Secção III** — Sankey de destinos (Ormuz → Região → País), com regiões coloridas e total em mb/d por nó
- [x] **Secção IV** — Brent + combustíveis PT com a guerra marcada (gráfico principal), dois eixos Y, hover bisector com leitura cruzada
- [x] **Secção IV** — Inflação mensal por classe (Total, Transportes destacado, Energia, Alimentação) em small multiples — escala temporal real, com hover por mês
- [x] **Secção V** — Calculadora pessoal interativa, que lê preços ao vivo do CSV (com fallback) e mostra impacto mensal + anual
- [x] Pipeline DataOps com GitHub Actions (commit diário automático às 08:00 UTC)
- [x] Multi-fonte com fallback em todas as séries; nenhum CSV é destruído se a fonte falhar
- [x] Tooltip partilhado, animações de entrada (linha desenhada, contadores ease-out), responsivo
- [x] Inflação sem dados inventados: Eurostat HICP + BPstat (Banco de Portugal) onde o Eurostat ainda não publicou
- [x] Hero counters auto-atualizados a partir dos CSVs ao vivo (não estão hardcoded)
- [x] Lazy-load de gráficos via `IntersectionObserver` + re-render só do que já foi revelado em resize
- [x] Suporte `prefers-reduced-motion` (acessibilidade)
- [x] `aria-label` descritivo em cada `div.viz`
- [x] Header, rodapé e README com identificação dos autores

## 🎤 Para os 5 minutos da apresentação

| Tempo | Secção | Mensagem-chave |
|-------|--------|----------------|
| 0:00–0:30 | Hero + Cap I | "20% do petróleo mundial passa por uma faixa de 33 km" |
| 0:30–1:15 | Cap II | "A guerra reescreveu as rotas marítimas" |
| 1:15–2:00 | **Cap II½** | **"O Irão acaba de quebrar a UNCLOS — e a Indonésia tentou copiar"** |
| 2:00–2:45 | Cap III | "89% vai para a Ásia, mas o preço fixa-se em todo o mundo" |
| 2:45–4:00 | Cap IV | "Em PT: gasóleo de €1,60 → €2,03. Brent +54%. Transportes voltam ao positivo" |
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
| Brent diário | FRED (DCOILBRENTEU) | Yahoo Finance (`BZ=F`) | Diária |
| Combustíveis PT | DGEG — API PMD | — (GET→POST internamente) | Diária |
| Inflação | Eurostat HICP (PT) | BPstat / Banco de Portugal | Mensal |
| Portagens (II½) | Notícias Mar–Abr 2026 + tratados (Suez Canal Authority, Panama Canal Authority, Convenção de Montreux) | — | Snapshot editorial |
| Chokepoints | EIA — U.S. Energy Information Administration (live) | Wayback Machine (snapshots anuais desde 2017) | Anual |
| Mapa-mundo | Natural Earth via world-atlas TopoJSON | — | — |

## 🏗️ Tecnologia

- **D3.js v7** — visualizações
- **TopoJSON Client** — mapa-mundo
- **d3-sankey** — Secção III
- **Vanilla JS** — sem build, sem npm, basta servir os ficheiros
- **CSS3** — variáveis CSS, grid, transitions, `prefers-reduced-motion`
- **GitHub Actions** — pipeline diária dos dados
- **Python (pandas, requests, beautifulsoup4, lxml, html5lib, openpyxl, yfinance, urllib3)** — scripts de ETL (ver `requirements.txt`)
- **Google Fonts** — Fraunces (display), Newsreader (corpo), JetBrains Mono (dados)
