/* =============================================================================
   O Preço da Guerra — Camada de Dados Otimizada (via GitHub Actions / CSV)
   =============================================================================
   Agora que os dados são processados via Python e guardados em CSV, o JS
   apenas tem de ler esses ficheiros. É muito mais rápido e fiável.
   ========================================================================== */

const LiveConfig = {
  // Caminhos para os CSVs processados pelos teus scripts Python
  // Nota: Se estiveres no GitHub Pages, estes caminhos são relativos à raiz
  DATA_PATH: {
    brent:        'data/processed/brent.csv',
    fuel:         'data/processed/combustiveis.csv',
    inflation:    'data/processed/inflacao.csv',
    chokepoints:  'data/processed/chokepoints.csv',
    destinations: 'data/processed/hormuz.csv'
  }
};

const LiveData = {

  /* ----- BRENT Crude ----- */
  async brent() {
    console.log('[LiveData] A carregar Brent do repositório...');
    try {
      // Usamos d3.csv para carregar e formatar automaticamente
      const data = await d3.csv(LiveConfig.DATA_PATH.brent, d => ({
        date:  new Date(d.observation_date),
        value: +d.DCOILBRENTEU
      }));

      return {
        data: data.filter(d => !isNaN(d.value)),
        source: 'Yahoo Finance / FRED (via GitHub Actions)',
        live: true
      };
    } catch (e) {
      console.error('[LiveData] Erro ao carregar Brent:', e);
      return { data: [], source: 'Erro no carregamento', live: false };
    }
  },

  /* ----- COMBUSTÍVEIS PT ----- */
  async fuel() {
    console.log('[LiveData] A carregar Combustíveis do repositório...');
    try {
      const data = await d3.csv(LiveConfig.DATA_PATH.fuel, d => ({
        date:     new Date(d.date),
        gasoleo:  +d.gasoleo_pvp_eur_l,
        gasolina: +d.gasolina95_pvp_eur_l
      }));

      return {
        data: data.filter(d => !isNaN(d.date.getTime())),
        source: 'DGEG / ENSE (via GitHub Actions)',
        live: true
      };
    } catch (e) {
      console.error('[LiveData] Erro ao carregar Combustíveis:', e);
      return { data: [], source: 'Erro no carregamento', live: false };
    }
  },

  /* ----- INFLAÇÃO ----- */
  async inflation() {
    console.log('[LiveData] A carregar Inflação (Eurostat HICP + BPstat fallback)...');
    // Helper: converte "" / "None" / "NaN" em null; preserva números (incluindo 0).
    const num = v => (v === '' || v == null || v === 'None' || v === 'NaN') ? null : +v;
    try {
      const data = await d3.csv('data/processed/inflacao.csv', d => ({
        date: new Date(d.date),
        Total:       num(d.Total),
        Alimentacao: num(d.Alimentacao),
        Energia:     num(d.Energia),
        Transportes: num(d.Transportes)
      }));
      return { data, source: 'Eurostat HICP (PT) + BPstat', live: true };
    } catch (e) {
      console.error('Erro ao carregar inflação:', e);
      return { data: [], source: 'Erro', live: false };
    }
  },
  
  /* ----- CHOKEPOINTS ----- */
  async chokepoints() {
    try {
      const raw = await d3.csv(LiveConfig.DATA_PATH.chokepoints);
      return { raw, source: 'EIA World Oil Transit (via GitHub Actions)', live: true };
    } catch (e) {
      console.error('[LiveData] Erro ao carregar chokepoints:', e);
      return { raw: [], source: 'Erro no carregamento', live: false };
    }
  },

  /* ----- DESTINOS DE ORMUZ ----- */
  async destinations() {
    try {
      const raw = await d3.csv(LiveConfig.DATA_PATH.destinations);
      return { raw, source: 'EIA Hormuz Destinations (via GitHub Actions)', live: true };
    } catch (e) {
      console.error('[LiveData] Erro ao carregar destinos:', e);
      return { raw: [], source: 'Erro no carregamento', live: false };
    }
  }
};

// Expor para o main.js
window.LiveData = LiveData;
window.LiveConfig = LiveConfig;
