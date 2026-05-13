# 🛢️ O Preço da Guerra

> **SVDC — Sistemas de Visualização de Dados e Conhecimento** · 2025/26 | Universidade do Minho · Mestrado em Inteligência Artificial | Avaliação Final (grupo) · 28 de Maio de 2026
>
> **Autores:** Luis Miguel Pereira Silva · `pg60390@alunos.uminho.pt` &nbsp;·&nbsp; Guilherme Lobo Pinto · `pg60225@alunos.uminho.pt`

*Data story* interactiva em **D3.js v7** que segue o petróleo desde o Estreito de Ormuz até à bomba de gasolina em Portugal, no contexto da guerra Irão–EUA/Israel iniciada a 28 de Fevereiro de 2026.

🌐 **Online em** `https://luismpso.github.io/SVDC3/`

---

## 1. Mensagem da visualização

> **A guerra do Irão começa a 28 de Fevereiro de 2026 e em 6 semanas reescreve as rotas marítimas do petróleo, abre um precedente legal sem precedentes (a primeira portagem cobrada num estreito natural), e chega ao consumidor português como uma subida de 27% no preço dos combustíveis.**

A história tem três níveis temporais e uma escala geográfica que se afunila do global para o pessoal — e a peça percorre-os por esta ordem deliberada.

| Indicador | Pré-guerra (1H 2025) | Pico do conflito (Abr 2026) | Δ |
|---|---:|---:|---:|
| Fluxo no **Estreito de Ormuz** (mb/d) | 20,9 | ~4,0 *(estimativa)* | **−81 %** |
| Fluxo pelo **Cabo da Boa Esperança** (mb/d) | 9,1 | ~13,5 *(estimativa)* | +48 % |
| **Produção parada (shut-in)** no Médio Oriente (mb/d) | 0 | 9,1 *(STEO)* | — |
| **Brent** ($/barril) | 81 | 128 (pico 2 Abr) | +58 % |
| **Gasóleo simples** em Portugal (€/L) | 1,60 | 2,03 | +27 % |
| Portagem cobrada por navio em Ormuz | $0 | **$1,5 M** *(imposta unilateralmente)* | precedente histórico |

A assimetria entre a queda de Ormuz (−17 mb/d) e a subida do Cabo (+4,5 mb/d) **é o ponto editorial central**: o petróleo asiático não tem rota alternativa razoável pelo Cabo (é a volta longa a África para chegar ao mesmo destino), por isso a produção é simplesmente **cortada na boca do poço**. Quase metade do petróleo que devia estar a fluir desapareceu do mercado.

---

## 2. Pré-processamento de dados

A peça é alimentada por **5 fontes oficiais distintas** (mais snapshots editoriais para os capítulos jurídicos) que partilham um fio condutor temático: o impacto cascateado da guerra desde o chokepoint até ao consumidor português.

### 2.1 Visão geral das fontes

| Dataset | Fonte primária | Fallback | Atualização | Script |
|---------|----------------|----------|-------------|--------|
| **Chokepoints — fluxos** | [EIA](https://www.eia.gov/international/analysis/special-topics/World_Oil_Transit_Chokepoints) (HTML scraping da página oficial) | Wayback Machine — snapshots anuais desde 2017 | Anual | `api/fluxos.py` |
| **Hormuz — destinos** | EIA — parsing do texto do mesmo relatório (regex sobre %Ásia + %Top4) | Tabela base editorial caso o regex não case | Anual | `api/fluxos.py` |
| **Brent (diário)** | [FRED (DCOILBRENTEU)](https://fred.stlouisfed.org/series/DCOILBRENTEU) — Federal Reserve | [Yahoo Finance `BZ=F`](https://finance.yahoo.com/quote/BZ%3DF) — últimos dias antes da FRED publicar | Diário | `api/brent.py` |
| **Combustíveis PT** | [DGEG — API PMD](https://precoscombustiveis.dgeg.gov.pt/) (GET → POST fallback) | — | Diário | `api/combustiveis.py` |
| **Inflação COICOP** | [Eurostat HICP `prc_hicp_manr`](https://ec.europa.eu/eurostat) — classes CP00/CP01/NRG/CP07 | [BPstat](https://bpstat.bportugal.pt/) (Banco de Portugal) para meses que o Eurostat ainda não publicou | Mensal | `api/inflacao.py` |
| **Portagens nos chokepoints** | Bloomberg, Iran International, AA News, *The Diplomat*, Lowy Institute, Suez Canal Authority, Panama Canal Authority, Convenção de Montreux | — | Snapshot editorial (Mar–Abr 2026) | inline no JS |
| **Estimativas (wartime + shut-in)** | EIA *Short-Term Energy Outlook* — Abril 2026 (PR 7/4/2026) | — | Editorial — atualizar quando STEO publicar novos números | `data/processed/wartime.csv`, `shutin.csv` |
| **Mapa-mundo** | [Natural Earth via world-atlas TopoJSON](https://github.com/topojson/world-atlas) | — | — | — |

### 2.2 Pipeline EIA com Wayback Machine (estrela do projecto)

A página do EIA dos *World Oil Transit Chokepoints* só publica os dados **mais recentes** — não há um arquivo histórico estruturado. Para conseguir uma série temporal 2017→2025, o script `api/fluxos.py` faz uma extração em **duas fases**:

1. **Fase live** — `requests` + `pandas.read_html` à página atual; identifica a tabela certa procurando pela linha "Strait of Hormuz" no `iloc[:, 0]` (a estrutura HTML do EIA muda subtilmente ao longo dos anos).
2. **Fase histórica** — usa a [Wayback Machine CDX API](https://web.archive.org/cdx/search/cdx) com `collapse=timestamp:4` para obter **um snapshot por ano civil** desde 2017. Para cada snapshot, faz fetch via `web.archive.org/web/{ts}id_/{url}` (o sufixo `id_` evita o banner injetado da Wayback). Pausa de 3 segundos entre fetches para ser educado com o `archive.org`.

**Normalizações aplicadas** (helpers `_normalize_chokepoints` e `_strip_footnote`):

- Cabeçalhos temporais `"1H25"` → `"1H2025"` via regex `(\d[HQ])(\d{2})`.
- Nomes de chokepoints com footnotes (ex.: `"Bab el-Mandeb a"`) retornam a forma canónica via trim controlado contra um conjunto `KNOWN_CHOKEPOINTS`.
- Filtragem de linhas-cabeçalho fantasma (`"Location"`, `"million barrels per day"`).
- Pivot wide→long: `melt(id_vars=['chokepoint'], var_name='periodo_original', value_name='value')`.
- Conversão `1H2025` → data 2025-04-01 (ponto médio), `1Q2026` → 2026-02-15, anuais → 1 Jul.
- `drop_duplicates(subset=['chokepoint','periodo_original'], keep='last')` para que dados live sobreponham snapshots Wayback quando ambos têm o mesmo ponto.

**Self-healing:** uma falha por ano não rebenta os outros; se o Wayback falhar inteiramente, ainda há output do live EIA; se ambas as fases falharem, o CSV anterior fica intacto (não é destruído).

### 2.3 Pipeline Brent (FRED + Yahoo Finance)

`api/brent.py` faz fetch desde 2016 nas duas fontes e faz `merge` com `keep='last'` para que a FRED vença em datas em que ambas têm o valor; a Yahoo enche os últimos 1-5 dias antes de a FRED publicar. **3 retries com backoff exponencial** por fonte; se ambas falharem, o CSV não é alterado.

### 2.4 Pipeline DGEG (combustíveis PT)

`api/combustiveis.py` lê o CSV existente, vai à [API PMD da DGEG](https://precoscombustiveis.dgeg.gov.pt/) buscar os últimos 15 dias (overlap deliberado para apanhar revisões retroativas), e faz merge incremental por data mantendo o valor mais recente. Tenta `GET`; se a API responder 405, faz fallback para `POST`. A DGEG publica `"1,1900 €"` como string com vírgula — o parser converte para float em €/L.

### 2.5 Pipeline inflação COICOP (Eurostat HICP + BPstat)

`api/inflacao.py` combina duas fontes mês a mês com `pandas.combine_first`:

- **Eurostat HICP** (`prc_hicp_manr`, Portugal) é a fonte canónica para as 4 classes COICOP: Total (CP00), Alimentação (CP01), Energia (NRG), Transportes (CP07).
- **BPstat** (séries `5721524`, `5721525`, `5721531`) preenche os meses que o Eurostat ainda não publicou (Total, Alimentação, Transportes). A classe Energia não tem fallback estável no BPstat — fica `NaN` em vez de inventar.

Cada (mês, classe) vence pela primeira fonte que o publica; Eurostat sobrepõe-se mais tarde quando publica. **Sem dados inventados.**

### 2.6 Estimativas STEO e shut-in (metodologia)

Os dados reais do EIA terminam em 1H 2025 (publicação de 3 Mar 2026). A peça precisa de mostrar o **impacto da guerra (Mar–Abr 2026)** que ainda não está medido. Para tal, foram criados dois ficheiros editoriais ancorados em fonte oficial:

**`data/processed/wartime.csv`** — estimativas de fluxo para Ormuz e Cabo da Boa Esperança:

- Granularidade **mensal** (mais informativa que trimestral durante uma disrupção aguda).
- Âncora em **28 Fev 2026** com valor de baseline → a linha tracejada **só cai depois da linha vertical da guerra**, não antes.
- Ormuz Abr 2026 = 4,0 mb/d (intervalo 2,0–6,0): ancorado nos 9,1 mb/d de shut-in do STEO + capacidade conhecida dos pipelines alternativos (Saudi East-West ~5 mb/d, UAE Habshan ~1,5 mb/d, Iraque-Turquia ~0,5 mb/d).
- Cabo Abr 2026 = 13,5 mb/d (intervalo 12,0–15,0): subida modesta porque o Cabo **não é** a rota natural para os destinos asiáticos de Ormuz.
- A série **termina deliberadamente em Abril** — projeções de recuperação seriam especulação dado que o conflito continua em curso à data de publicação.

**`data/processed/shutin.csv`** — produção parada na boca do poço:

- Mar 2026: 7,5 mb/d; Abr 2026: 9,1 mb/d (números directos do STEO Abr 2026 do EIA).
- Renderizado como área *hatched* (linhas diagonais rust) para **semântica visual de "produção fantasma, não fluxo real"**.

### 2.7 Pipeline DataOps (GitHub Actions)

Em vez de o navegador fazer scraping em tempo real (que esbarra em CORS), o repositório tem **um workflow diário** em `.github/workflows/update.yml` que corre os scripts Python em `api/`, atualiza os CSVs em `data/processed/`, e faz commit para `main`. A página limita-se a ler esses CSVs com `d3.csv()` — rápido, fiável e sem chaves de API.

Uma **barra fixa no topo** da página indica o estado de cada série via emojis (🟢 atualizado pelo último Action, ⚪ em falha — usa o último CSV bom). O componente `LiveStatus` em `js/main.js` faz o tracking.

### 2.8 Datasets finais consumidos pelo site

| Ficheiro | Linhas (aprox.) | Usado em | Descrição |
|---|---:|---|---|
| `data/processed/chokepoints.csv` | ~100 | Mapa (Cap. I) + Linhas (Cap. II) | Long: `date, periodo_original, chokepoint, value` — 8 chokepoints × 14 anos |
| `data/processed/hormuz.csv` | 8 | Sankey (Cap. III) | Wide: destino, região, % share, nota — snapshot atual |
| `data/processed/wartime.csv` | 8 | Cap. II (estimativa) | Long com `value`, `value_low`, `value_high`, `nota` — Ormuz + Cabo, Out 2025→Abr 2026 |
| `data/processed/shutin.csv` | 3 | Cap. II (área hatched) | Mensal — produção parada por STEO |
| `data/processed/brent.csv` | ~2 500 | Cap. IV (preços) | Diário desde 2016 |
| `data/processed/combustiveis.csv` | ~250 | Cap. IV (preços) + Cap. V (calculadora) | Semanal, gasolina 95 + gasóleo simples |
| `data/processed/inflacao.csv` | ~360 | Cap. IV (small multiples) | Mensal por classe COICOP |

---

## 3. Descrição da visualização

A peça ocupa **uma página única em scroll**, com hero manchete (4 contadores animados que lêem os CSVs ao vivo) e **6 capítulos** sequenciados deliberadamente do espacial (mapa) para o pessoal (calculadora interativa). Cada capítulo combina um ou mais charts D3 com texto editorial em prosa, à maneira de uma reportagem jornalística.

### Capítulo I — *O ponto que sustenta o mundo*

**Mapa-múndo Natural Earth** (TopoJSON via `world-atlas@2`) em projeção `geoNaturalEarth1` com chokepoints como **círculos dimensionados pelo valor real** (raio proporcional a `√mb/d`), Estreito de Ormuz destacado em laranja quente, países do Golfo Pérsico realçados, Irão em destaque cromático próprio. Sobreposta uma **rede de 21 rotas marítimas** estilo EIA com curvas de Bézier — cada chokepoint funciona como hub. Valores dentro dos círculos lidos directamente do CSV (não hardcoded), pelo que **a atualização do CSV atualiza o mapa**.

### Capítulo II — *A guerra reescreve as rotas*

**Multi-line chart 2011–2025** com 8 séries em **hierarquia visual de 3 níveis** (primárias 3px sólidas, secundárias 2px, terciárias 1.2px esbatidas), eixos temporais reais. Duas anotações verticais marcam **Ataques Houthi (Nov 2023)** e **Guerra Irão (28 Fev 2026)**.

A partir de 28 Fev 2026 surge a **camada editorial sobreposta** com 3 elementos visuais distintos:

1. **Linhas tracejadas** (`stroke-dasharray: 6 5`) para Ormuz e Cabo — estimativas baseadas no STEO.
2. **Faixas de incerteza** (`d3.area` com `value_low`/`value_high`) à volta de cada linha estimada.
3. **Área hatched** (padrão `<pattern>` SVG com linhas diagonais rust) anchored em y=0 — representa a **produção parada (shut-in)**.

Cada elemento visual significa uma coisa diferente: tracejado = fluxo estimado, faixa = incerteza, hatched = produção fantasma. O leitor aprende esta linguagem visual numa nota inline (`/// hatched = produção parada`) e através da legenda.

### Capítulo II½ — *A nova guerra das portagens*

**Bar chart horizontal** com 5 chokepoints **agrupados em dois blocos**:

- **Estreitos naturais** (UNCLOS Art. 26 → passagem livre): Ormuz $1,5M *(imposto, contestado)*, Malaca *(proposta recusada)*, Estreitos Turcos $100k *(única excepção legal via Montreux 1936)*.
- **Canais construídos** (soberania nacional): Suez $700k, Panamá $500k.

Malaca tem **ghost bar tracejada** no valor proposto (~$1M) com **diagonal strike-through animada** a entrar — comunica visualmente "tentaram, foi parado". Cor por status: rust=imposto contestado, teal=base jurídica clara, cinza=recusado. Tooltip rico com base legal + fonte. Capítulo importante por ser o único onde **a história tem implicações de direito internacional**, não só de preço.

### Capítulo III — *Para onde vai esse petróleo*

**Sankey** (d3-sankey) Ormuz → Região → País, com fluxos em mb/d a partir da quota %. Mostra que **89% do petróleo de Ormuz vai para a Ásia** e **74% para o Top 4** (China, Índia, Japão, Coreia do Sul). Coloração por região. Justifica narrativamente o capítulo anterior — é por causa desta dependência asiática que Ormuz é tão crítico.

### Capítulo IV — *O custo no bolso*

Dois charts em sequência:

- **Brent + combustíveis PT** num gráfico com **dois eixos Y** (USD/barril à esquerda, €/L à direita), série diária desde 2016, com **anotações verticais** dos eventos-chave (invasão Ucrânia 2022, ataques Houthi 2023, guerra Irão 2026). *Hover bisector* mostra leitura cruzada entre os 3 valores.
- **Inflação COICOP** em **small multiples** — 4 painéis (Total, Transportes destacado, Energia, Alimentação) com escala temporal real partilhada e zona de pico de 2022 sombreada. Mostra que Transportes voltou ao positivo em Mar 2026 depois de meses de deflação.

### Capítulo V — *Quanto custa a ti?*

**Calculadora interativa** com 3 sliders (km/mês, consumo L/100km, tipo de combustível) que **lê preços ao vivo do CSV** (com fallback editorial se a leitura falhar) e mostra impacto mensal e anual da subida desde 1 Jan 2026 até hoje. Encerra a peça com a transição de macro para pessoal — depois de o leitor ter passado por chokepoints, regimes jurídicos, Sankey e séries macro, aterra no seu próprio depósito.

### 3.1 Decisões de design

- **Paleta limitada e consistente** (amber=Ormuz, ink=Cabo/branco, rust=disrupção/Bab el-Mandeb, teal=Suez/legitimidade jurídica). Lê-se 6 capítulos sem reaprender o código de cores.
- **Hierarquia narrativa de 3 níveis** nas séries — primárias (3 px, opacidade 1), secundárias (2 px, 0.95), terciárias (1.2 px, 0.72). Estreito de Malaca tem o maior volume absoluto mas é terciária *porque não é relevante para a história* da guerra do Irão.
- **Três convenções visuais distintas para a estimativa**: tracejado (linha estimada), faixa transparente (intervalo de incerteza), hatched diagonal (produção parada). Cada padrão semântico mapeia a um conceito específico — o leitor "lê" os três sem precisar de legenda longa.
- **Estimativa termina em Abril e não tenta recuperar** — decisão editorial deliberada. Projetar recuperação seria especulação.
- **Etiqueta da série ancora-se no último ponto** (real ou estimado) com colisão evitada por algoritmo de empurrão vertical + linha-guia subtil.
- **Bridge point invisível** liga visualmente o último ponto real ao primeiro estimado (banda com largura zero a expandir → "fan-out").
- **Ghost bar com strike-through animado** para a proposta indonésia em Malaca — comunica "tentado, parado" sem precisar de legenda.
- **Tipografia tripartida**: *Fraunces* (display, manchetes), *Newsreader* (corpo, prosa editorial), *JetBrains Mono* (números, eixos, valores). Hierarquia clara e tom jornalístico.
- **Lazy-load via `IntersectionObserver`** — charts só renderizam quando entram em viewport (animação dispara aí).
- **Responsivo via `viewBox` + `preserveAspectRatio`**, re-render selectivo em resize (debounce 200 ms).
- **Acessibilidade**: cada `div.viz` tem `aria-label` descritivo; `prefers-reduced-motion` desactiva animações longas; cores escolhidas para contraste WCAG AA em fundo escuro.
- **Live status bar** (🟢/⚪ por fonte) no topo — exposição honesta do estado dos dados ao leitor.
- **Hero counters** lêem dos CSVs (não hardcoded) e animam de 0 ao valor com `easeQuadOut` ao entrar no viewport.

---

## 4. Como executar

```bash
# D3 precisa de servidor HTTP (CORS bloqueia file://)
python3 -m http.server 8000
# abrir http://localhost:8000

# alternativa: npx serve .
# ou: VS Code + extensão "Live Server"
```

Para regenerar os CSVs a partir das fontes (raramente necessário, o GitHub Action fá-lo diariamente):

```bash
pip install -r requirements.txt
python api/fluxos.py        # EIA + Wayback → chokepoints.csv + hormuz.csv
python api/brent.py         # FRED + Yahoo → brent.csv
python api/combustiveis.py  # DGEG → combustiveis.csv
python api/inflacao.py      # Eurostat + BPstat → inflacao.csv
```

Para bootstrap inicial a partir de exports manuais (`utils/dgeg.py` e `utils/fred.py` em `data/raw/`) — só na primeira vez, depois o pipeline `api/` mantém os ficheiros vivos.

---

## 5. Estrutura do projeto

```
SVDC3/
├── index.html                          # Página única (5+1 capítulos narrativos)
├── README.md
├── requirements.txt                    # Dependências Python do pipeline
├── .github/workflows/update.yml        # GitHub Action — pipeline diário (08:00 UTC)
├── css/
│   └── styles.css                      # Tema editorial dark, variáveis CSS, responsivo
├── js/
│   ├── api.js                          # Leitura de CSVs (D3) com fallback
│   └── main.js                         # Visualizações D3 + calculadora + LiveStatus
├── api/                                # Scripts Python da pipeline (CI)
│   ├── brent.py                        # FRED + Yahoo Finance, merge keep=last
│   ├── combustiveis.py                 # DGEG, GET→POST fallback, incremental
│   ├── inflacao.py                     # Eurostat HICP + BPstat combine_first
│   └── fluxos.py                       # EIA live + Wayback + parsing destinos Ormuz
├── utils/                              # Bootstrap a partir de exports manuais
│   ├── dgeg.py
│   └── fred.py
└── data/
    ├── raw/                            # Snapshots originais (bootstrap)
    │   ├── dgeg.csv
    │   └── FRED.csv
    └── processed/                      # CSVs consumidos pelo site
        ├── chokepoints.csv             ← api/fluxos.py
        ├── hormuz.csv                  ← api/fluxos.py
        ├── wartime.csv                 ← editorial (STEO Abr 2026)
        ├── shutin.csv                  ← editorial (STEO Abr 2026)
        ├── brent.csv                   ← api/brent.py
        ├── combustiveis.csv            ← api/combustiveis.py
        └── inflacao.csv                ← api/inflacao.py
```

**Pipeline:** `api/*.py` (diário via GH Actions) → `data/processed/*.csv` → `js/api.js` → `js/main.js` → DOM

---

## 6. Tecnologia

- **D3.js v7** — visualizações (carregado via CDN)
- **TopoJSON Client v3** — geometria do mundo no browser
- **d3-sankey** — Capítulo III
- **Vanilla JS, sem build, sem npm** — abre directamente no browser servido por HTTP
- **CSS3** — variáveis, grid, transitions, `prefers-reduced-motion`, fontes via Google Fonts (*Fraunces*, *Newsreader*, *JetBrains Mono*)
- **IntersectionObserver** — lazy-load + animação no scroll
- **GitHub Actions** — pipeline diária dos dados (commit automático às 08:00 UTC)
- **Python 3** com `pandas`, `requests`, `beautifulsoup4`, `lxml`, `html5lib`, `openpyxl`, `yfinance`, `urllib3` — scripts ETL (`requirements.txt`)

---

## 7. Resultados

![Página completa de "O Preço da Guerra" — do hero até à calculadora pessoal](docs/screenshot-fullpage.png)

Vista global da peça em scroll único. Os screenshots por capítulo estão em `docs/` (`screenshot-hero`, `-mapa`, `-fluxos`, `-portagens`, `-sankey`, `-precos`, `-inflacao`, `-calculadora`) para consulta detalhada.

---

## 8. Plano da apresentação (5 minutos)

| Tempo | Capítulo | Mensagem-chave |
|-------|----------|----------------|
| 0:00–0:30 | Hero + Cap. I | "20 % do petróleo mundial passa por uma faixa com a largura de Braga–Guimarães" |
| 0:30–1:30 | Cap. II | "A guerra reescreve as rotas — e quase metade do petróleo simplesmente desaparece" *(destacar tracejado + shut-in)* |
| 1:30–2:15 | Cap. II½ | "Primeira portagem da história num estreito natural — e a Indonésia já tentou copiar" |
| 2:15–2:45 | Cap. III | "89 % vai para a Ásia, mas o preço fixa-se em todo o mundo" |
| 2:45–4:00 | Cap. IV | "Em Portugal: Brent +58 %, gasóleo €1,60 → €2,03, transportes voltam ao positivo na inflação" |
| 4:00–4:30 | Cap. V | Calculadora ao vivo — "Quanto custa a ti?" |
| 4:30–5:00 | Fecho + Q&A | Pergunta para a audiência + agradecimento |

---

## 9. Licença e créditos

Trabalho académico em grupo no âmbito do Mestrado em Inteligência Artificial da Universidade do Minho. Dados sob as licenças das respectivas fontes:

- **EIA — World Oil Transit Chokepoints** · domínio público (publicação do governo dos EUA)
- **EIA — Short-Term Energy Outlook (Abr 2026)** · domínio público
- **FRED — DCOILBRENTEU** · St. Louis Fed, uso académico permitido
- **Yahoo Finance — `BZ=F`** · uso pessoal/académico
- **DGEG — Preços médios diários** · dados oficiais portugueses, abertos
- **Eurostat — HICP** · CC BY 4.0 com atribuição à Comissão Europeia
- **BPstat — Banco de Portugal** · acesso aberto para fins não comerciais
- **Internet Archive — Wayback Machine** · uso académico permitido
- **Natural Earth via world-atlas** · domínio público
- **Bloomberg, Iran International, AA News, The Diplomat, Lowy Institute** · citações editoriais sob *fair use*
- **Suez Canal Authority, Panama Canal Authority, Convenção de Montreux (1936)** · documentos oficiais públicos

As estimativas de fluxo (`wartime.csv`) e produção parada (`shutin.csv`) são **interpretações editoriais ancoradas no STEO de Abril 2026 do EIA**, claramente sinalizadas como tal no gráfico (linhas tracejadas, faixas de incerteza, padrão hatched) e na legenda. O leitor pode reproduzir as escolhas a partir das notas em cada linha do CSV.
