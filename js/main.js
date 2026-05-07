/* =============================================================================
   O Preço da Guerra — Visualizações em D3.js v7
   =============================================================================
   ESTRUTURA:
     1) Constantes globais (datas-chave, cores, formatos)
    1b) LiveStatus — gestor da barra "ao vivo" no topo
     2) drawMap()           → Secção I: mapa-mundo + chokepoints + arco Ormuz→Cabo
     3) drawFlows()         → Secção II: fluxos por rota ao longo do tempo
     4) drawDestinations()  → Secção III: Sankey (Ormuz→Região→País)
     5) drawPrices()        → Secção IV: Brent + combustíveis PT com guerra
     6) drawInflation()     → Secção IV: small multiples por classe COICOP
     7) initCalculator()    → Secção V: calculadora pessoal interativa
     8) Counters            → animação dos números do hero
     9) ChartReveal         → IntersectionObserver para disparar animações ao scroll
    10) Inicialização (DOMContentLoaded)
   ========================================================================== */


/* ---------- 1. CONSTANTES GLOBAIS ---------- */

// Data do início da guerra Irão–EUA/Israel (28 fev 2026)
// Usada como linha vertical de referência em vários gráficos
const WAR_START = new Date('2026-02-28');

// Ataques Houthi começaram em ~mid-Nov 2023 e escalaram em Dez 2023.
// Fração de ano: 2023 + 11/12 ≈ 2023.917 — usado em drawFlows()
const HOUTHI_X = 2023 + 11/12;

// Trimestre marcador para "1.º semestre 2025" (1H2025) — meio de 1H = ~mar 2025 = 0.25 do ano
const Q1H2025 = 2025.25;

// Paleta — devolvida pelo CSS para manter coerência com o tema
const css = getComputedStyle(document.documentElement);
const COLORS = {
  amber:    css.getPropertyValue('--amber').trim()    || '#e89c3f',
  amberHot: css.getPropertyValue('--amber-hot').trim()|| '#f5b95a',
  rust:     css.getPropertyValue('--rust').trim()     || '#c44536',
  teal:     css.getPropertyValue('--teal').trim()     || '#5a9b9c',
  ink:      css.getPropertyValue('--ink').trim()      || '#f0e6d2',
  inkDim:   css.getPropertyValue('--ink-dim').trim()  || '#7d7368',
};

// Formatadores
const fmtDate  = d3.timeFormat('%d %b %Y');
const fmtMonth = d3.timeFormat('%b %Y');
const fmtEur   = d => '€' + d.toFixed(2).replace('.', ',');
const fmtUsd   = d => '$' + d.toFixed(0);

// Tooltip único e partilhado
const tooltip = d3.select('body').append('div').attr('class', 'tooltip');

const showTooltip = (event, html) => {
  tooltip.html(html)
    .style('left', (event.pageX + 14) + 'px')
    .style('top',  (event.pageY - 10) + 'px')
    .style('opacity', 1);
};
const hideTooltip = () => tooltip.style('opacity', 0);


/* ---------- 1b. GESTOR DA BARRA "AO VIVO" ---------- */

window.LiveStatus = (() => {
  // nome → { source: string, live: boolean }
  const sources = new Map();
  const bar     = document.getElementById('livebar');
  const elSrc   = document.getElementById('livebar-sources');
  const elTime  = document.getElementById('livebar-time');

  function render() {
    if (!elSrc) return;
    const parts = [];
    let anyFallback = false;
    for (const [name, info] of sources) {
      // 🟢 = fonte ao vivo / canónica · ⚪ = fallback CSV local
      const dot = info.live ? '🟢' : '⚪';
      if (!info.live) anyFallback = true;
      parts.push(`${name}: ${dot} ${info.source}`);
    }
    elSrc.textContent = parts.join('  ·  ');
    elTime.textContent = new Date().toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'});
    bar.classList.remove('livebar--loading');
    bar.classList.toggle('livebar--error', anyFallback && sources.size > 0);
  }

  return {
    start() {
      bar.classList.add('livebar--loading');
      elSrc.textContent = 'a contactar fontes ao vivo…';
    },
    // Aceita (name, source) — string ou {data, source, live} — para retro-compatibilidade
    report(name, sourceOrResult, liveFlag) {
      let info;
      if (sourceOrResult && typeof sourceOrResult === 'object' && 'source' in sourceOrResult) {
        info = { source: sourceOrResult.source, live: !!sourceOrResult.live };
      } else {
        // Heurística para chamadas antigas só com string
        const src = String(sourceOrResult || '');
        const live = liveFlag !== undefined
          ? !!liveFlag
          : (src.includes('ao vivo') && !src.toLowerCase().includes('fallback'));
        info = { source: src, live };
      }
      sources.set(name, info);
      render();
    }
  };
})();


/* ---------- 2. MAPA-MUNDO COM CHOKEPOINTS (Secção I) ---------- */

async function drawMap() {
  const container = document.getElementById('map-world');
  const width = container.clientWidth;
  const height = Math.min(width * 0.55, 600);

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Projeção centrada no Médio Oriente, mostrando do Atlântico ao Pacífico
  const projection = d3.geoNaturalEarth1()
    .scale(width / 5.2)
    .translate([width / 2 - width * 0.05, height / 1.85])
    .center([15, 25]);

  const path = d3.geoPath(projection);

  // Fundo (oceano)
  svg.append('rect').attr('class', 'ocean')
    .attr('width', width).attr('height', height);

  // Carrega o mapa-mundo (TopoJSON CDN — leve e fiável)
  const world = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
  const countries = topojson.feature(world, world.objects.countries);

  // Países da região do Golfo Pérsico — vão ser realçados
  const HIGHLIGHT_COUNTRIES = new Set([
    'Iran','Saudi Arabia','United Arab Emirates','Qatar','Bahrain',
    'Kuwait','Oman','Iraq','Yemen'
  ]);

  svg.append('g').selectAll('path')
    .data(countries.features)
    .enter().append('path')
      .attr('class', d => {
        if (d.properties.name === 'Iran') return 'country country--iran';
        if (HIGHLIGHT_COUNTRIES.has(d.properties.name)) return 'country country--highlight';
        return 'country';
      })
      .attr('d', path);

  // Chokepoints — pontos com volume de petróleo (mb/d)
  // Coordenadas aproximadas dos centros geográficos
  const CHOKEPOINTS = [
    { name: 'Estreito de Ormuz',   coords: [56.5, 26.6], value: 20.9, main: true,
      desc: '20% do petróleo mundial'},
    { name: 'Estreito de Malaca',  coords: [101, 2.5],   value: 23.2, main: false,
      desc: 'Indo-Pacífico, ligação Médio Oriente↔Ásia' },
    { name: 'Bab el-Mandeb',       coords: [43.3, 12.6], value: 4.2,  main: false,
      desc: 'Mar Vermelho — colapsou em 2024 com ataques Houthi' },
    { name: 'Suez / SUMED',        coords: [32.5, 30.0], value: 4.9,  main: false,
      desc: 'Canal do Suez + pipeline egípcio' },
    { name: 'Estreitos Turcos',    coords: [29.0, 41.0], value: 3.7,  main: false,
      desc: 'Bósforo + Dardanelos' },
    { name: 'Estreitos Dinamarq.', coords: [12.5, 56.0], value: 4.9,  main: false,
      desc: 'Saída do petróleo russo do Báltico' },
    { name: 'Cabo da Boa Esperança', coords: [18.5, -34.5], value: 9.1, main: false,
      desc: 'Rota alternativa quando os chokepoints fecham' },
    { name: 'Canal do Panamá',     coords: [-80, 9],     value: 2.3,  main: false,
      desc: 'Atlântico↔Pacífico' },
  ];

  const r = d3.scaleSqrt().domain([0, 25]).range([0, 28]);

  // Camada 1 — Arco "rota alternativa": Estreito de Ormuz → Cabo da Boa Esperança
  // Aparece em hover sobre Ormuz (storytelling: se Ormuz fechar, é por aqui que se desvia)
  const ormuz = CHOKEPOINTS.find(c => c.main);
  const cabo  = CHOKEPOINTS.find(c => c.name === 'Cabo da Boa Esperança');
  const arcGroup = svg.append('g').attr('class', 'reroute-arc').style('opacity', 0)
    .style('pointer-events', 'none');

  if (ormuz && cabo) {
    const [x1, y1] = projection(ormuz.coords);
    const [x2, y2] = projection(cabo.coords);
    // Curva via África Oriental — control points oeste de Madagáscar
    const cx1 = x1 - 60, cy1 = y1 + 80;
    const cx2 = x2 + 80, cy2 = y2 - 60;
    const arcPath = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;

    arcGroup.append('path')
      .attr('d', arcPath)
      .attr('fill', 'none')
      .attr('stroke', COLORS.amberHot)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', 0.85);

    // Label da rota — meio do arco
    arcGroup.append('text')
      .attr('x', (x1 + x2) / 2 - 30)
      .attr('y', (y1 + y2) / 2 + 30)
      .attr('fill', COLORS.amberHot)
      .style('font-family', 'JetBrains Mono, monospace')
      .style('font-size', '10px')
      .style('paint-order', 'stroke fill')
      .style('stroke', 'var(--bg-deep, #0a0e14)')
      .style('stroke-width', '4px')
      .text('+15 dias por África');
  }

  const cp = svg.append('g').selectAll('g')
    .data(CHOKEPOINTS)
    .enter().append('g')
      .attr('transform', d => `translate(${projection(d.coords)})`);

  // Halo pulsante para o Estreito de Ormuz (chama atenção)
  cp.filter(d => d.main).append('circle')
    .attr('r', d => r(d.value) + 8)
    .attr('fill', 'none')
    .attr('stroke', COLORS.rust)
    .attr('stroke-width', 1)
    .attr('opacity', 0.6)
      .append('animate')
        .attr('attributeName', 'r')
        .attr('values', `${r(20.9) + 6};${r(20.9) + 18};${r(20.9) + 6}`)
        .attr('dur', '2.5s').attr('repeatCount', 'indefinite');

  cp.append('circle')
    .attr('class', d => 'chokepoint' + (d.main ? ' chokepoint--main' : ''))
    .attr('r', d => r(d.value))
    .on('mouseenter', (e, d) => {
      showTooltip(e, `<strong>${d.name}</strong>${d.value} milhões barris/dia<br>${d.desc}`);
      // Se for Ormuz, revelar o arco para o Cabo da Boa Esperança
      if (d.main) arcGroup.transition().duration(400).style('opacity', 1);
    })
    .on('mousemove',  (e, d) => showTooltip(e,
      `<strong>${d.name}</strong>${d.value} milhões barris/dia<br>${d.desc}`))
    .on('mouseleave', (e, d) => {
      hideTooltip();
      if (d.main) arcGroup.transition().duration(400).style('opacity', 0);
    });

  // Etiqueta apenas para o Estreito de Ormuz (os outros aparecem no tooltip)
  cp.filter(d => d.main).append('text')
    .attr('class', 'chokepoint-label')
    .attr('x', d => -r(d.value) - 8)
    .attr('y', 5)
    .attr('text-anchor', 'end')
    .text('Estreito de Ormuz');

  cp.filter(d => d.main).append('text')
    .attr('class', 'chokepoint-value')
    .attr('x', d => -r(d.value) - 8)
    .attr('y', 22)
    .attr('text-anchor', 'end')
    .text('20,9 mb/d');

  // Hint sob o mapa: convidar a passar mouse sobre Ormuz
  svg.append('text')
    .attr('x', 14).attr('y', height - 10)
    .attr('fill', COLORS.inkDim)
    .style('font-family', 'JetBrains Mono, monospace')
    .style('font-size', '10px')
    .style('opacity', 0.7)
    .text('› passa o rato sobre o Estreito de Ormuz');
}


/* ---------- 3. FLUXOS POR ROTA (Secção II) ---------- */

async function drawFlows() {
  const container = document.getElementById('chart-flows');
  const width = container.clientWidth;
  const height = 420;
  const margin = { top: 30, right: 140, bottom: 50, left: 50 };

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Carrega CSV "long-format-friendly" e pivota
  const raw = await d3.csv('data/processed/chokepoints_overview.csv');

  const yearCols = ['2020','2021','2022','2023','2024','1H2025'];
  // 1H2025 representa o 1.º semestre de 2025 → posiciona no meio do semestre (≈ Q1H2025 = 2025.25)
  // (não em 2025.5 = "fim de 2025", como estava antes)
  const yearVals = yearCols.map((_, i) => i === 5 ? Q1H2025 : 2020 + i);

  // Apenas as 4 séries mais relevantes para o storytelling
  const FOCUS = ['Strait of Hormuz','Bab el-Mandeb','Suez Canal and SUMED Pipeline','Cape of Good Hope'];
  const LABELS = {
    'Strait of Hormuz':                'Estreito de Ormuz',
    'Bab el-Mandeb':                   'Bab el-Mandeb',
    'Suez Canal and SUMED Pipeline':   'Suez / SUMED',
    'Cape of Good Hope':               'Cabo da Boa Esperança'
  };
  const SERIES_COLOR = {
    'Strait of Hormuz':                COLORS.amber,
    'Bab el-Mandeb':                   COLORS.rust,
    'Suez Canal and SUMED Pipeline':   COLORS.teal,
    'Cape of Good Hope':               COLORS.ink
  };

  const series = raw
    .filter(r => FOCUS.includes(r.chokepoint))
    .map(r => ({
      name: r.chokepoint,
      values: yearCols.map((c, i) => ({ year: yearVals[i], value: +r[c] }))
    }));

  const x = d3.scaleLinear().domain([2020, Q1H2025 + 0.4]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 25]).nice().range([height - margin.bottom, margin.top]);

  // Eixos — ticks customizados para mostrar "1H25" no lugar de 2025.25
  svg.append('g').attr('class', 'axis axis--x')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x)
      .tickValues([2020, 2021, 2022, 2023, 2024, Q1H2025])
      .tickFormat(d => d === Q1H2025 ? '1H25' : String(Math.floor(d))));

  svg.append('g').attr('class', 'axis axis--y')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)))
    .selectAll('line').attr('stroke-opacity', 0.15);

  svg.append('text')
    .attr('class', 'axis').attr('x', margin.left).attr('y', margin.top - 12)
    .attr('fill', COLORS.inkDim)
    .style('font-family', 'JetBrains Mono, monospace').style('font-size', '11px')
    .text('milhões de barris / dia');

  // Linhas
  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.value))
    .curve(d3.curveMonotoneX);

  const g = svg.append('g');

  series.forEach(s => {
    g.append('path')
      .datum(s.values)
      .attr('fill', 'none')
      .attr('stroke', SERIES_COLOR[s.name])
      .attr('stroke-width', s.name === 'Strait of Hormuz' ? 3 : 2)
      .attr('d', line)
      .attr('opacity', 0)
        .transition().duration(900).delay(300)
        .attr('opacity', 1);

    // Pontos
    g.append('g').selectAll('circle')
      .data(s.values)
      .enter().append('circle')
        .attr('cx', d => x(d.year))
        .attr('cy', d => y(d.value))
        .attr('r', 3)
        .attr('fill', SERIES_COLOR[s.name])
        .on('mouseenter', (e, d) => showTooltip(e,
          `<strong>${LABELS[s.name]}</strong>${d.year === Q1H2025 ? '1.º sem. 2025' : d.year}: ${d.value.toFixed(1)} mb/d`))
        .on('mouseleave', hideTooltip);

    // Etiqueta no fim de cada linha
    const last = s.values[s.values.length - 1];
    g.append('text')
      .attr('x', x(last.year) + 8)
      .attr('y', y(last.value) + 4)
      .attr('fill', SERIES_COLOR[s.name])
      .style('font-family', 'JetBrains Mono, monospace')
      .style('font-size', '11px')
      .text(LABELS[s.name]);
  });

  // Anotação para os ataques Houthi — escalada Nov 2023 (cf. const HOUTHI_X)
  const xHouthi = x(HOUTHI_X);
  svg.append('line')
    .attr('class', 'war-line')
    .attr('x1', xHouthi).attr('x2', xHouthi)
    .attr('y1', margin.top).attr('y2', height - margin.bottom)
    .attr('opacity', 0.5);
  svg.append('text')
    .attr('class', 'war-label')
    .attr('x', xHouthi - 6).attr('y', margin.top + 14)
    .attr('text-anchor', 'end')
    .attr('opacity', 0.7)
    .text('Ataques Houthi (nov 2023)');
}


/* ---------- 4. DESTINOS — SANKEY (Secção III) ---------- */

async function drawDestinations() {
  const container = document.getElementById('chart-destinations');
  const width = container.clientWidth;
  const height = 460;
  const margin = { top: 30, right: 180, bottom: 30, left: 30 };

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Cor por região (com fallback caso d3.sankey não exista)
  if (typeof d3.sankey !== 'function') {
    container.innerHTML = '<p style="color:var(--ink-dim);font-family:var(--font-mono);' +
      'padding:2rem;text-align:center">d3-sankey não carregou. Verifica a tag &lt;script&gt; no index.html.</p>';
    return;
  }

  const REGION_COLOR = {
    'Ásia':     COLORS.amber,
    'Europa':   COLORS.teal,
    'Américas': COLORS.rust,
    'Resto':    COLORS.inkDim
  };

  // Carregar dados
  const raw = await d3.csv('data/processed/hormuz_destinations.csv', d => ({
    destination: d.destination,
    region: d.region,
    share: +d.share_percent,
    note: d.note
  }));

  // Construir grafo: Ormuz → Região → País
  const TOTAL_MBD = 20.9;  // milhões barris/dia (1H 2025)
  const SOURCE = 'Estreito de Ormuz';

  const nodeSet = new Set([SOURCE]);
  raw.forEach(d => { nodeSet.add(d.region); nodeSet.add(d.destination); });
  const nodes = [...nodeSet].map(name => ({ name }));
  const idx = Object.fromEntries(nodes.map((n, i) => [n.name, i]));

  // Agregados por região
  const regionTotals = d3.rollup(raw, v => d3.sum(v, d => d.share), d => d.region);

  const links = [];
  // Source → Region
  regionTotals.forEach((share, region) => {
    links.push({
      source: idx[SOURCE], target: idx[region], value: share, kind: 'source-region'
    });
  });
  // Region → Country
  raw.forEach(d => {
    links.push({
      source: idx[d.region], target: idx[d.destination], value: d.share, kind: 'region-country',
      note: d.note
    });
  });

  const sankey = d3.sankey()
    .nodeWidth(16)
    .nodePadding(14)
    .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

  const graph = sankey({
    nodes: nodes.map(d => Object.assign({}, d)),
    links: links.map(d => Object.assign({}, d))
  });

  // Atribuir cor a cada nó pela região (ou ámbar para a fonte)
  graph.nodes.forEach(n => {
    if (n.name === SOURCE) {
      n.color = COLORS.amberHot;
    } else if (REGION_COLOR[n.name]) {
      n.color = REGION_COLOR[n.name];
    } else {
      // País — herda a cor da região (procura no link source-region)
      const inLink = graph.links.find(l => l.target === n);
      n.color = inLink ? inLink.source.color : COLORS.inkDim;
    }
  });

  // Definir gradientes para os links (suaviza a transição de cor)
  const defs = svg.append('defs');
  graph.links.forEach((link, i) => {
    const grad = defs.append('linearGradient')
      .attr('id', `sankey-grad-${i}`)
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', link.source.x1).attr('x2', link.target.x0);
    grad.append('stop').attr('offset', '0%').attr('stop-color', link.source.color);
    grad.append('stop').attr('offset', '100%').attr('stop-color', link.target.color);
  });

  // Links
  svg.append('g')
    .attr('class', 'sankey-links')
    .attr('fill', 'none')
    .selectAll('path')
    .data(graph.links)
    .enter().append('path')
      .attr('d', d3.sankeyLinkHorizontal())
      .attr('stroke', (d, i) => `url(#sankey-grad-${i})`)
      .attr('stroke-opacity', 0.45)
      .attr('stroke-width', d => Math.max(1, d.width))
      .on('mouseenter', function (e, d) {
        d3.select(this).attr('stroke-opacity', 0.75);
        const mbd = (d.value / 100 * TOTAL_MBD).toFixed(1);
        showTooltip(e,
          `<strong>${d.source.name} → ${d.target.name}</strong>` +
          `${d.value.toFixed(0)}% &middot; ~${mbd} mb/d` +
          (d.note ? `<br><span style="opacity:.7">${d.note}</span>` : ''));
      })
      .on('mousemove', (e) => tooltip
        .style('left', (e.pageX + 14) + 'px').style('top', (e.pageY - 10) + 'px'))
      .on('mouseleave', function () {
        d3.select(this).attr('stroke-opacity', 0.45);
        hideTooltip();
      });

  // Nós
  const nodeG = svg.append('g')
    .attr('class', 'sankey-nodes')
    .selectAll('g')
    .data(graph.nodes)
    .enter().append('g');

  nodeG.append('rect')
    .attr('x', d => d.x0)
    .attr('y', d => d.y0)
    .attr('height', d => Math.max(1, d.y1 - d.y0))
    .attr('width', d => d.x1 - d.x0)
    .attr('fill', d => d.color)
    .attr('opacity', 0.85)
    .attr('stroke', d => d3.color(d.color).darker(0.4))
    .attr('stroke-width', 0.5);

  // Labels: nome + valor (% e mb/d) para todos os nós, com formato consistente
  // Para cada nó: o seu "value" no D3 sankey é a soma dos fluxos de entrada (ou saída para o source).
  // Convertemos % → mb/d com TOTAL_MBD do Estreito.
  const formatNodeValue = (d) => {
    if (d.name === SOURCE) return '20,9 mb/d';
    const pct = d.value || 0;
    const mbd = (pct / 100 * TOTAL_MBD);
    return `${pct.toFixed(0)}% · ${mbd.toFixed(1)} mb/d`;
  };

  const labels = nodeG.append('text')
    .attr('x', d => d.x0 < width / 2 ? d.x1 + 8 : d.x0 - 8)
    .attr('y', d => (d.y1 + d.y0) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
    .attr('fill', COLORS.ink)
    .style('font-family', 'Newsreader, serif')
    .style('font-size', d => d.name === SOURCE ? '13px' : '12px')
    .style('font-weight', d => d.name === SOURCE || REGION_COLOR[d.name] ? 600 : 400);

  // Linha 1: nome do nó
  labels.append('tspan').text(d => d.name);

  // Linha 2: valor (mais pequeno, mais discreto, em monospace)
  labels.append('tspan')
    .attr('x', d => d.x0 < width / 2 ? d.x1 + 8 : d.x0 - 8)
    .attr('dy', '1.25em')
    .attr('fill', COLORS.inkDim)
    .style('font-family', 'JetBrains Mono, monospace')
    .style('font-size', '10px')
    .style('font-weight', 400)
    .text(formatNodeValue);

  // Anotação do storytelling
  svg.append('text')
    .attr('x', margin.left)
    .attr('y', height - 6)
    .attr('fill', COLORS.inkDim)
    .style('font-family', 'JetBrains Mono, monospace')
    .style('font-size', '10px')
    .text('89% vai para a Ásia · mas o preço fixa-se em todo o mundo');
}


/* ---------- 5. BRENT + COMBUSTÍVEIS PT (Secção IV) ---------- */

async function drawPrices() {
  const container = document.getElementById('chart-prices');
  const width = container.clientWidth;
  const height = 480;
  const margin = { top: 50, right: 70, bottom: 50, left: 60 };

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Carregar dados via LiveData (mesma fonte para histórico e atual de cada série)
  const [brentRes, fuelRes] = await Promise.all([
    LiveData.brent(),   // Stooq → FRED → CSV local
    LiveData.fuel()     // maisgasolina → CSV local
  ]);
  const brentRaw = brentRes.data;
  const fuelRaw  = fuelRes.data;

  // Reportar ao status bar quais fontes vieram online (com flag live)
  if (window.LiveStatus) {
    window.LiveStatus.report('Brent', brentRes);
    window.LiveStatus.report('Combustíveis', fuelRes);
  }

  // Filtrar para o período relevante (Set 2025 → mais recente)
  // — assim a "subida" da guerra fica bem destacada
  const minDate = new Date('2025-09-01');
  const brent = brentRaw.filter(d => d.date >= minDate && !isNaN(d.value));
  const fuel  = fuelRaw .filter(d => d.date >= minDate);

  // Domain X dinâmico — usa a data mais recente disponível, com mínimo de 1 mai 2026
  const maxDate = d3.max([
    d3.max(brent, d => d.date),
    d3.max(fuel,  d => d.date),
    new Date('2026-05-01')
  ]);

  const x = d3.scaleTime()
    .domain([minDate, maxDate])
    .range([margin.left, width - margin.right]);

  // Y-axis dinâmico com pad de 8% — robusto a futuras atualizações dos CSVs
  const padBy = (extent, pct = 0.08) => {
    const [lo, hi] = extent;
    const pad = (hi - lo) * pct;
    return [lo - pad, hi + pad];
  };

  // Dois eixos Y (Brent em USD vs combustíveis em €)
  const yBrent = d3.scaleLinear()
    .domain(padBy(d3.extent(brent, d => d.value))).nice()
    .range([height - margin.bottom, margin.top]);

  const fuelExtent = [
    d3.min(fuel, d => Math.min(d.gasoleo, d.gasolina)),
    d3.max(fuel, d => Math.max(d.gasoleo, d.gasolina))
  ];
  const yFuel = d3.scaleLinear()
    .domain(padBy(fuelExtent)).nice()
    .range([height - margin.bottom, margin.top]);

  // Eixo X
  svg.append('g').attr('class', 'axis axis--x')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(d3.timeMonth.every(1)).tickFormat(fmtMonth));

  // Eixo Y esquerdo (Brent USD)
  svg.append('g').attr('class', 'axis axis--y')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(yBrent).ticks(6).tickFormat(d => '$' + d)
            .tickSize(-(width - margin.left - margin.right)))
    .selectAll('line').attr('stroke-opacity', 0.1);

  // Eixo Y direito (combustíveis EUR)
  svg.append('g').attr('class', 'axis axis--y')
    .attr('transform', `translate(${width - margin.right},0)`)
    .call(d3.axisRight(yFuel).ticks(6).tickFormat(d => '€' + d.toFixed(2)));

  // Etiquetas dos eixos Y
  svg.append('text')
    .attr('x', margin.left).attr('y', margin.top - 18)
    .attr('fill', COLORS.amber)
    .style('font-family','JetBrains Mono, monospace').style('font-size','11px')
    .text('BRENT $/barril');

  svg.append('text')
    .attr('x', width - margin.right).attr('y', margin.top - 18)
    .attr('text-anchor', 'end').attr('fill', COLORS.ink)
    .style('font-family','JetBrains Mono, monospace').style('font-size','11px')
    .text('COMBUSTÍVEIS PT €/litro');

  // Linha vertical do início da guerra
  const xWar = x(WAR_START);
  svg.append('line').attr('class', 'war-line')
    .attr('x1', xWar).attr('x2', xWar)
    .attr('y1', margin.top).attr('y2', height - margin.bottom);

  svg.append('text').attr('class', 'war-label')
    .attr('x', xWar + 8).attr('y', margin.top + 16)
    .text('Início da guerra · 28 fev 2026');

  // Linhas das séries
  const lineBrent = d3.line()
    .defined(d => !isNaN(d.value))
    .x(d => x(d.date)).y(d => yBrent(d.value))
    .curve(d3.curveMonotoneX);

  const lineDiesel = d3.line()
    .x(d => x(d.date)).y(d => yFuel(d.gasoleo))
    .curve(d3.curveMonotoneX);

  const lineGas = d3.line()
    .x(d => x(d.date)).y(d => yFuel(d.gasolina))
    .curve(d3.curveMonotoneX);

  const drawLineAnimated = (path, totalDuration = 1500) => {
    const len = path.node().getTotalLength();
    path.attr('stroke-dasharray', `${len} ${len}`)
        .attr('stroke-dashoffset', len)
        .transition().duration(totalDuration).ease(d3.easeQuadOut)
        .attr('stroke-dashoffset', 0);
  };

  drawLineAnimated(svg.append('path')
    .datum(brent).attr('class', 'series-line series-line--brent').attr('d', lineBrent));

  drawLineAnimated(svg.append('path')
    .datum(fuel).attr('class', 'series-line series-line--diesel').attr('d', lineDiesel), 1700);

  drawLineAnimated(svg.append('path')
    .datum(fuel).attr('class', 'series-line series-line--gas').attr('d', lineGas), 1900);

  // Legenda
  const legend = svg.append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${margin.left + 8}, ${margin.top + 8})`);

  const items = [
    { color: COLORS.amber, label: 'Brent crude (USD)' },
    { color: COLORS.ink,   label: 'Gasóleo PT (EUR)' },
    { color: COLORS.teal,  label: 'Gasolina 95 PT (EUR)' },
  ];
  items.forEach((it, i) => {
    const g = legend.append('g').attr('transform', `translate(0, ${i * 18})`);
    g.append('line').attr('x2', 18).attr('stroke', it.color).attr('stroke-width', 2);
    g.append('text').attr('x', 24).attr('y', 4).text(it.label).attr('fill', COLORS.inkDim);
  });

  // Hover bisector — cruzamento dinâmico de valores
  const bisect = d3.bisector(d => d.date).left;
  const focus = svg.append('g').style('opacity', 0);
  focus.append('line').attr('class', 'war-line').attr('y1', margin.top).attr('y2', height - margin.bottom)
    .attr('stroke', COLORS.inkDim).attr('stroke-dasharray', '2 2');

  svg.append('rect')
    .attr('x', margin.left).attr('y', margin.top)
    .attr('width', width - margin.left - margin.right)
    .attr('height', height - margin.top - margin.bottom)
    .attr('fill', 'transparent')
    .on('mousemove', function(event) {
      const mx = d3.pointer(event)[0];
      const date = x.invert(mx);
      const brentI = bisect(brent, date);
      const fuelI = bisect(fuel, date);
      const b = brent[Math.min(brentI, brent.length - 1)];
      const f = fuel[Math.min(fuelI, fuel.length - 1)];
      if (!b || !f) return;

      focus.style('opacity', 1)
        .select('line')
        .attr('x1', mx).attr('x2', mx);

      showTooltip(event, `
        <strong>${fmtDate(b.date)}</strong>
        Brent: ${fmtUsd(b.value)}<br>
        Gasóleo: ${fmtEur(f.gasoleo)}<br>
        Gasolina 95: ${fmtEur(f.gasolina)}
      `);
    })
    .on('mouseleave', () => { focus.style('opacity', 0); hideTooltip(); });
}


/* ---------- 6. INFLAÇÃO — SMALL MULTIPLES (Secção IV) ---------- */

async function drawInflation() {
  const container = document.getElementById('chart-inflation');
  const containerWidth = container.clientWidth;

  // Carregar via LiveData (PORDATA CSV — fonte estável 1960–2025)
  const ineRes = await LiveData.inflation();
  if (window.LiveStatus) window.LiveStatus.report('Inflação', ineRes);

  // Filtrar para 2000+ (storytelling moderno)
  const data = ineRes.data.filter(d => d.ano >= 2000);

  // Pré-compilar Map para lookup O(1) no hover (em vez de Array.find linear)
  const dataByYear = new Map(data.map(d => [d.ano, d]));

  // Classes a mostrar (em ordem narrativa) — exclui "Total exceto..." e "Informação e comunicação"
  // (tem muitos valores em 0/missing nos primeiros anos)
  const CLASSES = [
    'Total',
    'Transportes',                                                 // ← destaque
    'Habitação, água, eletricidade, gás e outros combustíveis',
    'Produtos alimentares e bebidas não alcoólicas',
    'Bebidas alcoólicas e tabaco',
    'Vestuário e calçado',
    'Acessórios para o lar e equipamento doméstico',
    'Saúde',
    'Lazer, recreação, desporto e cultura',
    'Serviços de educação'
  ];

  const SHORT_LABEL = {
    'Total':                                                        'Total IPC',
    'Transportes':                                                  'Transportes',
    'Habitação, água, eletricidade, gás e outros combustíveis':     'Habitação e energia',
    'Produtos alimentares e bebidas não alcoólicas':                'Alimentação',
    'Bebidas alcoólicas e tabaco':                                  'Álcool e tabaco',
    'Vestuário e calçado':                                          'Vestuário',
    'Acessórios para o lar e equipamento doméstico':                'Equipamento doméstico',
    'Saúde':                                                        'Saúde',
    'Lazer, recreação, desporto e cultura':                         'Lazer e cultura',
    'Serviços de educação':                                         'Educação'
  };

  // Layout — 5 colunas × 2 linhas (responsivo: 2 cols em telas pequenas)
  const cols = containerWidth < 700 ? 2 : (containerWidth < 1000 ? 3 : 5);
  const rows = Math.ceil(CLASSES.length / cols);
  const gap = 16;
  const cellW = (containerWidth - (cols - 1) * gap) / cols;
  const cellH = 130;
  const totalH = rows * cellH + (rows - 1) * gap + 30;
  const margin = { top: 30, right: 8, bottom: 22, left: 28 };

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${containerWidth} ${totalH}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Escala global Y comum — para comparabilidade entre painéis
  const allValues = data.flatMap(d => CLASSES.map(c => d[c])).filter(v => v != null && !isNaN(v));
  const yExt = d3.extent(allValues);
  const yPad = 0.15 * (yExt[1] - yExt[0]);

  const xScale = d3.scaleLinear()
    .domain(d3.extent(data, d => d.ano))
    .range([margin.left, cellW - margin.right]);

  const yScale = d3.scaleLinear()
    .domain([Math.min(yExt[0] - yPad, -2), yExt[1] + yPad]).nice()
    .range([cellH - margin.bottom, margin.top]);

  // Eventos relevantes para anotação
  const EVENTS = [
    { year: 2008, label: 'Crise 2008' },
    { year: 2022, label: 'Ucrânia' },
    { year: 2026, label: 'Irão' }
  ];

  // Gerar painel para cada classe
  CLASSES.forEach((cls, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const xOff = col * (cellW + gap);
    const yOff = row * (cellH + gap) + 30;

    const g = svg.append('g')
      .attr('transform', `translate(${xOff}, ${yOff})`)
      .attr('class', cls === 'Transportes' ? 'sm sm--highlight' : 'sm');

    // Fundo subtil para o painel destacado
    if (cls === 'Transportes') {
      g.append('rect')
        .attr('x', 0).attr('y', 0)
        .attr('width', cellW).attr('height', cellH)
        .attr('fill', COLORS.amber)
        .attr('opacity', 0.06)
        .attr('rx', 2);
    }

    // Linha de zero
    g.append('line')
      .attr('x1', margin.left).attr('x2', cellW - margin.right)
      .attr('y1', yScale(0)).attr('y2', yScale(0))
      .attr('stroke', COLORS.inkDim)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-dasharray', '2 3');

    // Linhas verticais para eventos (apenas se dentro do domínio)
    EVENTS.forEach(e => {
      const xe = xScale(e.year);
      g.append('line')
        .attr('x1', xe).attr('x2', xe)
        .attr('y1', margin.top).attr('y2', cellH - margin.bottom)
        .attr('stroke', COLORS.rust)
        .attr('stroke-opacity', cls === 'Transportes' ? 0.45 : 0.18)
        .attr('stroke-width', 1);
    });

    // Linha da série
    const lineGen = d3.line()
      .defined(d => d[cls] != null && !isNaN(d[cls]))
      .x(d => xScale(d.ano))
      .y(d => yScale(d[cls]))
      .curve(d3.curveMonotoneX);

    const isHighlight = cls === 'Transportes';
    const strokeColor = isHighlight ? COLORS.amber : COLORS.ink;

    const path = g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', strokeColor)
      .attr('stroke-width', isHighlight ? 2.2 : 1.4)
      .attr('opacity', isHighlight ? 1 : 0.7)
      .attr('d', lineGen);

    // Animação de entrada
    const len = path.node().getTotalLength();
    path.attr('stroke-dasharray', `${len} ${len}`)
        .attr('stroke-dashoffset', len)
        .transition().duration(900).delay(i * 60).ease(d3.easeQuadOut)
        .attr('stroke-dashoffset', 0);

    // Eixos minimal
    g.append('g')
      .attr('transform', `translate(${margin.left}, 0)`)
      .call(d3.axisLeft(yScale).ticks(3).tickFormat(d => d + '%').tickSize(0))
      .call(s => s.select('.domain').remove())
      .call(s => s.selectAll('text').attr('fill', COLORS.inkDim).style('font-size', '9px'));

    g.append('g')
      .attr('transform', `translate(0, ${cellH - margin.bottom})`)
      .call(d3.axisBottom(xScale).ticks(3).tickFormat(d3.format('d')).tickSize(0))
      .call(s => s.select('.domain').remove())
      .call(s => s.selectAll('text').attr('fill', COLORS.inkDim).style('font-size', '9px'));

    // Título do painel
    g.append('text')
      .attr('x', margin.left)
      .attr('y', 16)
      .attr('fill', isHighlight ? COLORS.amberHot : COLORS.ink)
      .style('font-family', 'Fraunces, serif')
      .style('font-size', '12px')
      .style('font-weight', isHighlight ? 600 : 500)
      .text(SHORT_LABEL[cls]);

    // Hover focus — tracking dot
    const focus = g.append('circle')
      .attr('r', 3.5)
      .attr('fill', strokeColor)
      .style('opacity', 0)
      .style('pointer-events', 'none');

    g.append('rect')
      .attr('x', margin.left).attr('y', margin.top)
      .attr('width', cellW - margin.left - margin.right)
      .attr('height', cellH - margin.top - margin.bottom)
      .attr('fill', 'transparent')
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const ano = Math.round(xScale.invert(mx));
        const row_ = dataByYear.get(ano);   // O(1) — Map em vez de Array.find
        if (!row_ || row_[cls] == null) return;
        focus.attr('cx', xScale(row_.ano)).attr('cy', yScale(row_[cls])).style('opacity', 1);
        showTooltip(event,
          `<strong>${SHORT_LABEL[cls]}</strong>${row_.ano}: ${row_[cls].toFixed(1)}%`);
      })
      .on('mouseleave', () => { focus.style('opacity', 0); hideTooltip(); });
  });

  // Legenda com os 3 eventos
  const legend = svg.append('g')
    .attr('transform', `translate(0, 16)`);
  EVENTS.forEach((e, i) => {
    const lg = legend.append('g').attr('transform', `translate(${i * 110}, 0)`);
    lg.append('line').attr('x2', 14).attr('y1', 5).attr('y2', 5)
      .attr('stroke', COLORS.rust).attr('stroke-width', 1.5);
    lg.append('text').attr('x', 20).attr('y', 9)
      .attr('fill', COLORS.inkDim)
      .style('font-family', 'JetBrains Mono, monospace')
      .style('font-size', '10px')
      .text(`${e.year} · ${e.label}`);
  });
}


/* ---------- 7b. CONTADORES ANIMADOS DO HERO ---------- */

// Anima cada elemento .stat__value de 0 → data-count-to em ~1.4s.
// Suporta data-prefix, data-suffix e data-decimals.
function initHeroCounters() {
  const stats = document.querySelectorAll('.stat__value[data-count-to]');
  if (!stats.length) return;

  const animate = (el) => {
    const to       = +el.dataset.countTo;
    const decimals = +(el.dataset.decimals || 0);
    const prefix   = el.dataset.prefix || '';
    const suffix   = el.dataset.suffix || '';
    const dur      = 1400;
    const start    = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);

    function frame(now) {
      const t = Math.min((now - start) / dur, 1);
      const v = to * ease(t);
      const txt = decimals > 0
        ? v.toFixed(decimals).replace('.', ',')
        : Math.round(v).toString();
      el.textContent = prefix + txt + suffix;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  const hero = document.querySelector('.hero');
  if (!hero || !('IntersectionObserver' in window)) {
    stats.forEach(animate);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        stats.forEach(animate);
        io.disconnect();
      }
    });
  }, { threshold: 0.4 });
  io.observe(hero);
}


/* ---------- 7c. CHART REVEAL — disparo lazy ao scroll ---------- */

const ChartReveal = (() => {
  const pending = new Map();

  function register(containerId, drawFn) {
    pending.set(containerId, drawFn);
  }

  function start() {
    if (!('IntersectionObserver' in window)) {
      pending.forEach((fn, id) => {
        fn().catch(err => console.error(`[reveal:${id}]`, err));
      });
      pending.clear();
      return;
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const id = e.target.id;
        const fn = pending.get(id);
        if (!fn) return;
        pending.delete(id);
        io.unobserve(e.target);
        fn().catch(err => console.error(`[reveal:${id}]`, err));
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

    pending.forEach((_, id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  return { register, start };
})();


/* ---------- 7. CALCULADORA PESSOAL (Secção V) ---------- */

async function initCalculator() {
  const slider     = document.getElementById('km-slider');
  const kmOutput   = document.getElementById('km-output');
  const fuelSelect = document.getElementById('fuel-select');
  const consumpt   = document.getElementById('consumption');
  const result     = document.getElementById('extra-cost');
  const explainer  = document.getElementById('extra-explain');

  // Preços derivados directamente da fonte ao vivo (mesma série dos gráficos).
  //   "before" = última observação ANTES de 28 fev 2026 (início da guerra)
  //   "after"  = observação MAIS RECENTE
  // Fallback: valores conhecidos do CSV DGEG, caso a fonte ao vivo falhe.
  const PRICES_FALLBACK = {
    gasoleo:  { before: 1.573, after: 1.958 },
    gasolina: { before: 1.665, after: 1.927 }
  };
  let PRICES = PRICES_FALLBACK;
  let priceAsOf = null;

  try {
    const fuelRes = await LiveData.fuel();
    const rows = fuelRes.data;
    if (rows && rows.length) {
      const before = [...rows].reverse().find(d => d.date < WAR_START);
      const latest = rows[rows.length - 1];
      if (before && latest) {
        PRICES = {
          gasoleo:  { before: before.gasoleo,  after: latest.gasoleo  },
          gasolina: { before: before.gasolina, after: latest.gasolina }
        };
        priceAsOf = latest.date;
      }
    }
  } catch (e) {
    console.warn('[calc] falhou a obter preços ao vivo, a usar fallback', e);
  }

  function update() {
    const km = +slider.value;
    const consumo = +consumpt.value;
    const fuel = fuelSelect.value;
    const p = PRICES[fuel];

    const litrosMes = (km * consumo) / 100;
    const custoAntes = litrosMes * p.before;
    const custoAgora = litrosMes * p.after;
    const diff = custoAgora - custoAntes;

    kmOutput.textContent = km + ' km';
    result.textContent  = (diff >= 0 ? '+ ' : '') + fmtEur(diff);
    const asOfTxt = priceAsOf ? ` <span style="opacity:.6">(actualizado a ${fmtDate(priceAsOf)})</span>` : '';
    explainer.innerHTML = `Antes da guerra pagavas <strong>${fmtEur(custoAntes)}</strong> · ` +
                          `agora pagas <strong>${fmtEur(custoAgora)}</strong>. ` +
                          `Em 12 meses: <strong>${fmtEur(diff * 12)}</strong>.${asOfTxt}`;
  }

  [slider, fuelSelect, consumpt].forEach(el =>
    el.addEventListener('input', update));
  update();
}


/* ---------- 8. INICIALIZAÇÃO ---------- */

document.addEventListener('DOMContentLoaded', () => {
  if (window.LiveStatus) window.LiveStatus.start();

  // Sticky badge "Cap. X" — copia o número do <span class="chapter__number"> para data-chapter
  // (consumido pelo CSS: .chapter[data-chapter]::before)
  document.querySelectorAll('.chapter').forEach(ch => {
    const num = ch.querySelector('.chapter__number');
    if (num && num.textContent.trim()) {
      ch.dataset.chapter = num.textContent.trim();
    }
  });

  initHeroCounters();
  initCalculator();

  // Cada gráfico só é desenhado quando entra no viewport
  ChartReveal.register('map-world',          drawMap);
  ChartReveal.register('chart-flows',        drawFlows);
  ChartReveal.register('chart-destinations', drawDestinations);
  ChartReveal.register('chart-prices',       drawPrices);
  ChartReveal.register('chart-inflation',    drawInflation);
  ChartReveal.start();

  // Re-render em resize (debounced)
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      ['map-world','chart-flows','chart-destinations','chart-prices','chart-inflation']
        .forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerHTML = '';
        });
      drawMap().catch(()=>{});
      drawFlows().catch(()=>{});
      drawDestinations().catch(()=>{});
      drawPrices().catch(()=>{});
      drawInflation().catch(()=>{});
    }, 200);
  });
});
