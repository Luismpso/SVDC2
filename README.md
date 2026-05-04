# O Preço da Guerra

Visualização de dados sobre o impacto económico da guerra Irão–EUA (Fev 2026)
em Portugal — do Estreito de Ormuz à bomba de gasolina.

**Autor:** Luis Miguel Pereira Silva (PG60390) ·
Mestrado em Inteligência Artificial · Universidade do Minho ·
Sistemas de Visualização de Dados e Conhecimento · Maio 2026

## 🚀 Como correr

D3.js precisa de um servidor HTTP (não funciona com `file://`). Opções:

**Opção A — Python (mais simples)**
```bash
cd projeto
python3 -m http.server 8000
# abrir http://localhost:8000
```

**Opção B — Node**
```bash
npx serve projeto
```

**Opção C — VS Code + Live Server**
Instalar a extensão *Live Server* e clicar em "Go Live" no `index.html`.

## 🟢 Dados ao vivo (APIs)

A página tenta sempre carregar dados em tempo real. Há uma barra fixa no topo
que indica o estado de cada fonte:

| Símbolo | Significado |
|---------|-------------|
| 🟢 | Carregado da API ao vivo |
| ⚪ | A usar CSV local (API falhou ou está sem chave) |

### APIs usadas

1. **Brent crude (FRED)** — não precisa de chave. Vai sempre via proxy CORS
   porque o FRED não suporta CORS diretamente.
2. **Brent confirmação (EIA v2)** — precisa de chave grátis em
   https://www.eia.gov/opendata/register.php (registo de 1 minuto).
3. **Inflação (INE Portugal)** — não precisa de chave. Pode ir direto ou
   via proxy dependendo do dia.
4. **Combustíveis (DGEG)** — sem API pública. Continua a usar o CSV
   atualizado manualmente.

### Configurar a chave EIA

Abrir `js/api.js`, linha ~22:

```js
EIA_API_KEY: 'COLOCA_AQUI_A_TUA_CHAVE_EIA',
```

Substituir pela tua chave. Ficheiro está no `.gitignore`? **Não** — está no
código público. Para uso académico tudo bem; se quiseres ser rigoroso, mete
a chave no `.gitignore` ou usa um backend.

### O que fazer se a API falhar na apresentação

Nada. Os CSVs locais ficam como fallback automático. A página continua a
mostrar tudo, só fica ⚪ em vez de 🟢. **Nunca rebenta.**

## 📂 Estrutura

```
SVDC3/
├── index.html              # Estrutura da página (5 secções narrativas)
├── README.md
├── css/
│   └── styles.css          # Tema editorial dark
├── js/
│   ├── api.js              # Camada de dados ao vivo (FRED + EIA + INE)
│   └── main.js             # Visualizações D3 + calculadora
├── notebooks/              # ★ Preparação de dados (Jupyter)
│   ├── prep_brent.ipynb
│   ├── prep_combustiveis.ipynb
│   ├── prep_inflacao.ipynb
│   ├── prep_chokepoints.ipynb
│   ├── prep_turismo.ipynb
│   └── README.md
└── data/
    ├── raw/                # ★ Originais das fontes (não editar)
    │   ├── DCOILBRENTEU.csv               (FRED)
    │   ├── DCOILWTICO.csv                 (FRED)
    │   ├── dgeg-pcr-2004-2026_18_pt.xlsx  (DGEG)
    │   ├── pordata_taxa_inflacao.xlsx     (PORDATA)
    │   ├── wob_full.csv                   (EU Weekly Oil Bulletin)
    │   ├── serie_dormidas_NUTS2024.zip    (Turismo de Portugal)
    │   ├── serie_dormidas_NUTS2013.zip    (Turismo de Portugal)
    │   ├── 50m_cultural.zip               (Natural Earth)
    │   └── README.md
    └── processed/          # ★ CSVs limpos consumidos pelo site
        ├── brent_daily.csv                ← prep_brent.ipynb
        ├── precos_combustiveis_pt.csv     ← prep_combustiveis.ipynb
        ├── inflacao_pordata.csv           ← prep_inflacao.ipynb
        ├── dormidas_regiao.csv            ← prep_turismo.ipynb
        ├── chokepoints_overview.csv       ← prep_chokepoints.ipynb
        ├── hormuz_flows.csv               ← prep_chokepoints.ipynb
        ├── suez_babmandeb_flows.csv       ← prep_chokepoints.ipynb
        ├── cape_good_hope_flows.csv       ← prep_chokepoints.ipynb
        ├── hormuz_destinations.csv        ← prep_chokepoints.ipynb
        └── README.md
```

**Pipeline de dados:** `data/raw/` → `notebooks/prep_*.ipynb` → `data/processed/` → site

## ✅ O que está feito

- [x] Estrutura completa das 5 secções (HTML + CSS editorial)
- [x] **Secção I** — Mapa-mundo com chokepoints + Estreito de Ormuz destacado
- [x] **Secção II** — Gráfico de fluxos por rota (4 séries, 2020–2025)
- [x] **Secção III** — Sankey de destinos (Ormuz → Região → País), com regiões coloridas
- [x] **Secção IV** — Brent + combustíveis PT com a guerra marcada (gráfico principal)
- [x] **Secção IV** — Small multiples de inflação por classe COICOP, "Transportes" realçado
- [x] **Secção V** — Calculadora pessoal interativa
- [x] Tooltip partilhado, animações de entrada, responsivo
- [x] **Notebooks Jupyter** documentando a preparação de cada dataset
- [x] Header, rodapé e README com identificação do autor

## 🎤 Para os 5 minutos da apresentação

| Tempo | Secção | Mensagem-chave |
|-------|--------|----------------|
| 0:00–0:30 | Hero + Cap I | "20% do petróleo mundial passa por uma faixa de 33 km" |
| 0:30–1:30 | Cap II | "A guerra reescreveu as rotas marítimas" |
| 1:30–2:30 | Cap III | "89% vai para a Ásia, mas o preço fixa-se em todo o mundo" |
| 2:30–4:00 | Cap IV | "Em PT: gasóleo de €1,60 → €2,13. Brent +60%" |
| 4:00–4:30 | Cap V | Calculadora ao vivo: "Quanto custa a ti?" |
| 4:30–5:00 | Fecho | Pergunta para a audiência + agradecimento |

## 🌐 Hospedagem (entrega)

GitHub Pages é gratuito e rapidíssimo:

```bash
git add . && git commit -m "Final"
git push origin main
# Settings → Pages → branch: main, folder: /
```

Depois é só partilhar o URL `https://<utilizador>.github.io/SVDC3/`.

## 📚 Fontes dos dados

| Dataset | Fonte | Atualização |
|---------|-------|-------------|
| Brent diário | FRED — Federal Reserve Bank of St. Louis | Diária |
| Combustíveis PT | DGEG — Direção-Geral de Energia e Geologia | Semanal |
| Inflação | PORDATA / INE | Mensal |
| Turismo | Turismo de Portugal — TravelBI | Mensal |
| Chokepoints | EIA — U.S. Energy Information Administration | Anual |
| Mapa-mundo | Natural Earth via world-atlas TopoJSON | — |

## 🏗️ Tecnologia

- **D3.js v7** — visualizações
- **TopoJSON Client** — mapa-mundo
- **Vanilla JS** — sem build, sem npm, basta servir os ficheiros
- **CSS3** — variáveis CSS, grid, transitions
- **Google Fonts** — Fraunces (display), Newsreader (corpo), JetBrains Mono (dados)
