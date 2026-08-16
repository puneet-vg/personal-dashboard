/* ============================================================
   app.js — orchestration: finance, goals, modals, settings
   ============================================================ */

/* ---------------- Generic modal ---------------- */

const Modal = {
  open(title, bodyHtml) {
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalBody").innerHTML = bodyHtml;
    document.getElementById("modalOverlay").classList.remove("hidden");
  },
  close() {
    document.getElementById("modalOverlay").classList.add("hidden");
    document.getElementById("modalBody").innerHTML = "";
  }
};

document.getElementById("modalClose").addEventListener("click", Modal.close);
document.getElementById("modalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "modalOverlay") Modal.close();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { Modal.close(); document.getElementById("settingsOverlay").classList.add("hidden"); }
});

/* ---------------- Finance: category config ---------------- */

const FIN_CATEGORIES = [
  { key: "mutualFunds", name: "Mutual Funds", addLabel: "Add Mutual Fund" },
  { key: "banks", name: "Bank", addLabel: "Add Bank" },
  { key: "providentFunds", name: "Provident Fund", addLabel: "Add Provident Fund" },
  { key: "otherAssets", name: "Other Assets", addLabel: "Add Asset" }
];

function categoryTotal(key) {
  const data = Store.load();
  const items = data[key] || [];
  if (key === "mutualFunds") {
    return items.reduce((sum, f) => sum + (f.lastValue || 0), 0);
  }
  const valueField = key === "banks" ? "balance" : "value";
  return items.reduce((sum, it) => sum + (Number(it[valueField]) || 0), 0);
}

function computeNetWorth() {
  return FIN_CATEGORIES.reduce((sum, c) => sum + categoryTotal(c.key), 0);
}

function renderNetWorth() {
  const total = computeNetWorth();
  document.getElementById("netWorthAmount").textContent = formatMoney(total);
  const mfList = Store.load().mutualFunds;
  const mostRecent = mfList
    .map(f => f.lastNavDate)
    .filter(Boolean)
    .sort()
    .pop();
  const label = mostRecent ? "Updated " + relativeTime(mostRecent).toLowerCase() : "Add your accounts to see your net worth";
  document.getElementById("netWorthUpdated").textContent = label;
}

/* ---------------- Finance: render categories ---------------- */

function renderFinance() {
  const data = Store.load();
  const wrap = document.getElementById("financeCategories");
  wrap.innerHTML = FIN_CATEGORIES.map(cat => {
    const isOpen = !!data.ui.openCategories[cat.key];
    const total = categoryTotal(cat.key);
    return `
      <div class="fin-cat ${isOpen ? "open" : ""}" data-cat="${cat.key}">
        <div class="fin-cat-head" data-toggle="${cat.key}">
          <div class="fin-cat-left">
            <svg class="fin-cat-chevron" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="fin-cat-name">${cat.name}</span>
          </div>
          <div class="fin-cat-right">
            <span class="fin-cat-value">${formatMoney(total)}</span>
          </div>
        </div>
        <div class="fin-cat-body">
          <div class="fin-cat-body-inner" data-body="${cat.key}"></div>
        </div>
      </div>`;
  }).join("");

  FIN_CATEGORIES.forEach(cat => renderCategoryItems(cat.key));

  wrap.querySelectorAll("[data-toggle]").forEach(head => {
    head.addEventListener("click", () => {
      const key = head.getAttribute("data-toggle");
      const catEl = wrap.querySelector(`.fin-cat[data-cat="${key}"]`);
      const bodyEl = catEl.querySelector(".fin-cat-body");
      const isOpen = catEl.classList.contains("open");
      if (isOpen) {
        bodyEl.style.maxHeight = bodyEl.scrollHeight + "px";
        requestAnimationFrame(() => { bodyEl.style.maxHeight = "0px"; });
        catEl.classList.remove("open");
      } else {
        catEl.classList.add("open");
        bodyEl.style.maxHeight = bodyEl.scrollHeight + "px";
        setTimeout(() => { if (catEl.classList.contains("open")) bodyEl.style.maxHeight = "none"; }, 230);
      }
      const d = Store.load();
      d.ui.openCategories[key] = !isOpen;
      Store.save();
    });
  });

  // set initial max-height for open ones
  wrap.querySelectorAll(".fin-cat.open .fin-cat-body").forEach(b => { b.style.maxHeight = "none"; });

  renderNetWorth();
}

function renderCategoryItems(key) {
  const data = Store.load();
  const items = data[key] || [];
  const container = document.querySelector(`[data-body="${key}"]`);
  if (!container) return;

  const cat = FIN_CATEGORIES.find(c => c.key === key);

  if (!items.length) {
    container.innerHTML = `<p class="fin-empty">Nothing here yet.</p>
      <button class="add-row-btn" data-add="${key}">+ ${cat.addLabel}</button>`;
  } else {
    container.innerHTML = items.map(it => renderFinItemRow(key, it)).join("") +
      `<button class="add-row-btn" data-add="${key}">+ ${cat.addLabel}</button>`;
  }

  const addBtn = container.querySelector(`[data-add="${key}"]`);
  addBtn.addEventListener("click", () => openFinItemModal(key, null));

  container.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => openFinItemModal(key, btn.getAttribute("data-edit")));
  });
  container.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => deleteFinItem(key, btn.getAttribute("data-del")));
  });
}

function renderFinItemRow(key, it) {
  if (key === "mutualFunds") {
    const sub = it.lastNavDate
      ? `NAV updated ${relativeTime(it.lastNavDate).toLowerCase()}`
      : "Fetching NAV…";
    return `
      <div class="fin-item-row">
        <div class="fin-item-main">
          <div class="fin-item-name">${escapeHtml(it.name)}</div>
          <div class="fin-item-sub">${it.units} units · ${sub}</div>
        </div>
        <div class="fin-item-right">
          <span class="fin-item-value">${formatMoney(it.lastValue || 0)}</span>
          <div class="row-actions">
            <button class="row-icon-btn" data-edit="${it.id}" title="Edit">✎</button>
            <button class="row-icon-btn danger" data-del="${it.id}" title="Delete">🗑</button>
          </div>
        </div>
      </div>`;
  }
  const valueField = key === "banks" ? "balance" : "value";
  return `
    <div class="fin-item-row">
      <div class="fin-item-main">
        <div class="fin-item-name">${escapeHtml(it.name)}</div>
      </div>
      <div class="fin-item-right">
        <span class="fin-item-value">${formatMoney(it[valueField] || 0)}</span>
        <div class="row-actions">
          <button class="row-icon-btn" data-edit="${it.id}" title="Edit">✎</button>
          <button class="row-icon-btn danger" data-del="${it.id}" title="Delete">🗑</button>
        </div>
      </div>
    </div>`;
}

function deleteFinItem(key, id) {
  const data = Store.load();
  data[key] = data[key].filter(it => it.id !== id);
  Store.save();
  renderCategoryItems(key);
  renderFinance();
}

/* ---------------- Finance: add/edit modals ---------------- */

function openFinItemModal(key, id) {
  const data = Store.load();
  const existing = id ? data[key].find(it => it.id === id) : null;

  if (key === "mutualFunds") return openMutualFundModal(existing);

  const label = key === "banks" ? "Bank name" : (key === "providentFunds" ? "Name" : "Asset name");
  const valueLabel = key === "banks" ? "Current balance" : "Current value";
  const valueField = key === "banks" ? "balance" : "value";

  Modal.open(existing ? "Edit" : (FIN_CATEGORIES.find(c => c.key === key).addLabel), `
    <label class="field-label">${label}
      <input class="field-input" id="finName" value="${existing ? escapeHtml(existing.name) : ""}" />
    </label>
    <label class="field-label">${valueLabel}
      <input class="field-input" type="number" step="0.01" id="finValue" value="${existing ? existing[valueField] : ""}" />
    </label>
    <button class="btn btn-primary btn-full" id="finSaveBtn">Save</button>
  `);

  document.getElementById("finSaveBtn").addEventListener("click", () => {
    const name = document.getElementById("finName").value.trim();
    const value = parseFloat(document.getElementById("finValue").value);
    if (!name) { Toast.show("Please enter a name."); return; }
    if (isNaN(value) || value < 0) { Toast.show("Please enter a valid amount."); return; }

    const d = Store.load();
    if (existing) {
      existing.name = name;
      existing[valueField] = value;
    } else {
      const item = { id: uid(), name };
      item[valueField] = value;
      d[key].push(item);
    }
    Store.save();
    Modal.close();
    renderCategoryItems(key);
    renderFinance();
  });
}

function openMutualFundModal(existing) {
  Modal.open(existing ? "Edit Mutual Fund" : "Add Mutual Fund", `
    <label class="field-label">Fund name
      <input class="field-input" id="mfName" placeholder="Start typing to search…" value="${existing ? escapeHtml(existing.name) : ""}" autocomplete="off" />
    </label>
    <div class="mf-search-results hidden" id="mfResults"></div>
    <label class="field-label">Number of units
      <input class="field-input" type="number" step="0.001" id="mfUnits" value="${existing ? existing.units : ""}" />
    </label>
    <p class="muted small" id="mfSelectedNote">${existing ? "Linked to scheme code " + escapeHtml(existing.schemeCode || "—") : "Pick a fund from the search results so we can fetch its NAV automatically."}</p>
    <button class="btn btn-primary btn-full" id="mfSaveBtn">Save</button>
  `);

  let selected = existing ? { schemeCode: existing.schemeCode, schemeName: existing.name } : null;
  const nameInput = document.getElementById("mfName");
  const resultsEl = document.getElementById("mfResults");
  const note = document.getElementById("mfSelectedNote");
  let searchTimer = null;

  nameInput.addEventListener("input", () => {
    selected = null;
    note.textContent = "Pick a fund from the search results so we can fetch its NAV automatically.";
    clearTimeout(searchTimer);
    const q = nameInput.value;
    searchTimer = setTimeout(async () => {
      const results = await MutualFundAPI.search(q);
      if (!results.length) { resultsEl.classList.add("hidden"); resultsEl.innerHTML = ""; return; }
      resultsEl.innerHTML = results.map(r => `<div class="mf-search-result" data-code="${escapeHtml(r.schemeCode)}" data-name="${escapeHtml(r.schemeName)}">${escapeHtml(r.schemeName)}</div>`).join("");
      resultsEl.classList.remove("hidden");
      resultsEl.querySelectorAll(".mf-search-result").forEach(el => {
        el.addEventListener("click", () => {
          selected = { schemeCode: el.getAttribute("data-code"), schemeName: el.getAttribute("data-name") };
          nameInput.value = selected.schemeName;
          resultsEl.classList.add("hidden");
          note.textContent = "Linked to scheme code " + selected.schemeCode;
        });
      });
    }, 350);
  });

  document.getElementById("mfSaveBtn").addEventListener("click", async () => {
    const units = parseFloat(document.getElementById("mfUnits").value);
    if (isNaN(units) || units <= 0) { Toast.show("Please enter a valid number of units."); return; }
    if (!selected && !existing) { Toast.show("Please pick a fund from the search results."); return; }

    const d = Store.load();
    let fund;
    if (existing) {
      fund = d.mutualFunds.find(f => f.id === existing.id);
      fund.units = units;
      if (selected) { fund.schemeCode = selected.schemeCode; fund.name = selected.schemeName; }
    } else {
      fund = { id: uid(), name: selected.schemeName, schemeCode: selected.schemeCode, units, lastNav: null, lastNavDate: null, lastValue: 0 };
      d.mutualFunds.push(fund);
    }
    Store.save();
    Modal.close();
    renderCategoryItems("mutualFunds");
    renderFinance();

    const result = await MutualFundAPI.fetchLatestNav(fund.schemeCode);
    if (result) {
      fund.lastNav = result.nav;
      fund.lastNavDate = new Date().toISOString();
      fund.lastValue = Math.round(fund.units * result.nav * 100) / 100;
      Store.save();
      renderCategoryItems("mutualFunds");
      renderFinance();
    } else {
      Toast.show("Couldn't fetch NAV right now — will retry automatically.");
    }
  });
}

/* ---------------- Secondary Income ---------------- */

function computeIncomeTotal() {
  const data = Store.load();
  return (data.secondaryIncome || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

function renderIncome() {
  const data = Store.load();
  const entries = data.secondaryIncome || [];
  const total = computeIncomeTotal();

  document.getElementById("incomeTotalAmount").textContent = formatMoney(total);
  const mostRecent = entries.map(e => e.date).filter(Boolean).sort().pop();
  document.getElementById("incomeUpdated").textContent = mostRecent
    ? "Last added " + relativeTime(mostRecent).toLowerCase()
    : "No entries yet";

  const list = document.getElementById("incomeList");
  if (!entries.length) {
    list.innerHTML = `<p class="fin-empty">No secondary income added yet.</p>`;
    return;
  }
  // most recent first
  const sorted = [...entries].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  list.innerHTML = sorted.map(e => `
    <div class="fin-item-row">
      <div class="fin-item-main">
        <div class="fin-item-name">${escapeHtml(e.note || "Secondary income")}</div>
        <div class="fin-item-sub">${e.date ? relativeTime(e.date) : ""}</div>
      </div>
      <div class="fin-item-right">
        <span class="fin-item-value">${formatMoney(e.amount)}</span>
        <div class="row-actions">
          <button class="row-icon-btn" data-income-edit="${e.id}" title="Edit">✎</button>
          <button class="row-icon-btn danger" data-income-del="${e.id}" title="Delete">🗑</button>
        </div>
      </div>
    </div>
  `).join("");

  list.querySelectorAll("[data-income-edit]").forEach(btn => {
    btn.addEventListener("click", () => openIncomeModal(btn.getAttribute("data-income-edit")));
  });
  list.querySelectorAll("[data-income-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const d = Store.load();
      d.secondaryIncome = d.secondaryIncome.filter(e => e.id !== btn.getAttribute("data-income-del"));
      Store.save();
      renderIncome();
    });
  });
}

function openIncomeModal(id) {
  const data = Store.load();
  const existing = id ? data.secondaryIncome.find(e => e.id === id) : null;

  Modal.open(existing ? "Edit Secondary Income" : "Add Secondary Income", `
    <label class="field-label">Amount (added to your running total)
      <input class="field-input" type="number" step="0.01" id="incomeAmount" value="${existing ? existing.amount : ""}" placeholder="e.g. 15000" />
    </label>
    <label class="field-label">Source / note (optional)
      <input class="field-input" id="incomeNote" value="${existing ? escapeHtml(existing.note || "") : ""}" placeholder="e.g. Freelance project" />
    </label>
    <button class="btn btn-primary btn-full" id="incomeSaveBtn">Save</button>
  `);

  document.getElementById("incomeSaveBtn").addEventListener("click", () => {
    const amount = parseFloat(document.getElementById("incomeAmount").value);
    const note = document.getElementById("incomeNote").value.trim();
    if (isNaN(amount) || amount <= 0) { Toast.show("Please enter a valid amount."); return; }

    const d = Store.load();
    if (existing) {
      existing.amount = amount;
      existing.note = note;
    } else {
      d.secondaryIncome.push({ id: uid(), amount, note, date: new Date().toISOString() });
    }
    Store.save();
    Modal.close();
    renderIncome();
    Toast.show(existing ? "Entry updated." : "Added to your secondary income total.");
  });
}

/* ---------------- Goals ---------------- */

function renderGoals() {
  const data = Store.load();
  const grid = document.getElementById("goalsGrid");
  const empty = document.getElementById("goalsEmpty");

  if (!data.goals.length) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = data.goals.map(g => {
    const target = Number(g.targetAmount) || 0;
    const current = Number(g.currentAmount) || 0;
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    return `
      <div class="goal-card">
        <div class="goal-top">
          <span class="goal-name">${escapeHtml(g.name)}</span>
          ${g.category ? `<span class="goal-cat">${escapeHtml(g.category)}</span>` : ""}
        </div>
        ${target > 0 ? `
          <div class="goal-progress-track"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
          <div class="goal-meta">
            <span class="amt">${formatMoney(current)} / ${formatMoney(target)}</span>
            <span>${pct}%</span>
          </div>` : `<div class="goal-meta"><span>${escapeHtml(g.status || "In progress")}</span></div>`}
        ${g.deadline ? `<span class="goal-deadline">Target: ${new Date(g.deadline).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</span>` : ""}
        <div class="goal-card-actions">
          <button class="row-icon-btn" data-goal-edit="${g.id}" title="Edit">✎</button>
          <button class="row-icon-btn danger" data-goal-del="${g.id}" title="Delete">🗑</button>
        </div>
      </div>`;
  }).join("");

  grid.querySelectorAll("[data-goal-edit]").forEach(btn => {
    btn.addEventListener("click", () => openGoalModal(btn.getAttribute("data-goal-edit")));
  });
  grid.querySelectorAll("[data-goal-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const d = Store.load();
      d.goals = d.goals.filter(g => g.id !== btn.getAttribute("data-goal-del"));
      Store.save();
      renderGoals();
    });
  });
}

function openGoalModal(id) {
  const data = Store.load();
  const existing = id ? data.goals.find(g => g.id === id) : null;

  Modal.open(existing ? "Edit Goal" : "Add Goal", `
    <label class="field-label">Goal name
      <input class="field-input" id="goalName" value="${existing ? escapeHtml(existing.name) : ""}" placeholder="e.g. Buy MacBook" />
    </label>
    <label class="field-label">Category
      <select class="field-select" id="goalCategory">
        <option value="Financial" ${existing?.category === "Financial" ? "selected" : ""}>Financial</option>
        <option value="Purchase" ${existing?.category === "Purchase" ? "selected" : ""}>Purchase</option>
        <option value="Life" ${existing?.category === "Life" ? "selected" : ""}>Life</option>
      </select>
    </label>
    <label class="field-label">Target amount (optional)
      <input class="field-input" type="number" step="0.01" id="goalTarget" value="${existing?.targetAmount ?? ""}" />
    </label>
    <label class="field-label">Current progress
      <input class="field-input" type="number" step="0.01" id="goalCurrent" value="${existing?.currentAmount ?? ""}" />
    </label>
    <label class="field-label">Deadline (optional)
      <input class="field-input" type="date" id="goalDeadline" value="${existing?.deadline ? existing.deadline.slice(0, 10) : ""}" />
    </label>
    <label class="field-label">Status
      <select class="field-select" id="goalStatus">
        <option value="Not started" ${existing?.status === "Not started" ? "selected" : ""}>Not started</option>
        <option value="In progress" ${!existing || existing?.status === "In progress" ? "selected" : ""}>In progress</option>
        <option value="Achieved" ${existing?.status === "Achieved" ? "selected" : ""}>Achieved</option>
      </select>
    </label>
    <button class="btn btn-primary btn-full" id="goalSaveBtn">Save</button>
  `);

  document.getElementById("goalSaveBtn").addEventListener("click", () => {
    const name = document.getElementById("goalName").value.trim();
    if (!name) { Toast.show("Please name the goal."); return; }
    const targetAmount = parseFloat(document.getElementById("goalTarget").value) || 0;
    const currentAmount = parseFloat(document.getElementById("goalCurrent").value) || 0;
    const deadline = document.getElementById("goalDeadline").value || null;
    const category = document.getElementById("goalCategory").value;
    const status = document.getElementById("goalStatus").value;

    const d = Store.load();
    if (existing) {
      Object.assign(existing, { name, targetAmount, currentAmount, deadline, category, status });
    } else {
      d.goals.push({ id: uid(), name, targetAmount, currentAmount, deadline, category, status });
    }
    Store.save();
    Modal.close();
    renderGoals();
  });
}

/* ---------------- Settings ---------------- */

function initSettings() {
  const overlay = document.getElementById("settingsOverlay");
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("googleClientIdInput").value = Config.get("googleClientId") || "";
    document.getElementById("currencySymbolInput").value = Config.get("currencySymbol") || "₹";
    document.getElementById("displayNameInput").value = Config.get("displayName") || "Puneetkumar";
    overlay.classList.remove("hidden");
  });
  document.getElementById("settingsClose").addEventListener("click", () => overlay.classList.add("hidden"));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.add("hidden"); });

  document.getElementById("saveDisplayNameBtn").addEventListener("click", () => {
    const val = document.getElementById("displayNameInput").value.trim() || "there";
    Config.set("displayName", val);
    Toast.show("Saved.");
    updateGreeting();
  });

  document.getElementById("saveClientIdBtn").addEventListener("click", () => {
    const val = document.getElementById("googleClientIdInput").value.trim();
    Config.set("googleClientId", val);
    Toast.show("Saved. Reconnecting Google Tasks…");
    overlay.classList.add("hidden");
    TasksUI.boot();
  });

  document.getElementById("saveCurrencyBtn").addEventListener("click", () => {
    const val = document.getElementById("currencySymbolInput").value.trim() || "₹";
    Config.set("currencySymbol", val);
    Toast.show("Saved.");
    renderFinance();
    renderGoals();
    renderIncome();
  });

  document.getElementById("disconnectTasksBtn").addEventListener("click", () => {
    GoogleAuth.signOut();
    const d = Store.load();
    d.taskConfig.lists = [];
    Store.save();
    TasksUI.taskCache = {};
    Toast.show("Disconnected Google Tasks.");
    overlay.classList.add("hidden");
    TasksUI.boot();
  });
}

/* ---------------- Greeting + live clock ---------------- */

function updateGreeting() {
  const name = Config.get("displayName") || "Puneetkumar";
  document.getElementById("greetName").textContent = name;

  const hour = new Date().getHours();
  const period = hour < 12 ? "Good Morning" : (hour < 17 ? "Good Afternoon" : "Good Evening");
  document.getElementById("greetPeriod").textContent = period;
}

function tickClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const el = document.getElementById("liveClock");
  if (el) el.textContent = `${hh}:${mm}:${ss}`;
}

/* ---------------- Export / Import wiring ---------------- */

function initBackup() {
  document.getElementById("exportBtn").addEventListener("click", exportBackup);
  document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importBackup(file, () => {
      renderFinance();
      renderGoals();
    });
    e.target.value = "";
  });
}

/* ---------------- Tasks wiring ---------------- */

function initTasksPanel() {
  document.getElementById("connectTasksBtn").addEventListener("click", () => TasksUI.connect());
  document.getElementById("addListBtn").addEventListener("click", () => TasksUI.openAddListPicker());
  document.getElementById("tasksRefreshBtn").addEventListener("click", () => TasksUI.refresh());
}

/* ---------------- Mutual fund auto-refresh ---------------- */

async function autoRefreshNavs(showToastIfEmpty) {
  const data = Store.load();
  if (!data.mutualFunds.length) return;
  const footEl = document.getElementById("mfStatusFoot");
  footEl.textContent = "Updating mutual fund values…";
  const { updated, failed } = await MutualFundAPI.refreshAll();
  renderCategoryItems("mutualFunds");
  renderFinance();
  if (updated > 0) {
    footEl.textContent = `Mutual fund NAVs last updated ${relativeTime(new Date().toISOString()).toLowerCase()}.`;
  } else if (failed > 0) {
    footEl.textContent = "Mutual fund values couldn't be updated. Showing your last available values.";
  } else {
    footEl.textContent = "";
  }
}

/* ---------------- Init ---------------- */

function setTodayLabel() {
  const el = document.getElementById("todayLabel");
  el.textContent = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

document.addEventListener("DOMContentLoaded", () => {
  Store.load();
  Config.load();

  setTodayLabel();
  updateGreeting();
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(updateGreeting, 60 * 1000); // keep "Good Morning/Afternoon/Evening" current

  renderFinance();
  renderGoals();
  renderIncome();
  initSettings();
  initBackup();
  initTasksPanel();

  document.getElementById("addGoalBtn").addEventListener("click", () => openGoalModal(null));
  document.getElementById("addIncomeBtn").addEventListener("click", () => openIncomeModal(null));

  TasksUI.boot();

  // Refresh NAVs on load, then every 30 minutes while the tab stays open.
  autoRefreshNavs();
  setInterval(autoRefreshNavs, 30 * 60 * 1000);

  // Refresh Google Tasks silently every 10 minutes while the tab stays open.
  setInterval(() => { if (GoogleAuth.hasValidToken()) TasksUI.refresh(); }, 10 * 60 * 1000);
});
