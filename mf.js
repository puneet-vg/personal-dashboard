/* ============================================================
   mf.js — mutual fund NAV lookup (free, no key required)
   Source: api.mfapi.in — mirrors AMFI's public daily NAV data.
   If it's ever unreachable, we keep the last good value and
   quietly retry later. We never show ₹0 because of a failed fetch.
   ============================================================ */

const MF_API_BASE = "https://api.mfapi.in/mf";

const MutualFundAPI = {
  /**
   * Search schemes by name fragment. Returns [] on any failure.
   */
  async search(query) {
    if (!query || query.trim().length < 3) return [];
    try {
      const res = await fetch(`${MF_API_BASE}/search?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) return [];
      const list = await res.json();
      return Array.isArray(list) ? list.slice(0, 25) : [];
    } catch (e) {
      console.warn("MF search failed", e);
      return [];
    }
  },

  /**
   * Fetch latest NAV for a scheme code.
   * Returns { nav: number, date: 'DD-MM-YYYY' } or null on failure.
   */
  async fetchLatestNav(schemeCode) {
    try {
      const res = await fetch(`${MF_API_BASE}/${encodeURIComponent(schemeCode)}/latest`);
      if (!res.ok) return null;
      const json = await res.json();
      const row = json && json.data && json.data[0];
      if (!row) return null;
      const nav = parseFloat(row.nav);
      if (isNaN(nav)) return null;
      return { nav, date: row.date };
    } catch (e) {
      console.warn("NAV fetch failed for", schemeCode, e);
      return null;
    }
  },

  /**
   * Refreshes NAV for every stored mutual fund. Never destroys
   * an existing value on failure — only updates on success.
   * Returns { updated, failed } counts.
   */
  async refreshAll() {
    const data = Store.load();
    let updated = 0, failed = 0;

    for (const fund of data.mutualFunds) {
      if (!fund.schemeCode) { failed++; continue; }
      const result = await this.fetchLatestNav(fund.schemeCode);
      if (result) {
        fund.lastNav = result.nav;
        fund.lastNavDate = new Date().toISOString();
        fund.lastValue = round2(fund.units * result.nav);
        updated++;
      } else {
        failed++;
      }
    }

    Store.save();
    return { updated, failed };
  }
};

function round2(n) {
  return Math.round(n * 100) / 100;
}
