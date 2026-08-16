/* ============================================================
   tasks.js — Google Tasks integration
   ------------------------------------------------------------
   Auth: uses Google Identity Services' OAuth "token client".
   This is the flow Google recommends for pure static/browser
   apps — it needs only a public OAuth Client ID (no client
   secret, no server). The access token lives in memory and
   sessionStorage only; it is never written to the exportable
   backup and never leaves the browser except to talk to
   Google's own Tasks API.
   Scope requested: https://www.googleapis.com/auth/tasks
   (read + write your task lists — nothing broader).
   ============================================================ */

const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const TASKS_API = "https://tasks.googleapis.com/tasks/v1";

const GoogleAuth = {
  tokenClient: null,
  accessToken: null,
  expiresAt: 0,

  init(clientId) {
    if (!window.google || !google.accounts || !google.accounts.oauth2) return false;
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: TASKS_SCOPE,
      prompt: "",
      callback: () => {} // overridden per-call below
    });
    // restore session token if still valid
    try {
      const raw = sessionStorage.getItem(SESSION_TOKEN_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.expiresAt > Date.now()) {
          this.accessToken = saved.accessToken;
          this.expiresAt = saved.expiresAt;
        }
      }
    } catch (e) { /* ignore */ }
    return true;
  },

  hasValidToken() {
    return !!this.accessToken && Date.now() < this.expiresAt - 30000;
  },

  requestToken(interactive) {
    return new Promise((resolve, reject) => {
      if (!this.tokenClient) return reject(new Error("no-client"));
      this.tokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          this.accessToken = resp.access_token;
          this.expiresAt = Date.now() + (parseInt(resp.expires_in || "3600", 10) * 1000);
          try {
            sessionStorage.setItem(SESSION_TOKEN_KEY, JSON.stringify({
              accessToken: this.accessToken,
              expiresAt: this.expiresAt
            }));
          } catch (e) { /* ignore */ }
          resolve(this.accessToken);
        } else {
          reject(new Error("no-token"));
        }
      };
      this.tokenClient.error_callback = () => reject(new Error("auth-failed"));
      this.tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
    });
  },

  async ensureToken(interactive) {
    if (this.hasValidToken()) return this.accessToken;
    return this.requestToken(interactive);
  },

  signOut() {
    if (this.accessToken && window.google && google.accounts && google.accounts.oauth2) {
      google.accounts.oauth2.revoke(this.accessToken, () => {});
    }
    this.accessToken = null;
    this.expiresAt = 0;
    try { sessionStorage.removeItem(SESSION_TOKEN_KEY); } catch (e) {}
  }
};

const TasksAPI = {
  async _call(path, opts = {}) {
    const token = await GoogleAuth.ensureToken(false).catch(() => GoogleAuth.ensureToken(true));
    const res = await fetch(TASKS_API + path, {
      ...opts,
      headers: Object.assign(
        { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        opts.headers || {}
      )
    });
    if (res.status === 401) {
      // token expired mid-flight — refresh once and retry
      await GoogleAuth.requestToken(false);
      return this._call(path, opts);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("tasks-api-error " + res.status + " " + text);
    }
    if (res.status === 204) return null;
    return res.json();
  },

  listTaskLists() {
    return this._call("/users/@me/lists").then(r => (r && r.items) || []);
  },
  listTasks(listId) {
    return this._call(`/lists/${encodeURIComponent(listId)}/tasks?showCompleted=true&showHidden=true&maxResults=100`)
      .then(r => (r && r.items) || []);
  },
  insertTask(listId, task) {
    return this._call(`/lists/${encodeURIComponent(listId)}/tasks`, {
      method: "POST",
      body: JSON.stringify(task)
    });
  },
  patchTask(listId, taskId, patch) {
    return this._call(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  },
  deleteTask(listId, taskId) {
    return this._call(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE"
    });
  }
};

/* ============================================================
   TasksUI — everything that renders in the Tasks panel
   ============================================================ */

const TasksUI = {
  googleLists: [],       // raw lists from Google (cache)
  activeListId: null,
  taskCache: {},         // listId -> tasks[]

  async boot() {
    const clientId = Config.get("googleClientId");
    const authGate = document.getElementById("tasksAuthGate");
    const app = document.getElementById("tasksApp");
    const note = document.getElementById("tasksAuthNote");

    if (!clientId) {
      authGate.classList.remove("hidden");
      app.classList.add("hidden");
      note.textContent = "You'll need a free Google OAuth Client ID first — see Settings (gear icon) or README.md.";
      return;
    }

    GoogleAuth.init(clientId);

    const cfg = Store.load().taskConfig;
    if (cfg.lists && cfg.lists.length && GoogleAuth.hasValidToken()) {
      authGate.classList.add("hidden");
      app.classList.remove("hidden");
      await this.renderTabs();
      return;
    }

    if (cfg.lists && cfg.lists.length) {
      // We have configured lists but no live session — try a silent
      // token refresh; fall back to the connect button if it fails.
      try {
        await GoogleAuth.ensureToken(false);
        authGate.classList.add("hidden");
        app.classList.remove("hidden");
        await this.renderTabs();
        return;
      } catch (e) {
        note.textContent = "Session expired — reconnect to keep syncing.";
      }
    }

    authGate.classList.remove("hidden");
    app.classList.add("hidden");
  },

  async connect() {
    const clientId = Config.get("googleClientId");
    if (!clientId) {
      Toast.show("Add your Google OAuth Client ID in Settings first.");
      document.getElementById("settingsOverlay").classList.remove("hidden");
      return;
    }
    if (!GoogleAuth.tokenClient) GoogleAuth.init(clientId);
    try {
      await GoogleAuth.requestToken(true);
    } catch (e) {
      Toast.show("Couldn't connect to Google Tasks. Please try again.");
      return;
    }
    try {
      this.googleLists = await TasksAPI.listTaskLists();
    } catch (e) {
      Toast.show("Connected, but couldn't load your task lists.");
      return;
    }
    this.openListSetup();
  },

  /** First-run picker: choose which existing Google Tasks lists map to Personal / Work. */
  openListSetup() {
    const lists = this.googleLists;
    if (!lists.length) {
      Toast.show("No Google Tasks lists found in your account.");
      return;
    }
    const options = lists.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.title)}</option>`).join("");
    Modal.open("Connect your task lists", `
      <p class="muted small">Pick your existing Google Tasks lists. You can add more later with "+ Add list".</p>
      <label class="field-label">Personal
        <select class="field-select" id="setupPersonal">${options}</select>
      </label>
      <label class="field-label">Work
        <select class="field-select" id="setupWork">${options}</select>
      </label>
      <button class="btn btn-primary btn-full" id="setupSaveBtn">Save and connect</button>
    `);
    document.getElementById("setupWork").selectedIndex = Math.min(1, lists.length - 1);
    document.getElementById("setupSaveBtn").addEventListener("click", () => {
      const personalId = document.getElementById("setupPersonal").value;
      const workId = document.getElementById("setupWork").value;
      const personal = lists.find(l => l.id === personalId);
      const work = lists.find(l => l.id === workId);
      const data = Store.load();
      data.taskConfig.lists = [];
      if (personal) data.taskConfig.lists.push({ googleListId: personal.id, label: "Personal" });
      if (work && work.id !== personal?.id) data.taskConfig.lists.push({ googleListId: work.id, label: "Work" });
      else if (work && work.id === personal?.id) Toast.show("Personal and Work were the same list — using it once.");
      Store.save();
      Modal.close();
      document.getElementById("tasksAuthGate").classList.add("hidden");
      document.getElementById("tasksApp").classList.remove("hidden");
      this.renderTabs();
    });
  },

  async openAddListPicker() {
    try {
      if (!this.googleLists.length) this.googleLists = await TasksAPI.listTaskLists();
    } catch (e) {
      Toast.show("Couldn't load your Google Tasks lists.");
      return;
    }
    const cfg = Store.load().taskConfig;
    const already = new Set(cfg.lists.map(l => l.googleListId));
    const remaining = this.googleLists.filter(l => !already.has(l.id));
    if (!remaining.length) {
      Toast.show("All your Google Tasks lists are already added.");
      return;
    }
    const options = remaining.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.title)}</option>`).join("");
    Modal.open("Add a list", `
      <label class="field-label">Google Tasks list
        <select class="field-select" id="addListSelect">${options}</select>
      </label>
      <label class="field-label">Label on dashboard
        <input class="field-input" id="addListLabel" placeholder="e.g. Learning" />
      </label>
      <button class="btn btn-primary btn-full" id="addListSaveBtn">Add list</button>
    `);
    document.getElementById("addListSelect").addEventListener("change", (e) => {
      const match = remaining.find(l => l.id === e.target.value);
      document.getElementById("addListLabel").value = match ? match.title : "";
    });
    document.getElementById("addListLabel").value = remaining[0].title;
    document.getElementById("addListSaveBtn").addEventListener("click", () => {
      const id = document.getElementById("addListSelect").value;
      const label = document.getElementById("addListLabel").value.trim() || "List";
      const data = Store.load();
      data.taskConfig.lists.push({ googleListId: id, label });
      Store.save();
      Modal.close();
      this.renderTabs();
    });
  },

  async renderTabs() {
    const cfg = Store.load().taskConfig;
    const tabWrap = document.getElementById("taskTabs");
    if (!cfg.lists.length) {
      tabWrap.innerHTML = "";
      document.getElementById("taskListBody").innerHTML = `<p class="empty-hint">No lists connected yet.</p>`;
      return;
    }
    if (!this.activeListId || !cfg.lists.some(l => l.googleListId === this.activeListId)) {
      this.activeListId = cfg.lists[0].googleListId;
    }
    tabWrap.innerHTML = cfg.lists.map(l => `
      <button class="task-tab ${l.googleListId === this.activeListId ? "active" : ""}" data-list="${escapeHtml(l.googleListId)}">
        ${escapeHtml(l.label)}
      </button>
    `).join("");
    tabWrap.querySelectorAll(".task-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        this.activeListId = btn.getAttribute("data-list");
        this.renderTabs();
      });
    });
    await this.renderTaskBody();
  },

  async renderTaskBody() {
    const body = document.getElementById("taskListBody");
    const cfg = Store.load().taskConfig;
    const listMeta = cfg.lists.find(l => l.googleListId === this.activeListId);
    if (!listMeta) { body.innerHTML = ""; return; }

    let tasks = this.taskCache[this.activeListId];
    if (!tasks) {
      body.innerHTML = `<p class="empty-hint">Loading tasks…</p>`;
      try {
        tasks = await TasksAPI.listTasks(this.activeListId);
        this.taskCache[this.activeListId] = tasks;
      } catch (e) {
        body.innerHTML = `<p class="empty-hint">Couldn't load this list right now. Try Refresh.</p>`;
        return;
      }
    }
    this.paint(tasks);
  },

  paint(tasks) {
    const body = document.getElementById("taskListBody");
    const now = new Date();
    const todayStr = now.toDateString();

    const pending = tasks.filter(t => t.status !== "completed");
    const completed = tasks.filter(t => t.status === "completed");

    const groups = { overdue: [], today: [], upcoming: [], noDate: [] };
    pending.forEach(t => {
      if (!t.due) { groups.noDate.push(t); return; }
      const due = new Date(t.due);
      if (due.toDateString() === todayStr) groups.today.push(t);
      else if (due < now) groups.overdue.push(t);
      else groups.upcoming.push(t);
    });

    const groupHtml = (label, list, overdueStyle) => {
      if (!list.length) return "";
      return `
        <div class="task-group">
          <div class="task-group-label ${overdueStyle ? "overdue" : ""}">${label} · ${list.length}</div>
          ${list.map(t => this.taskRowHtml(t)).join("")}
        </div>`;
    };

    let html = "";
    html += groupHtml("Overdue", groups.overdue, true);
    html += groupHtml("Today", groups.today, false);
    html += groupHtml("Upcoming", groups.upcoming, false);
    html += groupHtml("No due date", groups.noDate, false);

    if (!pending.length) {
      html += `<p class="empty-hint">Nothing pending here.</p>`;
    }

    html += `
      <div class="task-add-row">
        <input type="text" class="task-add-input" id="newTaskTitle" placeholder="Add a task and press Enter" />
        <input type="date" class="field-input" id="newTaskDue" style="max-width:150px;" />
      </div>`;

    if (completed.length) {
      html += `<button class="text-btn" id="toggleCompletedBtn" style="margin-top:4px;">Show ${completed.length} completed</button>
                <div id="completedWrap" class="hidden"></div>`;
    }

    body.innerHTML = html;

    body.querySelectorAll(".task-check").forEach(el => {
      el.addEventListener("click", () => this.toggleComplete(el.getAttribute("data-id"), el.classList.contains("checked")));
    });
    body.querySelectorAll(".task-title").forEach(el => {
      el.addEventListener("click", () => this.openEditTask(el.getAttribute("data-id")));
    });

    const input = document.getElementById("newTaskTitle");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && input.value.trim()) this.addTask(input.value.trim(), document.getElementById("newTaskDue").value);
      });
    }

    const toggleBtn = document.getElementById("toggleCompletedBtn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        const wrap = document.getElementById("completedWrap");
        const isHidden = wrap.classList.contains("hidden");
        if (isHidden) {
          wrap.innerHTML = completed.map(t => this.taskRowHtml(t)).join("");
          wrap.querySelectorAll(".task-check").forEach(el => {
            el.addEventListener("click", () => this.toggleComplete(el.getAttribute("data-id"), el.classList.contains("checked")));
          });
          wrap.querySelectorAll(".task-title").forEach(el => {
            el.addEventListener("click", () => this.openEditTask(el.getAttribute("data-id")));
          });
        }
        wrap.classList.toggle("hidden");
        toggleBtn.textContent = isHidden ? "Hide completed" : `Show ${completed.length} completed`;
      });
    }
  },

  taskRowHtml(t) {
    const done = t.status === "completed";
    const due = t.due ? new Date(t.due) : null;
    const overdue = due && !done && due < new Date() && due.toDateString() !== new Date().toDateString();
    return `
      <div class="task-row ${done ? "done" : ""}">
        <div class="task-check ${done ? "checked" : ""}" data-id="${escapeHtml(t.id)}">${done ? "✓" : ""}</div>
        <div class="task-main">
          <div class="task-title" data-id="${escapeHtml(t.id)}">${escapeHtml(t.title || "(untitled task)")}</div>
          ${due ? `<div class="task-due ${overdue ? "overdue" : ""}">${due.toLocaleDateString([], { day: "numeric", month: "short" })}</div>` : ""}
        </div>
      </div>`;
  },

  findTask(id) {
    const list = this.taskCache[this.activeListId] || [];
    return list.find(t => t.id === id);
  },

  async toggleComplete(id, wasChecked) {
    const task = this.findTask(id);
    if (!task) return;
    const newStatus = wasChecked ? "needsAction" : "completed";
    task.status = newStatus; // optimistic
    this.paint(this.taskCache[this.activeListId]);
    try {
      await TasksAPI.patchTask(this.activeListId, id, { status: newStatus });
    } catch (e) {
      Toast.show("Couldn't sync that change to Google Tasks.");
      task.status = wasChecked ? "completed" : "needsAction";
      this.paint(this.taskCache[this.activeListId]);
    }
  },

  async addTask(title, dueDateStr) {
    const body = { title };
    if (dueDateStr) body.due = new Date(dueDateStr + "T00:00:00Z").toISOString();
    document.getElementById("newTaskTitle").value = "";
    try {
      const created = await TasksAPI.insertTask(this.activeListId, body);
      this.taskCache[this.activeListId].push(created);
      this.paint(this.taskCache[this.activeListId]);
    } catch (e) {
      Toast.show("Couldn't add that task right now.");
    }
  },

  openEditTask(id) {
    const task = this.findTask(id);
    if (!task) return;
    const dueVal = task.due ? new Date(task.due).toISOString().slice(0, 10) : "";
    Modal.open("Edit task", `
      <label class="field-label">Title
        <input class="field-input" id="editTaskTitle" value="${escapeHtml(task.title || "")}" />
      </label>
      <label class="field-label">Due date
        <input type="date" class="field-input" id="editTaskDue" value="${dueVal}" />
      </label>
      <button class="btn btn-primary btn-full" id="editTaskSaveBtn">Save</button>
      <button class="btn btn-danger-ghost btn-full" id="editTaskDeleteBtn">Delete task</button>
    `);
    document.getElementById("editTaskSaveBtn").addEventListener("click", async () => {
      const title = document.getElementById("editTaskTitle").value.trim();
      const dueStr = document.getElementById("editTaskDue").value;
      if (!title) { Toast.show("Task needs a title."); return; }
      const patch = { title, due: dueStr ? new Date(dueStr + "T00:00:00Z").toISOString() : null };
      try {
        await TasksAPI.patchTask(this.activeListId, id, patch);
        Object.assign(task, patch);
        Modal.close();
        this.paint(this.taskCache[this.activeListId]);
      } catch (e) {
        Toast.show("Couldn't save changes to Google Tasks.");
      }
    });
    document.getElementById("editTaskDeleteBtn").addEventListener("click", async () => {
      try {
        await TasksAPI.deleteTask(this.activeListId, id);
        this.taskCache[this.activeListId] = this.taskCache[this.activeListId].filter(t => t.id !== id);
        Modal.close();
        this.paint(this.taskCache[this.activeListId]);
      } catch (e) {
        Toast.show("Couldn't delete that task.");
      }
    });
  },

  refresh() {
    if (!this.activeListId) return this.boot();
    delete this.taskCache[this.activeListId];
    this.renderTaskBody();
  }
};
