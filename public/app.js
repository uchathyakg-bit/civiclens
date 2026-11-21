const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
};
const CAT_LABEL = { roads: "Roads", waste: "Waste", water: "Water", electricity: "Electricity", trees: "Trees", drainage: "Drainage", other: "Other" };

let meta = { statuses: [] };
let tickets = [];
let photoData = null;

/* ---------- Tabs ---------- */
function show(view) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#view-report").hidden = view !== "report";
  $("#view-dashboard").hidden = view !== "dashboard";
  if (view === "dashboard") loadTickets();
  history.replaceState(null, "", view === "dashboard" ? "#dashboard" : "#");
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

/* ---------- Init ---------- */
async function init() {
  meta = await api("/api/health");
  const eng = $("#engine");
  eng.textContent = meta.engine === "claude" ? `AI: ${meta.model}` : "Offline rules engine";
  eng.classList.toggle("ai", meta.engine === "claude");
  for (const d of meta.departments) $("#f-dept").insertAdjacentHTML("beforeend", `<option>${esc(d)}</option>`);
  for (const c of meta.categories) $("#f-cat").insertAdjacentHTML("beforeend", `<option value="${c}">${CAT_LABEL[c]}</option>`);

  const samples = await api("/api/samples");
  $("#samples").innerHTML = samples.map((s, i) => `<button class="chip" data-i="${i}">${esc(s.label)}</button>`).join("");
  $("#samples").addEventListener("click", (e) => {
    const i = e.target.dataset.i;
    if (i !== undefined) { $("#text").value = samples[i].text; $("#text").focus(); }
  });
  show(location.hash === "#dashboard" ? "dashboard" : "report");
}

/* ---------- Photo (resized in the browser to keep uploads small) ---------- */
$("#photo").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  photoData = await resizeImage(file, 1024);
  $("#photo-preview img").src = photoData;
  $("#photo-preview").hidden = false;
  $("#photo-label").textContent = "Change photo";
});
$("#photo-remove").addEventListener("click", clearPhoto);
function clearPhoto() {
  photoData = null;
  $("#photo").value = "";
  $("#photo-preview").hidden = true;
  $("#photo-label").textContent = "Add photo";
}
function resizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- Voice input (browser speech recognition, where supported) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  $("#mic").hidden = false;
  $("#speech-lang").hidden = false;
  let rec = null;
  $("#mic").addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = $("#speech-lang").value;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      $("#text").value = ($("#text").value + " " + said).trim();
    };
    rec.onend = () => { rec = null; $("#mic").classList.remove("listening"); };
    $("#mic").classList.add("listening");
    rec.start();
  });
}

/* ---------- Submit ---------- */
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#text").value.trim();
  if (!text && !photoData) { $("#text").focus(); return; }
  const btn = $("#submit");
  btn.disabled = true;
  btn.textContent = "Analysing…";
  try {
    const res = await api("/api/complaints", { method: "POST", body: JSON.stringify({ text, photo: photoData }) });
    renderResult(res);
    $("#text").value = "";
    clearPhoto();
  } catch (err) {
    $("#result").hidden = false;
    $("#result").innerHTML = `<div class="notice warn">Could not submit: ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit complaint";
  }
});

function renderResult({ ticket: t, merged, engine, ms, citizen_reply, aiError }) {
  const el = $("#result");
  el.hidden = false;
  el.innerHTML = `
    <h2>Ticket ${esc(t.id)} <span class="pill sev-${t.severity}">${t.severity}</span></h2>
    <div class="issue-title">${esc(t.title)}</div>
    ${merged ? `<div class="notice">Same issue was already reported. Your report was added to ${esc(t.id)}, which now has <b>${t.reports.length} reports</b>${t.escalated ? " and has been <b>escalated</b>" : ""}.</div>` : ""}
    <div class="ticket-grid">
      <div class="field"><div class="k">Category</div><div class="v">${CAT_LABEL[t.category]}${t.subcategory ? ` · ${esc(t.subcategory)}` : ""}</div></div>
      <div class="field"><div class="k">Routed to</div><div class="v">${esc(t.department)}</div></div>
      <div class="field"><div class="k">Location</div><div class="v">${esc(t.location) || "<span class='muted'>Not given</span>"}</div></div>
      <div class="field"><div class="k">Language</div><div class="v">${esc(t.language)}</div></div>
    </div>
    <div class="reason"><b>Why ${t.severity}:</b> ${esc(t.severity_reason)}</div>
    ${t.language !== "English" && t.english_translation ? `<p class="small"><b>English:</b> ${esc(t.english_translation)}</p>` : ""}
    ${t.photo_observation ? `<p class="small"><b>Photo:</b> ${esc(t.photo_observation)} ${t.photo_consistency === "inconsistent" ? '<span class="pill sev-High">doesn\'t match text</span>' : ""}</p>` : ""}
    ${t.missing_info?.length ? `<div class="notice warn"><b>To act faster, the officer needs:</b> ${t.missing_info.map(esc).join("; ")}</div>` : ""}
    <div class="reply">💬 ${esc(citizen_reply)}</div>
    <div class="meta">Triaged by ${engine === "claude" ? "Claude" : "the offline rules engine"} in ${(ms / 1000).toFixed(1)}s${aiError ? ` · AI unavailable (${esc(aiError)}), used fallback` : ""} · <a href="#dashboard" id="to-dash">View on dashboard →</a></div>`;
  $("#to-dash").addEventListener("click", (e) => { e.preventDefault(); show("dashboard"); });
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- Dashboard ---------- */
async function loadTickets() {
  tickets = await api("/api/tickets");
  renderDashboard();
}

function slaText(t) {
  if (t.status === "Resolved") return "Done";
  const diff = new Date(t.slaDue) - Date.now();
  const h = Math.abs(diff) / 36e5;
  const s = h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  return diff < 0 ? `<span class="sla-late">${s} overdue</span>` : `${s} left`;
}

function renderDashboard() {
  const q = $("#q").value.trim().toLowerCase();
  const dept = $("#f-dept").value, cat = $("#f-cat").value, st = $("#f-status").value;
  const list = tickets.filter((t) =>
    (!dept || t.department === dept) &&
    (!cat || t.category === cat) &&
    (st === "" || (st === "active" ? t.status !== "Resolved" : t.status === st)) &&
    (!q || [t.title, t.location, t.english_translation, t.id, t.severity_reason].join(" ").toLowerCase().includes(q)));

  const active = tickets.filter((t) => t.status !== "Resolved");
  const reports = tickets.reduce((n, t) => n + t.reportCount, 0);
  $("#kpis").innerHTML = [
    ["Active tickets", active.length],
    ["Critical open", active.filter((t) => t.severity === "Critical").length, "alert"],
    ["Past SLA", active.filter((t) => new Date(t.slaDue) < Date.now()).length, "alert"],
    ["Duplicate reports merged", reports - tickets.length],
  ].map(([l, n, cls]) => `<div class="kpi ${n && cls ? cls : ""}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");

  const statusOpts = (cur) => meta.statuses.map((s) => `<option ${s === cur ? "selected" : ""}>${s}</option>`).join("");
  $("#rows").innerHTML = list.map((t, i) => `
    <tr data-id="${t.id}" class="${t.status === "Resolved" ? "resolved" : ""}">
      <td class="rank">${i + 1}</td>
      <td><span class="pill sev-${t.severity}">${t.severity}</span><span class="score" title="Priority score">P${t.priority}</span></td>
      <td>
        <div class="issue-title">${esc(t.title)}</div>
        <div class="issue-reason">${esc(t.severity_reason)}</div>
        <div><span class="tag">${t.id}</span><span class="tag">${CAT_LABEL[t.category]}</span>${t.location ? `<span class="tag">📍 ${esc(t.location)}</span>` : ""}${t.vulnerable_site ? '<span class="tag">⚠ vulnerable site</span>' : ""}${t.language !== "English" ? `<span class="tag">${esc(t.language)}</span>` : ""}${t.photo ? '<span class="tag">📷</span>' : ""}</div>
      </td>
      <td>${esc(t.department)}</td>
      <td>${t.reportCount > 1 ? `<span class="dup">×${t.reportCount}</span>` : "1"}</td>
      <td>${slaText(t)}</td>
      <td><select data-status="${t.id}">${statusOpts(t.status)}</select></td>
    </tr>`).join("");
  $("#empty").hidden = list.length > 0;

  // Department load, split by severity
  const byDept = {};
  for (const t of active) {
    byDept[t.department] ??= { Critical: 0, High: 0, Medium: 0, Low: 0, n: 0 };
    byDept[t.department][t.severity]++;
    byDept[t.department].n++;
  }
  const max = Math.max(1, ...Object.values(byDept).map((d) => d.n));
  $("#load").innerHTML = Object.entries(byDept).sort((a, b) => b[1].n - a[1].n).map(([d, c]) => `
    <div class="bar-row"><span>${esc(d)}</span>
      <div class="bar" style="width:${(c.n / max) * 100}%">
        <span class="c" style="flex:${c.Critical}"></span><span class="h" style="flex:${c.High}"></span><span class="m" style="flex:${c.Medium}"></span><span class="lo" style="flex:${c.Low}"></span>
      </div><b>${c.n}</b></div>`).join("") || '<p class="muted small">No active tickets.</p>';
}

["#q", "#f-dept", "#f-cat", "#f-status"].forEach((s) => $(s).addEventListener("input", renderDashboard));

$("#rows").addEventListener("change", async (e) => {
  const id = e.target.dataset.status;
  if (!id) return;
  await api(`/api/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) });
  loadTickets();
});
$("#rows").addEventListener("click", (e) => {
  if (e.target.closest("select")) return;
  const tr = e.target.closest("tr[data-id]");
  if (tr) openDrawer(tickets.find((t) => t.id === tr.dataset.id));
});

$("#seed").addEventListener("click", async () => {
  const b = $("#seed");
  b.disabled = true;
  b.textContent = meta.engine === "claude" ? "Triaging samples with AI…" : "Loading…";
  try { await api("/api/demo/seed", { method: "POST" }); await loadTickets(); }
  catch (err) { alert(err.message); }
  finally { b.disabled = false; b.textContent = "Load demo data"; }
});
$("#reset").addEventListener("click", async () => {
  if (!confirm("Delete all tickets?")) return;
  await api("/api/tickets", { method: "DELETE" });
  loadTickets();
});

/* ---------- Ticket drawer ---------- */
function openDrawer(t) {
  $("#drawer-body").innerHTML = `
    <h2 style="font-size:1.2rem">${esc(t.title)}</h2>
    <span class="pill sev-${t.severity}">${t.severity}</span> <span class="tag">${t.id}</span> <span class="tag">P${t.priority}</span> <span class="tag">${t.status}</span>
    <div class="ticket-grid">
      <div class="field"><div class="k">Department</div><div class="v">${esc(t.department)}</div></div>
      <div class="field"><div class="k">Category</div><div class="v">${CAT_LABEL[t.category]}${t.subcategory ? ` · ${esc(t.subcategory)}` : ""}</div></div>
      <div class="field"><div class="k">Location</div><div class="v">${esc(t.location) || "Not given"}</div></div>
      <div class="field"><div class="k">SLA</div><div class="v">${slaText(t)}</div></div>
    </div>
    <div class="reason"><b>Why ${t.severity}:</b> ${esc(t.severity_reason)}</div>
    ${t.english_translation ? `<div class="section"><b>Complaint (English)</b><p>${esc(t.english_translation)}</p></div>` : ""}
    ${t.missing_info?.length ? `<div class="notice warn"><b>Missing:</b> ${t.missing_info.map(esc).join("; ")}</div>` : ""}
    ${t.photo ? `<div class="section"><b>Photo</b>${t.photo_observation ? `<p class="small muted">AI: ${esc(t.photo_observation)}</p>` : ""}<img src="${esc(t.photo)}" alt="Citizen photo" /></div>` : ""}
    <div class="section"><b>Citizen reports (${t.reports.length})</b>
      <ul class="timeline">${t.reports.map((r) => `<li><div class="small muted">${new Date(r.at).toLocaleString()} · ${esc(r.language || "")}</div>${esc(r.text) || "<i>photo only</i>"}</li>`).join("")}</ul>
    </div>
    <p class="meta">Triaged by ${t.engine === "claude" ? "Claude" : "offline rules engine"} · confidence ${esc(t.confidence)}</p>`;
  $("#drawer").hidden = false;
}
$("#drawer-close").addEventListener("click", () => ($("#drawer").hidden = true));
$("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") $("#drawer").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#drawer").hidden = true; });

setInterval(() => { if (!$("#view-dashboard").hidden) loadTickets(); }, 15000);
init();
