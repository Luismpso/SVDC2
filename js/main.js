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
  const bar    = document.getElementById('livebar');
  const elSrc  = document.getElementById('livebar-sources');
  const elTime = document.getElementById('livebar-time');

  // Acumula o estado de cada fonte para mostrar 🟢 (ao vivo) ou ⚪ (CSV/cache)
  const sources = {};

  function render() {
    if (!elSrc) return;
    const parts = Object.entries(sources).map(([name, info]) =>
      `<span class="livebar__source ${info.live ? 'is-live' : 'is-cache'}" title="${info.source || ''}">`
        + `${info.live ? '🟢' : '⚪'} ${name}`
      + `</span>`
    );
    elSrc.innerHTML = parts.length ? parts.join(' ') : 'a carregar…';
  }

  function updateTime() {
    if (!elTime) return;
    elTime.textContent = new Date().toLocaleTimeString('pt-PT',
      { hour: '2-digit', minute: '2-digit' });
  }

  return {
    start() {
      bar?.classList.add('livebar--loading');
      updateTime();
      render();
    },
    /**
     * report(nome, resultado) — chamado pelos drawX() à medida que recebem
     * dados. resultado deve ter { live: bool, source: string }.
     */
    report(name, result) {
      bar?.classList.remove('livebar--loading');
      if (name && result) {
        sources[name] = { live: !!result.live, source: result.source || '' };
        render();
      }
      updateTime();
    }
  };
})();


/* ---------- 2. MAPA-MUNDO COM CHOKEPOINTS (Secção I) ---------- */

async function drawMap() {
  const container = document.getElementById('map-world');
  const width  = container.clientWidth;
  const height = Math.min(width * 0.6, 720);

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Natural Earth a scale=1 ocupa ~6.06 unidades em largura e ~3.01 em altura.
  // Escolhe scale limitado pela menor dimensão e adiciona 5% de margem para
  // garantir que NADA fica cortado (Cabo, Austrália, Alasca, Pacífico inteiro).
  const scaleByH  = height / 3.05;
  const scaleByW  = width  / 6.10;
  const projScale = Math.min(scaleByH, scaleByW) * 0.95;

  const projection = d3.geoNaturalEarth1()
    .scale(projScale)
    .translate([width / 2, height / 2])
    .center([10, 0]);  // equador ao centro; longitude 10° para suave foco no MO

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

  // ===== ROTAS DE NAVEGAÇÃO (premium, animadas) =====
  // Três rotas que partem de Ormuz. Começam invisíveis; o primeiro clique
  // no dot principal desenha-as do origem ao destino e depois entram em
  // "flow" contínuo (dasharray a deslizar ao longo do path).
  const ormuz    = CHOKEPOINTS.find(c => c.main);
  const cabo     = CHOKEPOINTS.find(c => c.name === 'Cabo da Boa Esperança');
  const suezCp   = CHOKEPOINTS.find(c => c.name === 'Suez / SUMED');
  const malacaCp = CHOKEPOINTS.find(c => c.name === 'Estreito de Malaca');

  const orm = projection(ormuz.coords);
  const sue = projection(suezCp.coords);
  const mal = projection(malacaCp.coords);
  const cab = projection(cabo.coords);

  // Helper 1: arco quadrático "bowado" para sul (lado mais marítimo).
  // bow = quanto a curva se afasta da reta direta, em fração da corda.
  function arc(p1, p2, bow = 0.20) {
    const mx = (p1[0] + p2[0]) / 2;
    const chord = Math.hypot(p2[0]-p1[0], p2[1]-p1[1]);
    const cx = mx;
    const cy = (p1[1] + p2[1]) / 2 + chord * bow;
    const midX = 0.25 * p1[0] + 0.5 * cx + 0.25 * p2[0];
    const midY = 0.25 * p1[1] + 0.5 * cy + 0.25 * p2[1];
    return { d: `M ${p1[0]} ${p1[1]} Q ${cx} ${cy} ${p2[0]} ${p2[1]}`, mid: [midX, midY] };
  }

  // Helper 2: curva que passa por um waypoint (control point arbitrário).
  // Útil quando a rota tem um chokepoint intermédio real (ex.: Suez via Bab).
  function arcVia(p1, p2, waypoint, offsetY = 0) {
    const cx = waypoint[0];
    const cy = waypoint[1] + offsetY;
    const midX = 0.25 * p1[0] + 0.5 * cx + 0.25 * p2[0];
    const midY = 0.25 * p1[1] + 0.5 * cy + 0.25 * p2[1];
    return { d: `M ${p1[0]} ${p1[1]} Q ${cx} ${cy} ${p2[0]} ${p2[1]}`, mid: [midX, midY] };
  }

  // Gradientes: cada rota nasce em amber-hot (em Ormuz) e desvanece
  // para uma cor que liga ao destino — Suez/teal, Malaca/amber, Cabo/rust.
  const defs = svg.append('defs');
  const addGradient = (id, p1, p2, c1, c2) => {
    const g = defs.append('linearGradient')
      .attr('id', id).attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', p1[0]).attr('y1', p1[1])
      .attr('x2', p2[0]).attr('y2', p2[1]);
    g.append('stop').attr('offset', '0%').attr('stop-color', c1).attr('stop-opacity', 0.95);
    g.append('stop').attr('offset', '100%').attr('stop-color', c2).attr('stop-opacity', 0.55);
  };
  addGradient('grad-malaca', orm, mal, COLORS.amberHot, COLORS.amber);
  addGradient('grad-suez',   orm, sue, COLORS.amberHot, COLORS.teal);
  addGradient('grad-cabo',   orm, cab, COLORS.amberHot, COLORS.rust);

  // Geometrias:
  // Malaca: arco suave a sul de Índia (rota tanker padrão).
  // Suez:   passa explicitamente por Bab el-Mandeb (waypoint REAL — tankers
  //         contornam a Arábia, descem o Mar Arábico, sobem o Mar Vermelho).
  // Cabo:   bow pequeno, a rota já é longa-sul.
  const bab = projection([43.3, 12.6]);
  const arcMalaca = arc(orm, mal, 0.16);
  const arcSuez   = arcVia(orm, sue, bab, 18);   // 18px abaixo de Bab para "passar por baixo"
  const arcCabo   = arc(orm, cab, 0.10);

  // Definições das rotas — etiquetas em sítios livres de chokepoints/terra
  const ROUTES = [
    {
      id: 'malaca', d: arcMalaca.d, grad: 'grad-malaca',
      label: { x: arcMalaca.mid[0],      y: arcMalaca.mid[1] + 22,
               color: COLORS.amber, anchor: 'middle',
               text: '89% → Ásia via Malaca' }
    },
    {
      id: 'suez', d: arcSuez.d, grad: 'grad-suez',
      // Etiqueta sobre o Mediterrâneo (NW do Suez), longe de Bab el-Mandeb
      label: { x: sue[0] - 24,           y: sue[1] - 22,
               color: COLORS.teal, anchor: 'end',
               text: '→ Europa via Suez' }
    },
    {
      id: 'cabo', d: arcCabo.d, grad: 'grad-cabo',
      label: { x: arcCabo.mid[0],        y: arcCabo.mid[1] + 22,
               color: COLORS.amberHot, anchor: 'middle',
               text: '+15 dias por África' }
    }
  ];

  // Group: começa invisível, é revelado no primeiro clique do Ormuz
  const routesGroup = svg.append('g').attr('class', 'routes')
    .style('pointer-events', 'none')
    .style('opacity', 0);

  ROUTES.forEach(r => {
    routesGroup.append('path')
      .attr('class', `route route--${r.id}`)
      .attr('d', r.d)
      .attr('stroke', `url(#${r.grad})`)
      .attr('stroke-width', 1.8)
      .attr('stroke-linecap', 'round')
      .attr('stroke-dasharray', '6 9')
      .attr('opacity', 0.9)
      .attr('fill', 'none');

    routesGroup.append('text')
      .attr('class', `route-label route-label--${r.id}`)
      .attr('x', r.label.x).attr('y', r.label.y)
      .attr('text-anchor', r.label.anchor || 'middle')
      .attr('fill', r.label.color)
      .style('font-family', 'JetBrains Mono, monospace')
      .style('font-size', '10.5px')
      .style('paint-order', 'stroke fill')
      .style('stroke', 'var(--bg-deep, #0a0e14)')
      .style('stroke-width', '4px')
      .style('opacity', 0)
      .text(r.label.text);
  });

  // Reveal — primeiro clique no Ormuz desenha as rotas e arranca o flow
  let routesRevealed = false;
  function revealRoutes() {
    if (routesRevealed) return;
    routesRevealed = true;
    routesGroup.style('opacity', 1);

    ROUTES.forEach((r, i) => {
      const path  = routesGroup.select(`.route--${r.id}`);
      const label = routesGroup.select(`.route-label--${r.id}`);
      const len   = path.node().getTotalLength();

      // Fase 1: desenhar o path de origem→destino
      path
        .attr('stroke-dasharray', `${len} ${len}`)
        .attr('stroke-dashoffset', len)
        .transition()
          .duration(1400 + i * 100)
          .delay(i * 220)
          .ease(d3.easeQuadOut)
          .attr('stroke-dashoffset', 0)
        .on('end', function () {
          // Fase 2: dasharray decorativo + flow contínuo via CSS
          d3.select(this)
            .attr('stroke-dasharray', '6 9')
            .style('stroke-dashoffset', null)
            .classed('route--flowing', true);
        });

      // Etiqueta aparece quando o path quase chegou ao destino
      label.transition()
        .delay(i * 220 + 1100)
        .duration(500)
        .style('opacity', 0.9);
    });
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
    .style('cursor', d => d.main ? 'pointer' : 'default')
    .on('mouseenter', (e, d) => {
      showTooltip(e, `<strong>${d.name}</strong>${d.value} milhões barris/dia<br>${d.desc}` +
        (d.main && !routesRevealed ? '<br><span style="opacity:.7">› clica para ver as rotas</span>' : ''));
    })
    .on('mousemove',  (e, d) => showTooltip(e,
      `<strong>${d.name}</strong>${d.value} milhões barris/dia<br>${d.desc}` +
      (d.main && !routesRevealed ? '<br><span style="opacity:.7">› clica para ver as rotas</span>' : '')))
    .on('mouseleave', () => hideTooltip())
    .on('click', (e, d) => { if (d.main) revealRoutes(); });

  // Layout editorial das etiquetas — escolhido manualmente por geografia
  // para evitar sobreposições com os dots e pousar sobre mares/oceanos
  // (espaço de leitura limpo). anchor: 'start' (label à direita do ponto),
  // 'end' (à esquerda), 'middle' (centrada). leader: leader line subtil.
  const LABEL_LAYOUT = {
    'Estreito de Ormuz':     { dx:  60, dy:  26, anchor: 'start',  leader: true  }, // SE — Mar Arábico
    'Estreito de Malaca':    { dx:   0, dy:  44, anchor: 'middle', leader: false }, // S — Java/Sumatra
    'Bab el-Mandeb':         { dx: -16, dy:   4, anchor: 'end',    leader: false }, // W — Sudão
    'Suez / SUMED':          { dx: -16, dy:   4, anchor: 'end',    leader: false }, // W — Mediterrâneo
    'Estreitos Turcos':      { dx:   0, dy: -14, anchor: 'middle', leader: false }, // N — Mar Negro
    'Estreitos Dinamarq.':   { dx:  16, dy:   4, anchor: 'start',  leader: false }, // E — Báltico
    'Cabo da Boa Esperança': { dx:  22, dy:   4, anchor: 'start',  leader: false }, // E — Índico
    'Canal do Panamá':       { dx:  14, dy:   4, anchor: 'start',  leader: false }  // E — Caraíbas
  };

  // Etiquetagem: TODOS os chokepoints recebem nome estático.
  // Ormuz tem destaque (Fraunces, valor por baixo, leader line).
  // Os outros usam mini-etiquetas em mono, mais discretas.
  cp.each(function (d) {
    const layout = LABEL_LAYOUT[d.name];
    if (!layout) return;
    const g = d3.select(this);

    // Leader line — só Ormuz, porque a etiqueta está afastada do dot
    if (layout.leader) {
      g.append('line')
        .attr('class', 'chokepoint-leader')
        .attr('x1', 22).attr('y1', 10)            // borda do dot, direção SE
        .attr('x2', layout.dx - 4).attr('y2', layout.dy);  // perto do label
    }

    // Nome do chokepoint
    g.append('text')
      .attr('class', d.main ? 'chokepoint-label' : 'chokepoint-label-mini')
      .attr('x', layout.dx).attr('y', layout.dy)
      .attr('text-anchor', layout.anchor)
      .text(d.name);

    // Valor — apenas Ormuz, em segunda linha
    if (d.main) {
      g.append('text')
        .attr('class', 'chokepoint-value')
        .attr('x', layout.dx).attr('y', layout.dy + 16)
        .attr('text-anchor', layout.anchor)
        .text('20,9 mb/d');
    }
  });
}


/* ---------- 3. FLUXOS POR ROTA (Secção II) ---------- */

async function drawFlows() {
  const container = document.getElementById('chart-flows');
  const width = container.clientWidth;
  const height = 460;
  // Right margin generoso para 8 etiquetas no fim das linhas
  const margin = { top: 30, right: 200, bottom: 50, left: 50 };

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Carrega CSV em formato LONG: date, periodo_original, chokepoint, value
  const raw = await d3.csv('data/processed/chokepoints.csv', d => ({
    date: new Date(d.date),
    periodLabel: d.periodo_original,
    chokepoint: d.chokepoint,
    value: +d.value
  }));

  // Hierarquia visual: primárias (3px, vivas) > secundárias (2px) > terciárias (1.2px, esbatidas).
  // Cada rota tem um peso narrativo diferente para a história da guerra do Irão.
  const SERIES = [
    { en: 'Strait of Hormuz',                pt: 'Estreito de Ormuz',        color: COLORS.amber,    weight: 'primary'   },
    { en: 'Cape of Good Hope',               pt: 'Cabo da Boa Esperança',    color: COLORS.ink,      weight: 'primary'   },
    { en: 'Bab el-Mandeb',                   pt: 'Bab el-Mandeb',            color: COLORS.rust,     weight: 'secondary' },
    { en: 'Suez Canal and SUMED Pipeline',   pt: 'Suez / SUMED',             color: COLORS.teal,     weight: 'secondary' },
    { en: 'Strait of Malacca',               pt: 'Estreito de Malaca',       color: '#a8a092',       weight: 'tertiary'  },
    { en: 'Danish Straits',                  pt: 'Estreitos Dinamarq.',      color: '#6f8a92',       weight: 'tertiary'  },
    { en: 'Turkish Straits (Dardanelles)',   pt: 'Estreitos Turcos',         color: '#8a7e6f',       weight: 'tertiary'  },
    { en: 'Panama Canal',                    pt: 'Canal do Panamá',          color: '#7a7268',       weight: 'tertiary'  },
  ];
  const STROKE_W = { primary: 3, secondary: 2, tertiary: 1.2 };
  const OPACITY  = { primary: 1, secondary: 0.95, tertiary: 0.72 };

  // Pivota long → series: agrupa por chokepoint, ordena por data
  const byCp = d3.group(raw, d => d.chokepoint);
  const series = SERIES
    .filter(s => byCp.has(s.en))
    .map(s => ({
      ...s,
      values: byCp.get(s.en).slice().sort((a, b) => a.date - b.date),
    }));

  // Domínio temporal: prolongar até pouco depois da guerra para mostrar a anotação,
  // mesmo que ainda não existam dados nesse período.
  const allDates = raw.map(r => r.date);
  const xMin = d3.min(allDates);
  const xMaxData = d3.max(allDates);
  const xMaxWar  = new Date('2026-06-30');               // espaço para a label da guerra
  const xMax     = xMaxData > xMaxWar ? xMaxData : xMaxWar;

  const x = d3.scaleTime().domain([xMin, xMax])
    .range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 26]).nice()
    .range([height - margin.bottom, margin.top]);

  // Eixo X: ticks por ano
  svg.append('g').attr('class', 'axis axis--x')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(d3.timeYear.every(1)).tickFormat(d3.timeFormat('%Y')));

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
    .x(d => x(d.date))
    .y(d => y(d.value))
    .curve(d3.curveMonotoneX);

  const linesGroup = svg.append('g').attr('class', 'flow-lines');

  // ===== Hover-to-highlight: aclara a série focada, esmaece as outras =====
  function highlight(focusEn) {
    linesGroup.selectAll('.flow-line').style('opacity', function () {
      return this.__name === focusEn ? 1 : 0.18;
    });
    linesGroup.selectAll('.flow-label').style('opacity', function () {
      return this.__name === focusEn ? 1 : 0.25;
    });
  }
  function unhighlight() {
    linesGroup.selectAll('.flow-line').style('opacity', function () {
      return OPACITY[this.__weight];
    });
    linesGroup.selectAll('.flow-label').style('opacity', 1);
  }

  series.forEach(s => {
    const path = linesGroup.append('path')
      .datum(s.values)
      .attr('class', `flow-line flow-line--${s.weight}`)
      .attr('fill', 'none')
      .attr('stroke', s.color)
      .attr('stroke-width', STROKE_W[s.weight])
      .attr('opacity', 0)
      .attr('d', line);
    path.node().__name = s.en;
    path.node().__weight = s.weight;
    path.on('mouseenter', () => highlight(s.en))
        .on('mouseleave', unhighlight);

    path.transition().duration(900).delay(300)
        .attr('opacity', OPACITY[s.weight]);

    // Pontos só para séries primárias e secundárias (terciárias eram ruído)
    if (s.weight !== 'tertiary') {
      linesGroup.append('g').selectAll('circle')
        .data(s.values)
        .enter().append('circle')
          .attr('cx', d => x(d.date))
          .attr('cy', d => y(d.value))
          .attr('r', s.weight === 'primary' ? 3 : 2.5)
          .attr('fill', s.color)
          .attr('opacity', OPACITY[s.weight])
          .on('mouseenter', (e, d) => {
            highlight(s.en);
            showTooltip(e, `<strong>${s.pt}</strong>${d.periodLabel}: ${d.value.toFixed(1)} mb/d`);
          })
          .on('mouseleave', () => { hideTooltip(); unhighlight(); });
    }
  });

  // ===== Etiquetas no fim das linhas com colisão evitada =====
  // 1. Calcula a posição-alvo de cada etiqueta (Y do último ponto)
  // 2. Ordena por Y crescente (do topo do gráfico para baixo)
  // 3. Empurra cada uma para baixo se estiver demasiado perto da anterior
  const MIN_GAP = 14;
  const labels = series.map(s => {
    const last = s.values[s.values.length - 1];
    return {
      en: s.en, pt: s.pt, color: s.color, weight: s.weight,
      xLast: x(last.date),
      yTarget: y(last.value),
      y: y(last.value),
    };
  }).sort((a, b) => a.yTarget - b.yTarget);

  let prevY = -Infinity;
  labels.forEach(l => {
    l.y = Math.max(l.yTarget, prevY + MIN_GAP);
    prevY = l.y;
  });

  labels.forEach(l => {
    // Linha-guia subtil entre o último ponto e a etiqueta deslocada
    if (Math.abs(l.y - l.yTarget) > 2) {
      linesGroup.append('line')
        .attr('class', 'flow-leader')
        .attr('x1', l.xLast + 2).attr('y1', l.yTarget)
        .attr('x2', l.xLast + 10).attr('y2', l.y)
        .attr('stroke', l.color).attr('stroke-width', 0.7)
        .attr('opacity', 0.4);
    }
    const text = linesGroup.append('text')
      .attr('class', `flow-label flow-label--${l.weight}`)
      .attr('x', l.xLast + 12).attr('y', l.y + 4)
      .attr('fill', l.color)
      .style('font-family', 'JetBrains Mono, monospace')
      .style('font-size', l.weight === 'tertiary' ? '10px' : '11px')
      .style('opacity', l.weight === 'tertiary' ? 0.78 : 1)
      .text(l.pt);
    text.node().__name = l.en;
    text.on('mouseenter', () => highlight(l.en))
        .on('mouseleave', unhighlight);
  });

  // ===== Anotações verticais: Houthi 2023 + Guerra Irão 2026 =====
  function annotate(date, label, color = COLORS.rust, anchor = 'end') {
    const xPos = x(date);
    svg.append('line')
      .attr('class', 'war-line')
      .attr('x1', xPos).attr('x2', xPos)
      .attr('y1', margin.top).attr('y2', height - margin.bottom)
      .attr('stroke', color)
      .attr('opacity', 0.55);
    svg.append('text')
      .attr('class', 'war-label')
      .attr('x', anchor === 'end' ? xPos - 6 : xPos + 6)
      .attr('y', margin.top + 14)
      .attr('text-anchor', anchor)
      .attr('fill', color)
      .attr('opacity', 0.85)
      .text(label);
  }

  annotate(new Date('2023-11-15'), 'Ataques Houthi (nov 2023)', COLORS.rust, 'end');
  annotate(WAR_START,                'Guerra Irão (28 fev 2026)', COLORS.amberHot, 'start');
}


/* ---------- 3.5 PORTAGENS NOS CHOKEPOINTS (Secção II½) ----------
 * Visualização que compara os 5 principais chokepoints petrolíferos
 * quanto a se cobram portagem aos navios em trânsito, quanto cobram,
 * e qual é o estatuto legal (UNCLOS vs. tratados específicos).
 *
 * Os dados aqui NÃO vêm de uma série temporal — são "snapshot" de
 * factos públicos extraídos de notícias e tratados, com data e fonte:
 *
 *  • Ormuz: Bloomberg/AA/Iran International (Mar 2026)
 *  • Suez:  Suez Canal Authority (tarifário oficial)
 *  • Panamá: Panama Canal Authority (tarifário oficial)
 *  • Estreitos Turcos: Convenção de Montreux (1936), tarifário Turkstrait
 *  • Malaca: The Diplomat / Foreign Policy / Lowy Inst. (Abr 2026)
 */
async function drawTolls() {
  const container = document.getElementById('chart-tolls');
  if (!container) return;
  if (window.LiveStatus) window.LiveStatus.report('Portagens', { live: true, source: 'Notícias + tratados (Mai 2026)' });

  const width = container.clientWidth;
  const margin = { top: 30, right: 320, bottom: 50, left: 200 };
  const rowH = 64;

  // Status:
  //   legitimate → tarifário com base jurídica clara
  //   imposed    → portagem aplicada pelo estado costeiro mas contestada (UNCLOS Art. 26)
  //   rejected   → proposta abandonada/recusada
  const TOLLS = [
    {
      name: 'Estreito de Ormuz',
      toll: 1500000, status: 'imposed',
      type: 'Estreito natural',
      legal: 'UNCLOS Art. 26 proíbe portagens em estreitos de navegação internacional',
      since: 'Mar 2026',
      detail: 'Parlamento iraniano aprovou lei a 26 Mar; BC já recebeu “primeira receita” a 23 Abr.',
      source: 'Bloomberg, Iran Intl., AA News'
    },
    {
      name: 'Estreito de Malaca',
      toll: 0, status: 'rejected',
      type: 'Estreito natural',
      legal: 'UNCLOS — Singapura e Malásia recusaram em 24h',
      since: 'Abr 2026 (recusada)',
      detail: 'Min. Finanças indonésio Purbaya propôs taxa a 22 Abr; recuou no dia seguinte.',
      source: 'The Diplomat, Lowy Institute'
    },
    {
      name: 'Canal do Suez',
      toll: 700000, status: 'legitimate',
      type: 'Canal construído',
      legal: 'Soberania egípcia — canal artificial fora do regime UNCLOS de estreitos',
      since: 'desde 1869',
      detail: 'VLCC com carga típica paga $300k–$1M consoante direção e tonelagem.',
      source: 'Suez Canal Authority'
    },
    {
      name: 'Canal do Panamá',
      toll: 500000, status: 'legitimate',
      type: 'Canal construído',
      legal: 'Soberania panamiana — canal artificial',
      since: 'desde 1914',
      detail: 'Aumentos recentes desde 2024 pela seca no lago Gatún.',
      source: 'Panama Canal Authority'
    },
    {
      name: 'Estreitos Turcos',
      toll: 100000, status: 'legitimate',
      type: 'Estreito natural',
      legal: 'Convenção de Montreux (1936) — regime especial pré-UNCLOS',
      since: 'desde 1936',
      detail: 'Taxa por tonelagem (~$0,95/ton). Cobrada à passagem para o Mar Negro.',
      source: 'Convenção de Montreux'
    },
  ];

  const height = margin.top + margin.bottom + TOLLS.length * rowH;

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Escala X: linear até $1.6M com padding para a etiqueta de valor caber
  const xMax = d3.max(TOLLS, d => d.toll);
  const x = d3.scaleLinear()
    .domain([0, xMax * 1.18])
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(TOLLS.map(d => d.name))
    .range([margin.top, height - margin.bottom])
    .padding(0.35);

  // Cores por status
  const STATUS_COLOR = {
    'imposed':    COLORS.rust,
    'rejected':   COLORS.inkDim,
    'legitimate': COLORS.teal,
  };
  const STATUS_LABEL = {
    'imposed':    '⚠ Imposta · contestada',
    'rejected':   '✕ Proposta · recusada',
    'legitimate': '✓ Base jurídica clara',
  };

  // Eixo X em cima — formato em milhares/milhões de USD
  const xAxis = svg.append('g')
    .attr('class', 'axis axis--x')
    .attr('transform', `translate(0, ${margin.top - 8})`)
    .call(d3.axisTop(x)
      .ticks(5)
      .tickFormat(d => d === 0 ? '$0' : d >= 1e6 ? `$${(d/1e6).toFixed(1)}M` : `$${(d/1000).toFixed(0)}k`)
      .tickSize(-(height - margin.top - margin.bottom)));
  xAxis.selectAll('line').attr('stroke-opacity', 0.1);
  xAxis.select('.domain').remove();

  // (Sem subtítulo inline — o figcaption por baixo do SVG já explica
  //  que os valores são estimativas em USD por petroleiro VLCC.)

  // Linhas + barras + textos
  const row = svg.selectAll('g.toll-row')
    .data(TOLLS)
    .enter().append('g')
      .attr('class', 'toll-row')
      .attr('transform', d => `translate(0, ${y(d.name)})`);

  // Nome do chokepoint (à esquerda)
  row.append('text')
    .attr('x', margin.left - 12)
    .attr('y', y.bandwidth() / 2 - 2)
    .attr('text-anchor', 'end')
    .attr('fill', COLORS.ink)
    .style('font-family', 'Fraunces, serif')
    .style('font-size', '15px')
    .style('font-weight', 600)
    .text(d => d.name);

  // Tipo (canal vs estreito)
  row.append('text')
    .attr('x', margin.left - 12)
    .attr('y', y.bandwidth() / 2 + 14)
    .attr('text-anchor', 'end')
    .attr('fill', COLORS.inkDim)
    .style('font-family', 'JetBrains Mono, monospace')
    .style('font-size', '10px')
    .text(d => d.type);

  // Bar
  row.append('rect')
    .attr('x', margin.left)
    .attr('y', 6)
    .attr('height', y.bandwidth() - 12)
    .attr('width', 0)   // animação
    .attr('fill', d => STATUS_COLOR[d.status])
    .attr('opacity', d => d.status === 'rejected' ? 0.35 : 0.85)
    .attr('rx', 2)
    .on('mouseenter', function (e, d) {
      d3.select(this).attr('opacity', 1);
      const tollTxt = d.toll === 0 ? 'sem portagem' :
        d.toll >= 1e6 ? `$${(d.toll/1e6).toFixed(1)}M/navio` :
        `$${(d.toll/1000).toFixed(0)}k/navio`;
      showTooltip(e,
        `<strong>${d.name} · ${tollTxt}</strong>` +
        `${d.detail}<br>` +
        `<span style="opacity:.75">${d.legal}</span><br>` +
        `<span style="opacity:.55;font-size:10px">Fonte: ${d.source}</span>`);
    })
    .on('mousemove', (e) => tooltip
      .style('left', (e.pageX + 14) + 'px').style('top', (e.pageY - 10) + 'px'))
    .on('mouseleave', function (e, d) {
      d3.select(this).attr('opacity', d.status === 'rejected' ? 0.35 : 0.85);
      hideTooltip();
    })
    .transition().duration(900).delay((d, i) => i * 100).ease(d3.easeQuadOut)
    .attr('width', d => Math.max(2, x(d.toll) - margin.left));

  // Valor à direita do bar
  row.append('text')
    .attr('class', 'toll-value')
    .attr('x', d => x(d.toll) + 8)
    .attr('y', y.bandwidth() / 2 + 2)
    .attr('fill', d => STATUS_COLOR[d.status])
    .style('font-family', 'JetBrains Mono, monospace')
    .style('font-size', '13px')
    .style('font-weight', 500)
    .style('opacity', 0)
    .text(d => d.toll === 0 ? 'recusada'
              : d.toll >= 1e6 ? `≈ $${(d.toll/1e6).toFixed(1)}M`
              : `≈ $${(d.toll/1000).toFixed(0)}k`)
    .transition().duration(400).delay((d, i) => 900 + i * 100)
    .style('opacity', 1);

  // Estatuto legal + ano (à direita do valor)
  row.append('text')
    .attr('x', width - margin.right + 8)
    .attr('y', y.bandwidth() / 2 - 2)
    .attr('fill', d => STATUS_COLOR[d.status])
    .style('font-family', 'JetBrains Mono, monospace')
    .style('font-size', '10px')
    .style('font-weight', 500)
    .text(d => STATUS_LABEL[d.status]);

  row.append('text')
    .attr('x', width - margin.right + 8)
    .attr('y', y.bandwidth() / 2 + 12)
    .attr('fill', COLORS.inkDim)
    .style('font-family', 'JetBrains Mono, monospace')
    .style('font-size', '10px')
    .text(d => d.since);

  // Rodapé com a nota editorial
  svg.append('text')
    .attr('x', margin.left)
    .attr('y', height - 12)
    .attr('fill', COLORS.inkDim)
    .style('font-family', 'JetBrains Mono, monospace')
    .style('font-size', '10px')
    .text('Canais artificiais cobram legalmente. Estreitos naturais não — exceto Montreux. O Irão é o 1.º a tentar.');
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
  // NOTA: quando o destino tem o mesmo nome da região (caso "Europa,Europa"),
  // o Sankey cria um link region→country que é um self-loop e d3-sankey@0.12
  // não suporta ciclos — sufixamos o destino para garantir que é um nó distinto.
  const raw = await d3.csv('data/processed/hormuz.csv', d => ({
    destination: d.destination === d.region ? `${d.destination} (UE)` : d.destination,
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
    .curve(d3.curveStepAfter); 

  const lineGas = d3.line()
    .x(d => x(d.date)).y(d => yFuel(d.gasolina))
    .curve(d3.curveStepAfter);

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
  // O CSV tem: date (Date), Total, Alimentacao, Energia, Transportes (números)
  const data = ineRes.data
    .filter(d => d.date && d.date.getFullYear() >= 2000)
    .sort((a, b) => a.date - b.date);

  // 4 classes — o que está no CSV processado pelo api/inflacao.py
  // (anteriormente havia 10 classes hardcoded com nomes longos do PORDATA,
  //  mas o CSV atual vem do Eurostat HICP e tem apenas estas 4)
  const CLASSES = [
    'Total',
    'Transportes',   // ← classe destacada (mais sensível ao petróleo)
    'Energia',
    'Alimentacao',
  ];
  const SHORT_LABEL = {
    'Total':       'Total IPC',
    'Transportes': 'Transportes',
    'Energia':     'Energia',
    'Alimentacao': 'Alimentação',
  };

  // Layout — 4 painéis em linha em ecrãs largos, 2x2 em ecrãs estreitos
  const cols = containerWidth < 700 ? 2 : 4;
  const rows = Math.ceil(CLASSES.length / cols);
  const gap = 16;
  const cellW = (containerWidth - (cols - 1) * gap) / cols;
  const cellH = 170;
  const totalH = rows * cellH + (rows - 1) * gap + 40;
  const margin = { top: 36, right: 10, bottom: 26, left: 32 };

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${containerWidth} ${totalH}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Escala global Y comum — para comparabilidade entre painéis
  const allValues = data.flatMap(d => CLASSES.map(c => d[c]))
    .filter(v => v != null && !isNaN(v));
  const yExt = d3.extent(allValues);
  const yPad = 0.1 * (yExt[1] - yExt[0]);

  // X mensal (Date), Y comum em pontos percentuais
  const xScale = d3.scaleTime()
    .domain(d3.extent(data, d => d.date))
    .range([margin.left, cellW - margin.right]);

  const yScale = d3.scaleLinear()
    .domain([Math.min(yExt[0] - yPad, -2), yExt[1] + yPad]).nice()
    .range([cellH - margin.bottom, margin.top]);

  // Eventos relevantes para anotação
  const EVENTS = [
    { date: new Date('2008-09-15'), label: 'Crise 2008' },
    { date: new Date('2022-02-24'), label: 'Ucrânia' },
    { date: WAR_START,              label: 'Irão' },
  ];

  // Gerar painel para cada classe
  CLASSES.forEach((cls, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const xOff = col * (cellW + gap);
    const yOff = row * (cellH + gap) + 36;

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

    // Linhas verticais para eventos
    EVENTS.forEach(e => {
      const xe = xScale(e.date);
      if (xe < margin.left || xe > cellW - margin.right) return;
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
      .x(d => xScale(d.date))
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
        .transition().duration(900).delay(i * 80).ease(d3.easeQuadOut)
        .attr('stroke-dashoffset', 0);

    // Eixos minimal
    g.append('g')
      .attr('transform', `translate(${margin.left}, 0)`)
      .call(d3.axisLeft(yScale).ticks(4).tickFormat(d => d + '%').tickSize(0))
      .call(s => s.select('.domain').remove())
      .call(s => s.selectAll('text').attr('fill', COLORS.inkDim).style('font-size', '9px'));

    g.append('g')
      .attr('transform', `translate(0, ${cellH - margin.bottom})`)
      .call(d3.axisBottom(xScale).ticks(d3.timeYear.every(5)).tickFormat(d3.timeFormat('%Y')).tickSize(0))
      .call(s => s.select('.domain').remove())
      .call(s => s.selectAll('text').attr('fill', COLORS.inkDim).style('font-size', '9px'));

    // Título do painel
    g.append('text')
      .attr('x', margin.left)
      .attr('y', 18)
      .attr('fill', isHighlight ? COLORS.amberHot : COLORS.ink)
      .style('font-family', 'Fraunces, serif')
      .style('font-size', '13px')
      .style('font-weight', isHighlight ? 600 : 500)
      .text(SHORT_LABEL[cls]);

    // Valor mais recente (em cima à direita)
    const latest = [...data].reverse().find(d => d[cls] != null && !isNaN(d[cls]));
    if (latest) {
      g.append('text')
        .attr('x', cellW - margin.right)
        .attr('y', 18)
        .attr('text-anchor', 'end')
        .attr('fill', isHighlight ? COLORS.amberHot : COLORS.inkDim)
        .style('font-family', 'JetBrains Mono, monospace')
        .style('font-size', '11px')
        .style('font-weight', 500)
        .text(`${latest[cls].toFixed(1)}% · ${d3.timeFormat('%b %Y')(latest.date)}`);
    }

    // Hover — encontrar ponto mais próximo no tempo
    const bisect = d3.bisector(d => d.date).left;
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
        const dateAtX = xScale.invert(mx);
        const idx = bisect(data, dateAtX);
        const row_ = data[Math.min(idx, data.length - 1)];
        if (!row_ || row_[cls] == null || isNaN(row_[cls])) return;
        focus.attr('cx', xScale(row_.date)).attr('cy', yScale(row_[cls])).style('opacity', 1);
        showTooltip(event,
          `<strong>${SHORT_LABEL[cls]}</strong>${d3.timeFormat('%b %Y')(row_.date)}: ${row_[cls].toFixed(1)}%`);
      })
      .on('mouseleave', () => { focus.style('opacity', 0); hideTooltip(); });
  });

  // Legenda com os 3 eventos
  const legend = svg.append('g')
    .attr('transform', `translate(0, 16)`);
  EVENTS.forEach((e, i) => {
    const lg = legend.append('g').attr('transform', `translate(${i * 120}, 0)`);
    lg.append('line').attr('x2', 14).attr('y1', 5).attr('y2', 5)
      .attr('stroke', COLORS.rust).attr('stroke-width', 1.5);
    lg.append('text').attr('x', 20).attr('y', 9)
      .attr('fill', COLORS.inkDim)
      .style('font-family', 'JetBrains Mono, monospace')
      .style('font-size', '10px')
      .text(`${e.date.getFullYear()} · ${e.label}`);
  });
}


/* ---------- 7b. CONTADORES ANIMADOS DO HERO ---------- */

// Antes de animar, tenta calcular o impacto REAL a partir dos CSV ao vivo,
// para o hero nunca ficar fora-de-sincronia com o resto da página.
//
//   Brent (%)    = média (WAR_START → últimos 60d) ÷ média (60d pré-guerra) − 1
//   Gasóleo (€) = última observação − última observação ANTES da guerra
//
// Se a leitura dos CSV falhar, fica o data-count-to já presente no HTML
// como fallback (valor editorial).
async function refreshHeroFromLiveData() {
  const fmtEurNum = v => v.toFixed(2).replace('.', ',');

  // --- Brent ---
  try {
    const res = await LiveData.brent();
    const rows = (res?.data || []).filter(d => d.date instanceof Date && !isNaN(d.value));
    if (rows.length) {
      const ms = 24 * 3600 * 1000;
      const preStart  = new Date(WAR_START.getTime() - 60 * ms);
      const postEnd   = new Date(WAR_START.getTime() + 120 * ms);
      const pre  = rows.filter(d => d.date >= preStart && d.date <  WAR_START).map(d => d.value);
      const post = rows.filter(d => d.date >= WAR_START && d.date <= postEnd).map(d => d.value);
      if (pre.length && post.length) {
        const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
        const pct  = ((mean(post) / mean(pre)) - 1) * 100;
        const el = document.getElementById('hero-stat-brent');
        const lbl = document.getElementById('hero-label-brent');
        if (el) el.dataset.countTo = Math.max(0, pct).toFixed(0);
        if (lbl) lbl.textContent = `Brent crude — média pós-guerra vs pré (60d)`;
      }
    }
  } catch (e) { console.warn('[hero] brent falhou', e); }

  // --- Gasóleo ---
  try {
    const res = await LiveData.fuel();
    const rows = (res?.data || []).filter(d => d.date instanceof Date && !isNaN(d.gasoleo));
    if (rows.length) {
      const before = [...rows].reverse().find(d => d.date < WAR_START);
      const latest = rows[rows.length - 1];
      if (before && latest) {
        const diff = latest.gasoleo - before.gasoleo;
        const el  = document.getElementById('hero-stat-fuel');
        const lbl = document.getElementById('hero-label-fuel');
        if (el) {
          el.dataset.countTo = Math.max(0, diff).toFixed(2);
          // Mudar prefixo se a diferença for negativa (improvável mas seguro)
          el.dataset.prefix = diff >= 0 ? '+€' : '−€';
        }
        if (lbl) lbl.textContent = `Gasóleo em Portugal (€${fmtEurNum(before.gasoleo)} → €${fmtEurNum(latest.gasoleo)})`;
      }
    }
  } catch (e) { console.warn('[hero] gasóleo falhou', e); }
}

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
    refreshHeroFromLiveData().finally(() => stats.forEach(animate));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        // Atualiza os data-count-to com valores reais ANTES de animar.
        refreshHeroFromLiveData().finally(() => stats.forEach(animate));
        io.disconnect();
      }
    });
  }, { threshold: 0.4 });
  io.observe(hero);
}


/* ---------- 7c. CHART REVEAL — disparo lazy ao scroll ---------- */

const ChartReveal = (() => {
  const pending  = new Map();   // id → drawFn (ainda não revelado)
  const revealed = new Map();   // id → drawFn (já desenhado pelo menos uma vez)

  function register(containerId, drawFn) {
    pending.set(containerId, drawFn);
  }

  function _markRevealed(id, fn) {
    revealed.set(id, fn);
  }

  function start() {
    if (!('IntersectionObserver' in window)) {
      pending.forEach((fn, id) => {
        _markRevealed(id, fn);
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
        _markRevealed(id, fn);
        io.unobserve(e.target);
        fn().catch(err => console.error(`[reveal:${id}]`, err));
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

    pending.forEach((_, id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  // Re-desenha APENAS os gráficos que já foram revelados, limpando o SVG antigo.
  // Útil no handler de resize: evita disparar drawX em containers ainda fora do
  // viewport (mantém a otimização lazy-load).
  function redrawRevealed() {
    revealed.forEach((fn, id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
      fn().catch(err => console.error(`[redraw:${id}]`, err));
    });
  }

  return { register, start, redrawRevealed };
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
  ChartReveal.register('chart-tolls',        drawTolls);
  ChartReveal.register('chart-destinations', drawDestinations);
  ChartReveal.register('chart-prices',       drawPrices);
  ChartReveal.register('chart-inflation',    drawInflation);
  ChartReveal.start();

  // Re-render em resize (debounced) — só os gráficos JÁ revelados.
  // Os que ainda não entraram no viewport ficam intactos no estado pending
  // e serão desenhados normalmente quando o utilizador chegar lá.
  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    // Ignora resizes de altura puros (barra de URL móvel)
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      ChartReveal.redrawRevealed();
    }, 200);
  });
});
