/* ============================================================
   storage.js — local persistence layer
   Everything here talks to localStorage only. No network calls.
   ============================================================ */

const STORE_KEY = "commandCenter.data.v1";
const CONFIG_KEY = "commandCenter.config.v1"; // google client id, currency symbol
const SESSION_TOKEN_KEY = "commandCenter.session.googleToken"; // sessionStorage only

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultData() {
  return {
    mutualFunds: [],   // {id, name, schemeCode, units, lastNav, lastNavDate, lastValue}
    banks: [],         // {id, name, balance}
    providentFunds: [],// {id, name, value}
    otherAssets: [],   // {id, name, value}
    secondaryIncome: [], // {id, amount, note, date}
    goals: [],         // {id, name, category, targetAmount, currentAmount, deadline, status}
    taskConfig: {
      lists: []        // {googleListId, label, isSystem}
    },
    ui: {
      openCategories: { mutualFunds: true }
    }
  };
}

const Store = {
  _data: null,

  load() {
    if (this._data) return this._data;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this._data = raw ? Object.assign(defaultData(), JSON.parse(raw)) : defaultData();
      // shallow-merge nested defaults in case of older backups
      this._data.taskConfig = Object.assign({ lists: [] }, this._data.taskConfig || {});
      this._data.ui = Object.assign({ openCategories: {} }, this._data.ui || {});
    } catch (e) {
      console.warn("Could not read local data, starting fresh.", e);
      this._data = defaultData();
    }
    return this._data;
  },

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this._data));
      return true;
    } catch (e) {
      console.error("Local save failed", e);
      Toast.show("Couldn't save locally — your browser storage may be full.");
      return false;
    }
  },

  replaceAll(newData) {
    this._data = Object.assign(defaultData(), newData);
    this.save();
  }
};

const Config = {
  _cfg: null,
  load() {
    if (this._cfg) return this._cfg;
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      this._cfg = raw ? JSON.parse(raw) : {};
    } catch (e) {
      this._cfg = {};
    }
    if (!this._cfg.currencySymbol) this._cfg.currencySymbol = "₹";
    if (!this._cfg.displayName) this._cfg.displayName = "Puneetkumar";
    return this._cfg;
  },
  save() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this._cfg));
  },
  set(key, value) {
    this.load();
    this._cfg[key] = value;
    this.save();
  },
  get(key) {
    return this.load()[key];
  }
};

/* ---------------- formatting helpers ---------------- */

function formatMoney(n) {
  const symbol = Config.get("currencySymbol") || "₹";
  if (n === null || n === undefined || isNaN(n)) return symbol + "0";
  const rounded = Math.round(n);
  // Indian digit grouping (e.g. 12,34,567) when symbol is ₹, else plain grouping
  const isRupee = symbol === "₹";
  let str;
  if (isRupee) {
    str = rounded.toLocaleString("en-IN");
  } else {
    str = rounded.toLocaleString("en-US");
  }
  return symbol + str;
}

function relativeTime(dateIso) {
  if (!dateIso) return "No data yet";
  const d = new Date(dateIso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return "Today, " + time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday, " + time;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + ", " + time;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------------- toast ---------------- */

const Toast = {
  _t: null,
  show(msg, ms = 3200) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(this._t);
    this._t = setTimeout(() => el.classList.remove("show"), ms);
  }
};

/* ---------------- export / import ---------------- */

function exportBackup() {
  const data = Store.load();
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "commandCenter",
    version: 1,
    data: data
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `command-center-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  Toast.show("Backup exported.");
}

function importBackup(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const data = parsed && parsed.data ? parsed.data : parsed;
      if (!data || typeof data !== "object") throw new Error("bad file");
      Store.replaceAll(data);
      Toast.show("Backup restored.");
      if (onDone) onDone();
    } catch (e) {
      Toast.show("That file doesn't look like a valid backup.");
    }
  };
  reader.onerror = () => Toast.show("Couldn't read that file.");
  reader.readAsText(file);
}
