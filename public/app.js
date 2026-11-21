/* CivicLens front end: plain JS, no framework. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(url, opts = {}) {
  let r;
  try {
    r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  } catch {
    throw new Error("Can't reach the CivicLens server. Check your connection and try again.");
  }
  let data = {};
  try { data = await r.json(); } catch { /* non-JSON error page */ }
  if (!r.ok) throw new Error(data.error || `Server error (${r.status})`);
  return data;
}

/* ---------- Icons ---------- */
const svg = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICON = {
  roads: svg('<path d="M5 21 9 3M19 21 15 3M12 4v2M12 10v3M12 17v3"/>'),
  waste: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
  water: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>'),
  electricity: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'),
  trees: svg('<path d="M12 22v-6M12 2 6 11h3l-4 6h14l-4-6h3L12 2Z"/>'),
  drainage: svg('<path d="M3 8c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2M3 13c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2M3 18c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2"/>'),
  other: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>'),
  inbox: svg('<path d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6l2-8Z"/>'),
  alert: svg('<path d="M12 3 2 20h20L12 3ZM12 10v4M12 17h.01"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  merge: svg('<path d="M7 4v6a4 4 0 0 0 4 4h6M14 11l3 3-3 3M7 20v-2"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
};
const CAT_LABEL = { roads: "Roads", waste: "Waste", water: "Water", electricity: "Electricity", trees: "Trees", drainage: "Drainage", other: "Other" };
const SEVS = ["Critical", "High", "Medium", "Low"];
const SEV_VAR = { Critical: "--critical", High: "--high", Medium: "--medium", Low: "--low" };

/* ---------- Toasts ---------- */
function toast(msg, type = "info", ms = 3800) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<i></i><div>${esc(msg)}</div>`;
  $("#toasts").append(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, ms);
}

/* ---------- Theme (remembered per browser; storage may be unavailable) ---------- */
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const savedTheme = store.get("civiclens-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$("#theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("civiclens-theme", next);
});

/* ---------- Routing ---------- */
let meta = { statuses: [], departments: [], categories: [] };
function route() {
  const view = (location.hash.replace("#", "") || "report").split("/")[0];
  const known = ["report", "dashboard"];
  const v = known.includes(view) ? view : "report";
  for (const k of known) $(`#view-${k}`).hidden = k !== v;
  $$(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
  if (v === "dashboard") loadTickets(true);
  closeDrawer();
}
window.addEventListener("hashchange", route);

/* ============================================================
   CITIZEN PAGE
   ============================================================ */
let photoData = null;
const MAX_PHOTO_MB = 15;

$("#text").addEventListener("input", () => { $("#count").textContent = `${$("#text").value.length} / 2000`; });

const drop = $("#drop");
drop.addEventListener("click", (e) => { if (!photoData && !e.target.closest("button")) $("#photo").click(); });
drop.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !photoData) { e.preventDefault(); $("#photo").click(); } });
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) setPhoto(f); });
$("#photo").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) setPhoto(f); });
document.addEventListener("paste", (e) => {
  if ($("#view-report").hidden) return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
  if (f) setPhoto(f);
});
$("#photo-remove").addEventListener("click", (e) => { e.stopPropagation(); clearPhoto(); });

async function setPhoto(file) {
  if (!file.type.startsWith("image/")) return toast("That file isn't an image. Please choose a JPG, PNG or WebP photo.", "error");
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) return toast(`That photo is over ${MAX_PHOTO_MB} MB. Please choose a smaller one.`, "error");
  try {
    photoData = await resizeImage(file, 1024);
  } catch {
    return toast("Couldn't read that image. Try a different photo.", "error");
  }
  $(".drop-preview img", drop).src = photoData;
  $("#photo-name").textContent = file.name || "Pasted image";
  $("#photo-size").textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · will be resized for upload`;
  $(".drop-empty", drop).hidden = true;
  $(".drop-preview", drop).hidden = false;
  drop.classList.add("has-photo");
}
function clearPhoto() {
  photoData = null;
  $("#photo").value = "";
  $(".drop-empty", drop).hidden = false;
  $(".drop-preview", drop).hidden = true;
  drop.classList.remove("has-photo");
}
function resizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error("bad image")); };
    img.src = URL.createObjectURL(file);
  });
}

/* Voice input via the browser's speech recognition (Chrome / Edge). */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  $("#voice").hidden = false;
  let rec = null;
  $("#mic").addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = $("#speech-lang").value;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = [...e.results].map((r) => r[0].transcript).join(" ");
      $("#text").value = ($("#text").value + " " + said).trim();
      $("#text").dispatchEvent(new Event("input"));
    };
    rec.onerror = (e) => toast(e.error === "not-allowed" ? "Microphone permission was blocked." : "Voice input stopped. Please try again.", "error");
    rec.onend = () => { rec = null; $("#mic").classList.remove("listening"); };
    $("#mic").classList.add("listening");
    toast("Listening… tap the mic again to stop.");
    rec.start();
  });
}

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#text").value.trim();
  if (!text && !photoData) {
    toast("Please describe the problem or add a photo.", "error");
    $("#text").focus();
    return;
  }
  await submitComplaint({ text, photo: photoData });
});

async function submitComplaint(body) {
  const btn = $("#submit");
  btn.disabled = true;
  $("span", btn).textContent = "Analysing…";
  renderSkeleton();
  try {
    const res = await api("/api/complaints", { method: "POST", body: JSON.stringify(body) });
    renderTicket(res);
    $("#text").value = "";
    $("#text").dispatchEvent(new Event("input"));
    clearPhoto();
    toast(res.merged ? `Added to existing ticket ${res.ticket.id}` : `Ticket ${res.ticket.id} created`, "success");
    return res;
  } catch (err) {
    $("#result").innerHTML = "";
    toast(err.message, "error", 6000);
    throw err;
  } finally {
    btn.disabled = false;
    $("span", btn).textContent = "Submit complaint";
  }
}

function renderSkeleton() {
  $("#result").innerHTML = `
    <div class="card ticket" aria-busy="true">
      <div class="ticket-band skel" style="border-radius:0"></div>
      <div class="ticket-inner">
        <div class="analysing"><span class="spinner"></span>${meta.engine === "claude" ? "Claude is reading your complaint…" : "Analysing your complaint…"}</div>
        <div class="ticket-head"><div class="skel skel-circle"></div><div style="flex:1"><div class="skel skel-line" style="width:30%"></div><div class="skel skel-line" style="width:70%;height:16px"></div></div></div>
        <div class="facts"><div class="skel skel-block"></div><div class="skel skel-block"></div><div class="skel skel-block"></div></div>
        <div class="skel skel-line" style="width:90%"></div><div class="skel skel-line" style="width:60%"></div>
      </div>
    </div>`;
  $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderTicket({ ticket: t, merged, engine, ms, citizen_reply, aiError }) {
  $("#result").innerHTML = `
    <article class="card ticket">
      <div class="ticket-band" style="background:var(${SEV_VAR[t.severity]})"></div>
      <div class="ticket-inner">
        <div class="ticket-head">
          <span class="cat-icon sev-${t.severity}">${ICON[t.category]}</span>
          <div>
            <div class="ticket-id">TICKET ${esc(t.id)} · ${CAT_LABEL[t.category]}${t.subcategory ? ` · ${esc(t.subcategory)}` : ""}</div>
            <div class="ticket-title">${esc(t.title)}</div>
          </div>
          <span class="badge sev-${t.severity}">${t.severity}</span>
        </div>
        ${merged ? `<div class="notice">This issue was already reported. Your report was added to <b>${esc(t.id)}</b>, which now has <b>${t.reports.length} reports</b>${t.escalated ? " and has been <b>escalated</b>" : ""}.</div>` : ""}
        <div class="facts">
          <div class="fact"><div class="k">Routed to</div><div class="v">${esc(t.department)}</div></div>
          <div class="fact"><div class="k">Location</div><div class="v">${esc(t.location) || '<span class="muted">Not given</span>'}</div></div>
          <div class="fact"><div class="k">Respond within</div><div class="v">${slaHours(t.severity)}</div></div>
        </div>
        <div class="reason sev-${t.severity}"><b>Why ${t.severity}</b><span>${esc(t.severity_reason)}</span></div>
        ${t.language !== "English" && t.english_translation && !t.english_translation.startsWith("(") ? `<p class="small"><b>In English:</b> ${esc(t.english_translation)}</p>` : ""}
        ${t.photo_observation ? `<p class="small"><b>Photo:</b> ${esc(t.photo_observation)} ${t.photo_consistency === "inconsistent" ? '<span class="badge sev-High">Photo doesn\'t match text</span>' : ""}</p>` : ""}
        ${t.missing_info?.length ? `<div class="notice warn"><b>To help the team act faster:</b> ${t.missing_info.map(esc).join("; ")}</div>` : ""}
        <div class="reply">${ICON.chat.replace("<svg", '<svg width="18" height="18" style="flex:none;color:var(--low-text);margin-top:2px"')}<div><div class="who">Reply to you · ${esc(t.language)}</div>${esc(citizen_reply)}</div></div>
        <div class="ticket-foot">
          <span class="meta">Triaged by ${engine === "claude" ? "Claude AI" : "rules engine"} in ${(ms / 1000).toFixed(1)}s${aiError ? " · AI unavailable, fallback used" : ""}</span>
          <div class="btns">
            <button class="btn btn-ghost" id="another">Report another</button>
            <a class="btn btn-primary" href="#dashboard">Open dashboard</a>
          </div>
        </div>
      </div>
    </article>`;
  $("#another").addEventListener("click", () => { $("#result").innerHTML = ""; window.scrollTo({ top: 0, behavior: "smooth" }); $("#text").focus(); });
  $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function slaHours(sev) {
  const h = { Critical: 4, High: 24, Medium: 72, Low: 168 }[sev];
  return h < 48 ? `${h} hours` : `${h / 24} days`;
}

/* ============================================================
   OFFICER DASHBOARD
   ============================================================ */
let tickets = [];
let loaded = false;
const F = { q: "", sev: "", cat: "", status: "active", dept: "" };

async function loadTickets(showSkeleton = false) {
  if (showSkeleton && !loaded) renderListSkeleton();
  try {
    tickets = await api("/api/tickets");
    loaded = true;
    renderDashboard();
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderListSkeleton() {
  $("#list").innerHTML = Array.from({ length: 4 }, () => `
    <div style="display:flex;gap:12px;padding:16px 24px;border-top:1px solid var(--border)">
      <div class="skel" style="width:70px;height:22px;border-radius:99px"></div>
      <div style="flex:1"><div class="skel skel-line" style="width:55%;height:14px"></div><div class="skel skel-line" style="width:80%"></div></div>
    </div>`).join("");
}

function slaInfo(t) {
  if (t.status === "Resolved") return { cls: "done", text: "Resolved" };
  const diff = new Date(t.slaDue) - Date.now();
  const h = Math.abs(diff) / 36e5;
  const s = h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  if (diff < 0) return { cls: "late", text: `${s} overdue` };
  const total = { Critical: 4, High: 24, Medium: 72, Low: 168 }[t.severity];
  return { cls: h < total * 0.25 ? "soon" : "ok", text: `${s} left` };
}

function matches(t, skip) {
  const q = F.q.toLowerCase();
  return (skip === "sev" || !F.sev || t.severity === F.sev) &&
    (skip === "cat" || !F.cat || t.category === F.cat) &&
    (skip === "dept" || !F.dept || t.department === F.dept) &&
    (skip === "status" || (F.status === "active" ? t.status !== "Resolved" : !F.status || t.status === F.status)) &&
    (!q || [t.id, t.title, t.location, t.english_translation, t.severity_reason, t.department].join(" ").toLowerCase().includes(q));
}

function chipGroup(el, key, options, render) {
  el.innerHTML = options.map((o) => {
    const val = o.value ?? o;
    const n = tickets.filter((t) => matches(t, key) && (val === "" || (key === "status" && val === "active" ? t.status !== "Resolved" : t[{ sev: "severity", cat: "category", dept: "department", status: "status" }[key]] === val))).length;
    return `<button class="chip ${F[key] === val ? "active" : ""}" data-key="${key}" data-val="${esc(val)}">${render(o)}<span class="n">${n}</span></button>`;
  }).join("");
}

function renderDashboard() {
  // Stats
  const active = tickets.filter((t) => t.status !== "Resolved");
  const overdue = active.filter((t) => new Date(t.slaDue) < Date.now()).length;
  const critical = active.filter((t) => t.severity === "Critical").length;
  const merged = tickets.reduce((n, t) => n + t.reportCount - 1, 0);
  $("#stats").innerHTML = [
    ["open", ICON.inbox, active.length, "Open tickets"],
    ["critical", ICON.alert, critical, "Critical"],
    ["overdue", ICON.clock, overdue, "Past SLA"],
    ["merged", ICON.merge, merged, "Duplicates merged"],
  ].map(([cls, icon, n, l]) => `<div class="stat ${cls} ${n ? "on" : ""}"><span class="stat-icon">${icon}</span><div><div class="n">${n}</div><div class="l">${l}</div></div></div>`).join("");

  // Filter chips (counts reflect the other active filters)
  chipGroup($("#f-sev"), "sev", ["", ...SEVS], (s) => (s ? `<span class="dot sev-${s}"></span>${s}` : "All"));
  chipGroup($("#f-cat"), "cat", ["", ...meta.categories], (c) => (c ? `${ICON[c]}${CAT_LABEL[c]}` : "All"));
  chipGroup($("#f-status"), "status", [{ value: "active", l: "Active" }, ...meta.statuses.map((s) => ({ value: s, l: s })), { value: "", l: "All" }], (o) => o.l);
  chipGroup($("#f-dept"), "dept", ["", ...meta.departments], (d) => (d ? esc(d) : "All"));

  const list = tickets.filter((t) => matches(t));
  $("#list-title").textContent = `${list.length} ticket${list.length === 1 ? "" : "s"}`;

  if (!tickets.length) {
    $("#list").innerHTML = `<div class="empty"><span class="empty-icon">${ICON.inbox}</span><h2>No complaints yet</h2>
      <p>New complaints show up here as soon as citizens submit them, already sorted by urgency. Load the sample set to see a busy day.</p>
      <div class="btns"><button class="btn btn-primary" data-act="seed">Load demo data</button><a class="btn btn-ghost" href="#report">Report an issue</a></div></div>`;
    return;
  }
  if (!list.length) {
    $("#list").innerHTML = `<div class="empty"><span class="empty-icon">${ICON.search}</span><h2>No tickets match these filters</h2>
      <p>Try a different search, or clear the filters to see the whole queue.</p>
      <div class="btns"><button class="btn btn-ghost" data-act="clear-filters">Clear filters</button></div></div>`;
    return;
  }

  const statusOpts = (cur) => meta.statuses.map((s) => `<option ${s === cur ? "selected" : ""}>${s}</option>`).join("");
  $("#list").innerHTML = `<table class="tickets"><thead><tr>
      <th>#</th><th>Severity</th><th>Issue</th><th class="t-dept-col">Department</th><th>SLA</th><th>Status</th>
    </tr></thead><tbody>${list.map((t, i) => {
      const sla = slaInfo(t);
      return `<tr data-id="${t.id}" class="${t.status === "Resolved" ? "resolved" : ""}">
        <td class="c-rank muted">${i + 1}</td>
        <td class="c-sev"><div class="t-sev"><span class="badge sev-${t.severity}">${t.severity}</span><span class="score" title="Priority score">P${t.priority}</span></div></td>
        <td class="c-issue"><div class="t-issue"><span class="cat-icon sm">${ICON[t.category]}</span><div>
          <div class="t-title">${esc(t.title)}</div>
          <div class="t-reason">${esc(t.severity_reason)}</div>
          <div class="t-tags"><span class="tag mono">${t.id}</span>${t.reportCount > 1 ? `<span class="tag multi">×${t.reportCount} reports</span>` : ""}${t.location ? `<span class="tag">${esc(t.location)}</span>` : ""}${t.vulnerable_site ? '<span class="tag vuln">Vulnerable site</span>' : ""}${t.language !== "English" ? `<span class="tag">${esc(t.language)}</span>` : ""}${t.photo ? '<span class="tag">Photo</span>' : ""}</div>
        </div></div></td>
        <td class="t-dept t-dept-col">${esc(t.department)}</td>
        <td class="c-sla"><span class="sla ${sla.cls}">${sla.text}</span></td>
        <td class="c-status"><select class="status-select" data-status="${t.id}" aria-label="Status of ${t.id}">${statusOpts(t.status)}</select></td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

$(".filters").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c) return;
  F[c.dataset.key] = c.dataset.val;
  renderDashboard();
});
$("#q").addEventListener("input", (e) => { F.q = e.target.value.trim(); renderDashboard(); });

$("#list").addEventListener("change", async (e) => {
  const id = e.target.dataset.status;
  if (!id) return;
  try {
    await api(`/api/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) });
    toast(`${id} marked ${e.target.value}`, "success");
    loadTickets();
  } catch (err) { toast(err.message, "error"); }
});
$("#list").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "seed") return seed();
  if (act === "clear-filters") {
    Object.assign(F, { q: "", sev: "", cat: "", status: "active", dept: "" });
    $("#q").value = "";
    return renderDashboard();
  }
  if (e.target.closest("select")) return;
  const tr = e.target.closest("tr[data-id]");
  if (tr) openDrawer(tr.dataset.id);
});

async function seed() {
  const b = $("#seed");
  b.disabled = true;
  b.textContent = meta.engine === "claude" ? "Triaging samples with AI…" : "Loading…";
  renderListSkeleton();
  try {
    const r = await api("/api/demo/seed", { method: "POST" });
    await loadTickets();
    toast(`Loaded ${r.count} sample complaints`, "success");
  } catch (err) { toast(err.message, "error"); renderDashboard(); }
  finally { b.disabled = false; b.textContent = "Load demo data"; }
}
$("#seed").addEventListener("click", seed);

// Two-step confirm instead of a blocking confirm() dialog.
let resetTimer;
$("#reset").addEventListener("click", async () => {
  const b = $("#reset");
  if (!b.classList.contains("confirm")) {
    b.classList.add("confirm");
    b.textContent = "Click again to delete all";
    resetTimer = setTimeout(() => { b.classList.remove("confirm"); b.textContent = "Clear all"; }, 3500);
    return;
  }
  clearTimeout(resetTimer);
  b.classList.remove("confirm");
  b.textContent = "Clear all";
  try {
    await api("/api/tickets", { method: "DELETE" });
    toast("All tickets cleared", "success");
    loadTickets();
  } catch (err) { toast(err.message, "error"); }
});

/* ---------- Drawer ---------- */
function openDrawer(id) {
  const t = tickets.find((x) => x.id === id);
  if (!t) return;
  const sla = slaInfo(t);
  $("#drawer-body").innerHTML = `
    <div class="ticket-id">${esc(t.id)} · P${t.priority} · ${esc(t.status)}</div>
    <h2 id="drawer-title">${esc(t.title)}</h2>
    <div class="t-tags"><span class="badge sev-${t.severity}">${t.severity}</span>${t.reportCount > 1 ? `<span class="tag multi">×${t.reportCount} reports</span>` : ""}${t.escalated ? '<span class="tag vuln">Crowd-escalated</span>' : ""}${t.vulnerable_site ? '<span class="tag vuln">Vulnerable site</span>' : ""}</div>
    <div class="facts" style="margin-top:16px">
      <div class="fact"><div class="k">Department</div><div class="v">${esc(t.department)}</div></div>
      <div class="fact"><div class="k">Category</div><div class="v">${CAT_LABEL[t.category]}${t.subcategory ? ` · ${esc(t.subcategory)}` : ""}</div></div>
      <div class="fact"><div class="k">Location</div><div class="v">${esc(t.location) || "Not given"}</div></div>
      <div class="fact"><div class="k">SLA</div><div class="v"><span class="sla ${sla.cls}">${sla.text}</span></div></div>
    </div>
    <div class="reason sev-${t.severity}" style="margin-top:12px"><b>Why ${t.severity}</b><span>${esc(t.severity_reason)}</span></div>
    ${t.english_translation && !t.english_translation.startsWith("(") ? `<div class="d-section"><h3>Complaint (English)</h3><p>${esc(t.english_translation)}</p></div>` : ""}
    ${t.missing_info?.length ? `<div class="notice warn" style="margin-top:12px"><b>Missing:</b> ${t.missing_info.map(esc).join("; ")}</div>` : ""}
    ${t.photo ? `<div class="d-section"><h3>Photo</h3>${t.photo_observation ? `<p class="small muted" style="margin-bottom:8px">AI: ${esc(t.photo_observation)}</p>` : ""}<img class="d-photo" src="${esc(t.photo)}" alt="Photo from citizen" /></div>` : ""}
    <div class="d-section"><h3>Citizen reports (${t.reports.length})</h3>
      <ul class="timeline">${t.reports.map((r) => `<li><div class="when">${new Date(r.at).toLocaleString()} · ${esc(r.language || "")}</div>${esc(r.text) || "<i>Photo only</i>"}</li>`).join("")}</ul>
    </div>
    <p class="small muted d-section">Triaged by ${t.engine === "claude" ? "Claude AI" : "rules engine"} · confidence ${esc(t.confidence)}</p>`;
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $(".drawer-close").focus();
}
function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
}
$("#drawer").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeDrawer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

/* ---------- Init ---------- */
async function init() {
  try {
    meta = await api("/api/health");
  } catch (err) {
    toast(err.message, "error", 8000);
  }
  const eng = $("#engine");
  const ai = meta.engine === "claude";
  eng.classList.toggle("ai", ai);
  $("span", eng).textContent = ai ? "AI engine" : meta.engine ? "Rules engine" : "Offline";
  eng.title = ai ? `Complaints are triaged by Claude (${meta.model})` : "Complaints are triaged by the offline rules engine (no AI key set)";

  try {
    const samples = await api("/api/samples");
    $("#samples").innerHTML = samples.map((s, i) => `<button type="button" class="chip" data-i="${i}">${esc(s.label)}</button>`).join("");
    $("#samples").addEventListener("click", (e) => {
      const i = e.target.closest(".chip")?.dataset.i;
      if (i === undefined) return;
      $("#text").value = samples[i].text;
      $("#text").dispatchEvent(new Event("input"));
      $("#text").focus();
    });
  } catch { /* samples are optional */ }
  route();
}

setInterval(() => { if (!$("#view-dashboard").hidden && !document.hidden) loadTickets(); }, 15000);
init();
