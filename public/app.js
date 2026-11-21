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
  if (!$("#view-dashboard").hidden && loaded) renderDashboard(); // recolor charts and pins
});

/* ---------- Routing ---------- */
let meta = { statuses: [], departments: [], categories: [] };
function route() {
  const [view, param] = (location.hash.replace("#", "") || "report").split("/");
  const known = ["report", "track", "dashboard"];
  const v = known.includes(view) ? view : "report";
  for (const k of known) $(`#view-${k}`).hidden = k !== v;
  $$(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
  if (v === "dashboard") loadTickets(true);
  if (v === "track") {
    if (param) { $("#track-id").value = decodeURIComponent(param); trackLookup(decodeURIComponent(param)); }
    else $("#track-id").focus();
  }
  closeDrawer();
}

/* Load a CDN script once; resolves false (instead of throwing) if it can't load, e.g. offline. */
const scripts = {};
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(true);
  scripts[src] ??= new Promise((resolve) => {
    const el = document.createElement("script");
    el.src = src;
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(Boolean(window[globalName]));
    el.onerror = () => { delete scripts[src]; resolve(false); };
    document.head.append(el);
    setTimeout(() => resolve(Boolean(window[globalName])), 8000);
  });
  return scripts[src];
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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

/* Optional GPS: only asked for when the citizen taps the button. */
let coords = null;
$("#geo").addEventListener("click", () => {
  const b = $("#geo");
  if (coords) { clearCoords(); return; }
  if (!navigator.geolocation) return toast("This browser can't share location. Please describe the place in the text instead.", "error");
  $("span", b).textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      b.setAttribute("aria-pressed", "true");
      $("span", b).textContent = "Location attached";
      $("#geo-note").textContent = `±${Math.round(pos.coords.accuracy)} m · tap to remove`;
    },
    (err) => {
      clearCoords();
      toast(err.code === 1 ? "Location permission was denied. You can still describe the place in the text." : "Couldn't get your location. Please describe the place in the text.", "error");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
});
function clearCoords() {
  coords = null;
  $("#geo").setAttribute("aria-pressed", "false");
  $("span", $("#geo")).textContent = "Use my current location";
  $("#geo-note").textContent = "Optional. Helps the team find the exact spot.";
}

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#text").value.trim();
  if (!text && !photoData) {
    toast("Please describe the problem or add a photo.", "error");
    $("#text").focus();
    return;
  }
  try { await submitComplaint({ text, photo: photoData, ...(coords || {}) }); clearCoords(); } catch { /* toast already shown */ }
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
        <div class="notice">Your ticket ID is <b>${esc(t.id)}</b>. Save it to track progress on the <a href="#track/${esc(t.id)}">Track</a> page.</div>
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
            <a class="btn btn-primary" href="#track/${esc(t.id)}">Track ${esc(t.id)}</a>
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
   TRACK MY COMPLAINT
   ============================================================ */
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

$("#track-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#track-id").value.trim().toUpperCase();
  if (!/^CL-\d{1,8}$/.test(id)) {
    toast("Ticket IDs look like CL-1001. Please check and try again.", "error");
    $("#track-id").focus();
    return;
  }
  if (location.hash === `#track/${id}`) trackLookup(id);
  else location.hash = `#track/${id}`;
});

async function trackLookup(id) {
  const box = $("#track-result");
  box.innerHTML = `<div class="card"><div class="skel skel-line" style="width:40%;height:18px"></div><div class="skel skel-block" style="margin-top:16px"></div><div class="skel skel-line" style="width:70%"></div></div>`;
  let t;
  try {
    t = await api(`/api/track/${encodeURIComponent(id)}`);
  } catch (err) {
    box.innerHTML = `<div class="card empty"><span class="empty-icon">${ICON.search}</span><h2>Ticket not found</h2><p>${esc(err.message)}</p></div>`;
    return;
  }
  const steps = ["Open", "Assigned", "In Progress", "Resolved"];
  const label = { Open: "Received", Assigned: "Assigned", "In Progress": "In progress", Resolved: "Resolved" };
  const reached = Object.fromEntries(t.history.filter((h) => h.type === "status").map((h) => [h.status, h.at]));
  const cur = steps.indexOf(t.status);
  const due = new Date(t.slaDue);
  const late = t.status !== "Resolved" && due < Date.now();
  box.innerHTML = `
    <article class="card ticket">
      <div class="ticket-band" style="background:var(${SEV_VAR[t.severity]})"></div>
      <div class="ticket-inner">
        <div class="ticket-head">
          <span class="cat-icon sev-${t.severity}">${ICON[t.category]}</span>
          <div><div class="ticket-id">TICKET ${esc(t.id)} · ${CAT_LABEL[t.category]}</div><div class="ticket-title">${esc(t.title)}</div></div>
          <span class="badge sev-${t.severity}">${t.severity}</span>
        </div>
        <ol class="progress" aria-label="Progress">
          ${steps.map((s, i) => `<li class="${i <= cur ? "done" : ""} ${i === cur ? "current" : ""}">${label[s]}${reached[s] && i <= cur ? `<span class="when">${fmtDate(reached[s])}</span>` : ""}</li>`).join("")}
        </ol>
        <div class="eta">
          <span class="cat-icon sm" style="background:var(--surface)">${ICON.clock}</span>
          <div>${t.status === "Resolved"
            ? `<div class="muted small">Resolved</div><b>${fmtDate(t.resolvedAt || t.history.at(-1).at)}</b>`
            : `<div class="muted small">${late ? "Expected resolution was" : "Expected resolution by"}</div><b${late ? ' style="color:var(--critical-text)"' : ""}>${fmtDate(t.slaDue)}</b>${late ? '<div class="small muted">This is overdue and has been flagged on the officer dashboard.</div>' : ""}`}</div>
        </div>
        <div class="facts">
          <div class="fact"><div class="k">Handled by</div><div class="v">${esc(t.department)}</div></div>
          <div class="fact"><div class="k">Location</div><div class="v">${esc(t.location) || "Not given"}</div></div>
          <div class="fact"><div class="k">Citizens reporting</div><div class="v">${t.reportCount}</div></div>
        </div>
        <div class="d-section" style="margin-top:0"><h3>Updates</h3>
          <ul class="timeline">${[...t.history].reverse().map((h) => `<li class="${h.type}"><div class="when">${fmtDate(h.at)}</div>${esc(h.text)}</li>`).join("")}</ul>
        </div>
      </div>
    </article>`;
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
  renderCharts();
  if (mode === "map") renderMap(list);

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

/* ---------- List / Map toggle ---------- */
let mode = "list";
$(".seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  mode = b.dataset.mode;
  $$(".seg button").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b); });
  $("#list").hidden = mode !== "list";
  $("#map-wrap").hidden = mode !== "map";
  $("#list-sub").textContent = mode === "map" ? "Pins colored by severity · click one to open" : "Sorted by priority score";
  renderDashboard();
});

/* ---------- Map (Leaflet + OpenStreetMap, loaded only when opened) ---------- */
let map, pinLayer, fitted = false;
async function renderMap(list) {
  const ok = await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "L");
  if (!ok) {
    $("#map").innerHTML = `<div class="map-msg"><div><b>The map couldn't load</b><p>The map library is downloaded from the internet. The list view still works.</p></div></div>`;
    return;
  }
  if (!map) {
    const c = meta.cityCenter || { lat: 12.9716, lng: 77.5946 };
    map = L.map("map", { scrollWheelZoom: false }).setView([c.lat, c.lng], 12);
    let tileWarned = false;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" })
      .on("tileerror", () => { if (!tileWarned) { tileWarned = true; toast("Map tiles couldn't load. Pins are still shown.", "error"); } })
      .addTo(map);
    pinLayer = L.layerGroup().addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 0);
  pinLayer.clearLayers();
  const placed = list.filter((t) => t.geo);
  for (const t of placed) {
    const color = cssVar(SEV_VAR[t.severity]);
    const exact = t.geo.source !== "approx";
    L.circleMarker([t.geo.lat, t.geo.lng], {
      radius: 8 + Math.min(t.reportCount - 1, 4) * 2,
      color, weight: 2.5, fillColor: color, fillOpacity: exact ? 0.85 : 0.15, dashArray: exact ? null : "4 3",
    })
      .bindTooltip(`<b>${esc(t.id)} · ${t.severity}</b>${esc(t.title)}${exact ? "" : "<br><i>Approximate location</i>"}`)
      .on("click", () => openDrawer(t.id))
      .addTo(pinLayer);
  }
  const pending = list.length - placed.length;
  $("#list-sub").textContent = `Pins colored by severity · click one to open${pending ? ` · ${pending} still being located` : ""}`;
  if (!fitted && placed.length) {
    map.fitBounds(L.latLngBounds(placed.map((t) => [t.geo.lat, t.geo.lng])).pad(0.2), { maxZoom: 14 });
    fitted = true;
  }
}

/* ---------- Analytics (Chart.js, loaded once) ---------- */
const charts = {};
const shortPlace = (s) => (s || "").replace(/^(?:near|opposite|opp\.?|behind|beside|next to|in front of|at|on|in)\s+(?:the\s+)?/i, "").trim();
async function renderCharts() {
  const ok = await loadScript("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js", "Chart");
  const boxes = { cat: $("#ch-cat").parentElement, dept: $("#ch-dept").parentElement, hot: $("#ch-hot").parentElement };
  if (!ok) {
    for (const b of Object.values(boxes)) {
      $("canvas", b).hidden = true;
      if (!$(".chart-empty", b)) b.insertAdjacentHTML("beforeend", '<div class="chart-empty">Charts couldn\'t load (the chart library is downloaded from the internet).</div>');
    }
    return;
  }
  const text = cssVar("--muted"), grid = cssVar("--border");
  Chart.defaults.font.family = cssVar("--font") || "Inter, sans-serif";
  Chart.defaults.color = text;
  const active = tickets.filter((t) => t.status !== "Resolved");

  const byCat = meta.categories.map((c) => tickets.filter((t) => t.category === c).length);
  const depts = meta.departments.filter((d) => active.some((t) => t.department === d));
  const hot = {};
  for (const t of tickets) {
    const area = t.geo?.area || shortPlace(t.location);
    if (area) hot[area] = (hot[area] || 0) + t.reportCount;
  }
  const hotTop = Object.entries(hot).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const short = (s, n = 22) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  const base = (horizontal, stacked = false) => ({
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    indexAxis: horizontal ? "y" : "x",
    plugins: { legend: { display: stacked, position: "bottom", labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } } },
    scales: {
      x: { stacked, grid: { color: horizontal ? grid : "transparent" }, ticks: { precision: 0 }, border: { display: false } },
      y: { stacked, grid: { color: horizontal ? "transparent" : grid }, ticks: { precision: 0, autoSkip: !horizontal }, border: { display: false } },
    },
  });
  const draw = (key, canvasId, empty, config) => {
    const box = boxes[key];
    let msg = $(".chart-empty", box);
    if (empty) {
      if (!msg) { msg = document.createElement("div"); msg.className = "chart-empty"; box.append(msg); }
      msg.textContent = empty;
      $("canvas", box).hidden = true;
      return;
    }
    msg?.remove();
    $("canvas", box).hidden = false;
    if (charts[key]) { charts[key].data = config.data; charts[key].options = config.options; charts[key].update("none"); }
    else charts[key] = new Chart($(`#${canvasId}`), config);
  };

  draw("cat", "ch-cat", tickets.length ? "" : "No complaints yet", {
    type: "bar",
    data: { labels: meta.categories.map((c) => CAT_LABEL[c]), datasets: [{ label: "Tickets", data: byCat, backgroundColor: cssVar("--brand"), borderRadius: 6, maxBarThickness: 28 }] },
    options: base(false),
  });
  draw("dept", "ch-dept", depts.length ? "" : "No open tickets", {
    type: "bar",
    data: {
      labels: depts.map((d) => short(d)),
      datasets: SEVS.map((s) => ({ label: s, data: depts.map((d) => active.filter((t) => t.department === d && t.severity === s).length), backgroundColor: cssVar(SEV_VAR[s]), borderRadius: 4, maxBarThickness: 18 })),
    },
    options: base(true, true),
  });
  draw("hot", "ch-hot", hotTop.length ? "" : "No locations reported yet", {
    type: "bar",
    data: { labels: hotTop.map(([a]) => short(a)), datasets: [{ label: "Reports", data: hotTop.map(([, n]) => n), backgroundColor: cssVar("--high"), borderRadius: 6, maxBarThickness: 18 }] },
    options: base(true),
  });
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
    <div class="d-section"><h3>Officer actions</h3>
      <form class="actions-form" id="actions" data-id="${t.id}">
        <div class="row2">
          <label>Status<select name="status">${meta.statuses.map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
          <label>Department<select name="department">${meta.departments.map((d) => `<option ${d === t.department ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></label>
        </div>
        <label>Note <span class="muted" style="font-weight:400">(internal; with a reassignment it records why the AI's routing was wrong)</span><textarea name="note" maxlength="1000" placeholder="e.g. Called the reporter; the wire belongs to the power utility, not a streetlight"></textarea></label>
        <button class="btn btn-primary btn-sm" type="submit">Save changes</button>
      </form>
    </div>
    <div class="d-section"><h3>Activity</h3>
      <ul class="timeline">${[...(t.history || [])].reverse().map((h) => `<li class="${h.type}"><div class="when">${fmtDate(h.at)}</div>${h.type === "note" ? `<div class="note-text">${esc(h.text)}</div>` : esc(h.text)}${h.type === "reassign" && h.note ? `<div class="note-text">${esc(h.note)}</div>` : ""}</li>`).join("")}</ul>
    </div>
    <div class="d-section"><h3>Citizen reports (${t.reports.length})</h3>
      <ul class="timeline">${t.reports.map((r) => `<li><div class="when">${new Date(r.at).toLocaleString()} · ${esc(r.language || "")}</div>${esc(r.text) || "<i>Photo only</i>"}</li>`).join("")}</ul>
    </div>
    <p class="small muted d-section">Triaged by ${t.engine === "claude" ? "Claude AI" : "rules engine"} · confidence ${esc(t.confidence)}</p>`;
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $(".drawer-close").focus();
}
$("#drawer").addEventListener("submit", async (e) => {
  if (e.target.id !== "actions") return;
  e.preventDefault();
  const form = e.target;
  const id = form.dataset.id;
  const t = tickets.find((x) => x.id === id);
  const status = form.status.value, department = form.department.value, note = form.note.value.trim();
  const body = {};
  if (status !== t.status) body.status = status;
  if (department !== t.department) body.department = department;
  if (note) body.note = note;
  if (!Object.keys(body).length) return toast("Nothing changed yet. Pick a new status or department, or write a note.");
  const btn = $("button[type=submit]", form);
  btn.disabled = true;
  try {
    await api(`/api/tickets/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    toast(body.department ? `${id} reassigned to ${department}` : body.status ? `${id} marked ${status}` : "Note added", "success");
    await loadTickets();
    openDrawer(id);
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
  }
});

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
