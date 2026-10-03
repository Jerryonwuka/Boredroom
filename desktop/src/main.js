// Brenda's notch (owner decision, 3 October 2026). Plain JavaScript, no build step.
//
// Signed out: a link code to approve in Boredroom. Signed in: a compact bar (Brenda's face, the running timer or what
// is due), which opens into one card at a time: Brenda's notifications (clock-in, reminders, nudges, assignments), the
// morning briefing once a day, or the timer with its progress ring. Cards close on their own after a few seconds
// unless the pointer is on them. Every action goes through Boredroom's own API with the person's permissions.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const el = document.getElementById("notch");
const COMPACT = { w: 220, h: 44 };
const WIDE = 420;
const POLL_MS = 20_000;
const PRESENCE_MS = 10 * 60_000;
const CLOSE_AFTER_MS = 8_000;

let config = null;          // { baseUrl, signedIn, workspaceSlug, workspaceName, displayName }
let data = null;            // the last desktop state from Boredroom
let offsetMs = 0;           // server clock minus ours, for the timer
let link = null;            // { deviceCode, userCode, verifyUrl, interval, expiresAt }
let card = null;            // what is open: { kind, ... } or null for the compact bar
const shown = new Set();    // notification ids already shown on this run
let closeTimer = null, pollTimer = null, linkTimer = null, presenceTimer = null;
let hovering = false, busy = false, error = null, editingServer = false;

// ---- helpers -------------------------------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const face = (o = {}) => `<span class="face ${o.small ? "small" : ""} ${o.busy ? "busy" : ""}"><span></span><span></span>${o.dot ? `<i class="dot ${esc(o.dot)}"></i>` : ""}</span>`;
const pad = (n) => String(n).padStart(2, "0");
const hms = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
const when = (iso) => { if (!iso) return ""; const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return d.toLocaleString(undefined, today ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" }); };
const org = (path) => `/api/orgs/${config.workspaceSlug}${path}`;
const ring = (p) => { const r = 12, c = 2 * Math.PI * r; return `<svg class="ring" viewBox="0 0 30 30" role="img" aria-label="${p}% done"><circle cx="15" cy="15" r="${r}" stroke="rgba(255,255,255,.14)"/><circle cx="15" cy="15" r="${r}" stroke="${p >= 100 ? "var(--ok)" : "var(--accent)"}" stroke-linecap="round" stroke-dasharray="${(p / 100) * c} ${c}" transform="rotate(-90 15 15)"/><text x="15" y="18" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${p}</text></svg>`; };

function elapsed() {
  const t = data?.timer; if (!t) return 0;
  if (t.state !== "running" || !t.openIntervalStartedAt) return t.confirmedSeconds;
  return t.confirmedSeconds + Math.max(0, Math.floor((Date.now() + offsetMs - Date.parse(t.serverNow)) / 1000));
}

async function call(method, path, body) {
  try { return await invoke("api", { method, path, body: body ?? null }); }
  catch (e) {
    if (e && e.status === 401) { await signedOut(); throw e; }
    throw e;
  }
}

// ---- size and placement ---------------------------------------------------------------------------------------

function fit() {
  if (!card && config?.signedIn) return invoke("set_notch_size", { width: COMPACT.w, height: COMPACT.h });
  requestAnimationFrame(() => invoke("set_notch_size", { width: WIDE, height: Math.ceil(el.getBoundingClientRect().height) + 1 }));
}

function scheduleClose() {
  clearTimeout(closeTimer);
  if (!card || card.sticky) return;
  closeTimer = setTimeout(() => { if (!hovering) closeCard(); else scheduleClose(); }, CLOSE_AFTER_MS);
}

function openCard(c) { card = c; render(); scheduleClose(); }
function closeCard() { card = null; error = null; render(); setTimeout(nextNotification, 600); }

el.addEventListener("pointerenter", () => { hovering = true; });
el.addEventListener("pointerleave", () => { hovering = false; scheduleClose(); });

// ---- rendering ---------------------------------------------------------------------------------------------------

function render() {
  el.classList.toggle("compact", !!config?.signedIn && !card);
  if (!config?.signedIn) { el.innerHTML = linkView(); return fit(); }
  if (!card) { el.innerHTML = compactView(); return fit(); }
  el.innerHTML = `${cardView()}${error ? `<p class="err">${esc(error)}</p>` : ""}`;
  fit();
}

function compactView() {
  const t = data?.timer;
  const b = data?.briefing;
  const unread = (data?.notifications ?? []).filter((n) => !shown.has(n.id)).length;
  const dot = data?.me?.presence ?? "active";
  let text = "All clear";
  if (t) text = `<span class="clock" id="tclock">${hms(elapsed())}</span> · ${esc(t.taskTitle)}`;
  else if (b && (b.overdue.length || b.dueToday.length)) text = [b.dueToday.length ? `${b.dueToday.length} due today` : "", b.overdue.length ? `${b.overdue.length} overdue` : ""].filter(Boolean).join(" · ");
  else if (data?.clock?.status === "not_in" && data.clock.workingDay) text = "Not clocked in yet";
  return `<div class="row" data-act="home" title="Open Brenda">${face({ small: true, busy: t?.state === "running", dot })}<span class="tiny grow">${text}</span>${unread ? `<span class="count">${unread}</span>` : ""}</div>`;
}

function linkView() {
  if (editingServer) {
    return `<div class="row fade">${face()}<div class="grow"><p class="title">Which Boredroom?</p><p class="sub">Leave empty for boredroom.cc. While developing, use http://localhost:3000.</p></div></div>
      <input class="field" id="server" value="${esc(config?.baseUrl ?? "")}" placeholder="https://boredroom.cc" spellcheck="false">
      <div class="actions"><button class="btn ghost" data-act="server-cancel">Cancel</button><button class="btn primary" data-act="server-save">Save</button></div>`;
  }
  if (!link) {
    return `<div class="row fade">${face()}<div class="grow"><p class="title">Hi, I'm Brenda.</p><p class="sub">Link me to your Boredroom and I'll keep your day in view up here.</p></div></div>
      ${error ? `<p class="err">${esc(error)}</p>` : ""}
      <div class="actions"><button class="link" data-act="server">${esc(config?.baseUrl ?? "boredroom.cc")}</button><span class="grow"></span><button class="btn primary" data-act="link-start" ${busy ? "disabled" : ""}>Link to Boredroom</button></div>`;
  }
  return `<div class="row fade">${face()}<div class="grow"><p class="title">Approve this code in Boredroom</p><p class="sub">Check it matches, pick your workspace, approve. I'll be ready in a few seconds.</p></div></div>
    <div class="code fade">${esc(link.userCode)}</div>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <div class="actions"><button class="btn ghost" data-act="link-cancel">Cancel</button><button class="btn primary" data-act="link-open">Open Boredroom</button></div>`;
}

function cardView() {
  const b = data?.briefing;
  if (card.kind === "notification") {
    const n = card.n;
    const pill = n.type === "brenda.reminder" ? `<span class="pill acc">Reminder</span>` : n.type === "brenda.clock_in" ? `<span class="pill ok"><span class="d"></span>In</span>` : n.type === "task.assigned" ? `<span class="pill acc">New task</span>` : n.type.startsWith("review") ? `<span class="pill warn">Review</span>` : "";
    return `<div class="row fade">${face()}<div class="grow"><p class="title">${esc(n.title)}</p>${n.body ? `<p class="sub">${esc(n.body)}</p>` : `<p class="sub">${esc(when(n.created_at))}</p>`}</div>${pill}</div>
      <div class="actions">${n.href ? `<button class="btn" data-act="open-href" data-href="${esc(n.href)}">Open</button>` : ""}<button class="btn primary" data-act="read" data-id="${esc(n.id)}">${n.type === "brenda.reminder" ? "Done" : "OK"}</button></div>`;
  }
  if (card.kind === "briefing" && b) {
    const items = [
      ...b.overdue.map((t) => ({ t, k: "overdue", bad: true })),
      ...b.dueToday.map((t) => ({ t, k: `due ${when(t.due)}` })),
      ...b.dueTomorrow.map((t) => ({ t, k: "due tomorrow" })),
    ].slice(0, 3);
    const extra = [b.waitingForYourReview.length ? `${b.waitingForYourReview.length} waiting for your review` : "", b.assignmentsNotPickedUp.length ? `${b.assignmentsNotPickedUp.length} not picked up` : ""].filter(Boolean).join(" · ");
    const first = items[0]?.t;
    const greet = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
    return `<div class="row fade">${face({ dot: data.me.presence })}<div class="grow"><p class="title">${greet}${config.displayName ? `, ${esc(config.displayName.split(" ")[0])}` : ""}. ${b.openTasks} open task${b.openTasks === 1 ? "" : "s"}.</p><p class="sub">${extra || (first ? `First up: ${esc(first.title)}` : "Nothing is waiting on you.")}</p></div></div>
      ${items.length ? `<ul class="list fade">${items.map((i) => `<li><span class="t">${esc(i.t.title)}</span><span class="k ${i.bad ? "bad" : ""}">${esc(i.k)}</span></li>`).join("")}</ul>` : ""}
      <div class="actions"><button class="btn ghost" data-act="close">Later</button><button class="btn" data-act="open-href" data-href="/app/${esc(config.workspaceSlug)}/tasks">Tasks</button>${first && !data.timer && data.clock ? `<button class="btn primary" data-act="start" data-id="${esc(first.id)}" ${busy ? "disabled" : ""}>Start ${esc(first.title.length > 22 ? `${first.title.slice(0, 21)}…` : first.title)}</button>` : ""}</div>`;
  }
  if (card.kind === "home") {
    const t = data?.timer;
    if (t) {
      return `<div class="row fade">${face({ busy: t.state === "running", dot: data.me.presence })}<div class="grow"><p class="title">${esc(t.taskTitle)}</p><p class="sub"><span class="clock" id="tclock">${hms(elapsed())}</span>${t.estimateMinutes ? ` · est. ${Math.round(t.estimateMinutes / 6) / 10}h` : ""}${t.state !== "running" ? ` · ${esc(t.state)}` : ""}</p></div>${t.taskVersion ? `<button class="ring" style="all:unset;cursor:pointer" data-act="progress" title="Add 10% progress">${ring(t.progress)}</button>` : ""}</div>
        <div class="actions"><button class="btn ghost" data-act="briefing">Today</button>${t.state === "running" ? `<button class="btn" data-act="pause" ${busy ? "disabled" : ""}>Pause</button>` : `<button class="btn primary" data-act="resume" ${busy ? "disabled" : ""}>Resume</button>`}<button class="btn" data-act="stop" ${busy ? "disabled" : ""}>Stop</button></div>`;
    }
    card = { kind: "briefing" };
    return cardView();
  }
  if (card.kind === "error") return `<div class="row fade">${face()}<div class="grow"><p class="title">Can't reach Boredroom</p><p class="sub">${esc(card.message)}</p></div></div><div class="actions"><button class="btn" data-act="close">OK</button></div>`;
  return "";
}

// ---- actions -----------------------------------------------------------------------------------------------------

el.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-act]");
  if (!target) return;
  const act = target.dataset.act;
  error = null;
  try {
    if (act === "home") return openCard({ kind: "home" });
    if (act === "close") return closeCard();
    if (act === "briefing") return openCard({ kind: "briefing" });
    if (act === "server") { editingServer = true; return render(); }
    if (act === "server-cancel") { editingServer = false; return render(); }
    if (act === "server-save") { config = await invoke("set_base_url", { url: document.getElementById("server").value }); editingServer = false; return render(); }
    if (act === "link-start") return startLink();
    if (act === "link-cancel") { link = null; clearTimeout(linkTimer); return render(); }
    if (act === "link-open") return invoke("open_in_browser", { path: link.verifyUrl });
    if (act === "open-href") { await invoke("open_in_browser", { path: target.dataset.href }); return closeCard(); }
    if (act === "read") { await call("PATCH", org(`/notifications/${target.dataset.id}`)); data.notifications = data.notifications.filter((n) => n.id !== target.dataset.id); return closeCard(); }
    busy = true; render();
    const t = data?.timer;
    if (act === "start") await call("POST", org("/sessions/start"), { taskId: target.dataset.id, captureMode: "none" });
    if (act === "pause" && t) await call("POST", org(`/sessions/${t.id}/pause`), { expectedVersion: t.version });
    if (act === "resume" && t) await call("POST", org(`/sessions/${t.id}/resume`), { expectedVersion: t.version });
    if (act === "stop" && t) await call("POST", org(`/sessions/${t.id}/stop`), { expectedVersion: t.version, note: "", outcome: "continue_later" });
    if (act === "progress" && t?.taskVersion) await call("PATCH", org(`/tasks/${t.taskId}`), { expectedVersion: t.taskVersion, progressPercent: Math.min(100, (t.progress ?? 0) + 10) });
    busy = false;
    await refresh();
    openCard({ kind: act === "stop" ? "briefing" : "home" });
  } catch (err) {
    busy = false;
    error = err?.message ?? String(err);
    render();
  }
});

// ---- linking -----------------------------------------------------------------------------------------------------

async function startLink() {
  busy = true; error = null; render();
  try {
    const r = await invoke("link_start");
    link = { ...r, expiresAt: Date.now() + r.expiresIn * 1000 };
    await invoke("open_in_browser", { path: r.verifyUrl });
    pollLink();
  } catch (err) { error = err?.message ?? "Can't reach Boredroom."; link = null; }
  busy = false; render();
}

async function pollLink() {
  clearTimeout(linkTimer);
  if (!link) return;
  if (Date.now() > link.expiresAt) { link = null; error = "The code expired. Start again."; return render(); }
  try {
    const r = await invoke("link_poll", { deviceCode: link.deviceCode });
    if (r.status === "approved") { config = r.config; link = null; return start(); }
  } catch (err) {
    if (err?.status === 410 || err?.status === 404) { link = null; error = err.message; return render(); }
  }
  linkTimer = setTimeout(pollLink, (link.interval ?? 3) * 1000);
}

async function signedOut() {
  clearInterval(pollTimer); clearInterval(presenceTimer);
  config = await invoke("sign_out");
  data = null; card = null; link = null;
  render();
}

// ---- data --------------------------------------------------------------------------------------------------------

async function refresh() {
  try {
    data = await call("GET", org("/brenda/desktop"));
    offsetMs = Date.parse(data.serverNow) - Date.now();
    if (!card) render();
  } catch (err) {
    if (err?.status && err.status !== 401 && !card) openCard({ kind: "error", message: err.message });
  }
}

/** One Brenda notification at a time, newest first, only once per run. */
function nextNotification() {
  if (card || !data) return;
  const n = (data.notifications ?? []).find((x) => !shown.has(x.id));
  if (!n) return;
  shown.add(n.id);
  openCard({ kind: "notification", n });
}

/** The morning briefing, once per day per computer. */
function maybeBriefing() {
  const key = `brenda-briefing:${config.workspaceSlug}:${new Date().toDateString()}`;
  try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, "1"); } catch { /* storage blocked */ }
  if (!data?.briefing) return false;
  openCard({ kind: "briefing" });
  return true;
}

/** The activity signal for automatic clock-in: Boredroom decides whether it may clock the person in. */
async function presence() {
  if (!data?.brendaEnabled || !data.clock) return;
  try { const r = await call("POST", org("/brenda/presence")); if (r.clockedIn) await refresh(); } catch { /* not allowed or offline */ }
}

async function start() {
  render();
  await refresh();
  if (!data) return;
  await presence();
  await refresh();
  if (!maybeBriefing()) nextNotification();
  clearInterval(pollTimer); pollTimer = setInterval(async () => { await refresh(); nextNotification(); }, POLL_MS);
  clearInterval(presenceTimer); presenceTimer = setInterval(presence, PRESENCE_MS);
}

// The running timer in the compact bar and the timer card.
setInterval(() => { const c = document.getElementById("tclock"); if (c && data?.timer) c.textContent = hms(elapsed()); }, 1000);

listen("brenda://signed-out", () => { config = { ...config, signedIn: false }; data = null; card = null; render(); });

(async () => {
  config = await invoke("get_config");
  if (config.signedIn) start(); else render();
})();
