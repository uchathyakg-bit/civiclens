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
  crew: svg('<path d="M3 17h2l2-5h10l2 5h2M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M9 12V8h6l2 4"/>'),
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
  const known = ["report", "track", "reviews", "dashboard"];
  const v = known.includes(view) ? view : "report";
  for (const k of known) $(`#view-${k}`).hidden = k !== v;
  $$(".mainnav a").forEach((a) => { const on = a.dataset.view === v; a.classList.toggle("active", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
  if (v === "report") initPicker();
  if (v === "dashboard") loadTickets(true);
  if (v === "reviews") loadReviews();
  if (v === "track") {
    if (param) { $("#track-id").value = decodeURIComponent(param); trackLookup(decodeURIComponent(param)); }
    else { $("#track-result").innerHTML = ""; $("#track-id").focus(); }
  }
  closeDrawer();
  window.scrollTo({ top: 0 });
}

/* ---------- Accessibility tools (government-site conventions) ---------- */
$("#skip").addEventListener("click", (e) => { e.preventDefault(); const m = $("main:not([hidden])"); m?.setAttribute("tabindex", "-1"); m?.focus(); });
function setFontScale(step) {
  const scale = [0.9, 1, 1.12][step + 1];
  document.documentElement.style.setProperty("--fs", scale);
  $$(".fs button").forEach((b) => b.classList.toggle("on", Number(b.dataset.fs) === step));
  store.set("civiclens-fs", String(step));
}
$$(".fs button").forEach((b) => b.addEventListener("click", () => setFontScale(Number(b.dataset.fs))));
setFontScale(Number(store.get("civiclens-fs") ?? 0) || 0);
$("#last-updated").textContent = `Last updated: ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`;

/* Click any photo marked data-zoom to view it full size. */
document.addEventListener("click", (e) => {
  const img = e.target.closest("img[data-zoom]");
  if (!img) return;
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Photo");
  box.innerHTML = `<img src="${esc(img.src)}" alt="${esc(img.alt)}" />`;
  box.addEventListener("click", () => box.remove());
  document.addEventListener("keydown", function k(ev) { if (ev.key === "Escape") { box.remove(); document.removeEventListener("keydown", k); } });
  document.body.append(box);
});

/* Header figures: open grievances and average citizen rating. */
async function refreshMasthead() {
  try {
    const st = await api("/api/stats");
    $("#m-open").textContent = st.open;
    $("#m-rating").textContent = st.averageRating ? `${st.averageRating}★` : "–";
    const vals = [st.open, st.criticalTotal ? `${st.criticalDispatched}/${st.criticalTotal}` : "–", st.resolved, st.averageRating ? `${st.averageRating}★` : "–"];
    $$("#live-stats dd").forEach((dd, i) => { dd.textContent = vals[i]; });
    $("#live-foot").textContent = st.criticalDispatched
      ? `Every critical issue so far got a field crew ${st.avgCriticalDispatchMinutes ? `in ${st.avgCriticalDispatchMinutes} min on average` : "the moment it was filed"}. ${st.crewsOnJob} of ${st.crews} crews are on a job now.`
      : `Critical issues are dispatched to a field crew automatically. ${st.crews} crews on the roster.`;
  } catch { /* header figures are decorative */ }
}

/* ---------- Shared bits for maps, stars, photos and reviews ---------- */
const EXACT = new Set(["gps", "pin", "officer"]);
function addBaseLayers(m) {
  const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" });
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery &copy; Esri" });
  street.addTo(m);
  L.control.layers({ Street: street, Satellite: sat }, null, { position: "topright" }).addTo(m);
  let warned = false;
  for (const layer of [street, sat]) layer.on("tileerror", () => { if (!warned) { warned = true; toast("Some map tiles couldn't load. Pins still work.", "error"); } });
}
function pinIcon(color = "#0b3a75") {
  return L.divIcon({
    className: "pin-icon", iconSize: [30, 42], iconAnchor: [15, 41],
    html: `<svg width="30" height="42" viewBox="0 0 30 42"><path d="M15 41S2 25.5 2 15a13 13 0 0 1 26 0c0 10.5-13 26-13 26Z" fill="${color}" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>`,
  });
}
const stars = (n, size = "") => `<span class="stars" style="${size}" aria-label="${n} out of 5 stars">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= Math.round(n) ? "" : "off"}">★</span>`).join("")}</span>`;
const initials = (s) => (s || "?").split(/\s+/).filter((w) => /\p{L}/u.test(w[0] || "")).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

function reviewEntry(r) {
  const dept = r.by === "department";
  return `<div class="entry">
    <span class="avatar ${dept ? "dept" : "citizen"}">${esc(initials(r.name))}</span>
    <div>
      <div class="who"><b>${esc(r.name)}</b><span class="role ${dept ? "dept" : "citizen"}">${dept ? "Department update" : "Citizen review"}</span>${r.rating ? stars(r.rating) : ""}<span class="when">${fmtDate(r.at)}</span></div>
      ${r.text ? `<p>${esc(r.text)}</p>` : ""}
      ${r.photo ? `<img src="${esc(r.photo)}" alt="Photo from ${esc(r.name)}" data-zoom loading="lazy" />` : ""}
    </div>
  </div>`;
}

/* A small reusable "attach photo" control for review forms. Returns a getter for the resized data URL. */
function photoInput(root) {
  let data = null;
  const input = $("input[type=file]", root), thumb = $("img", root), btn = $("button", root);
  btn.addEventListener("click", () => (data ? clear() : input.click()));
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { input.value = ""; return toast("That file isn't an image.", "error"); }
    if (f.size > MAX_PHOTO_MB * 1024 * 1024) { input.value = ""; return toast(`Photo is over ${MAX_PHOTO_MB} MB.`, "error"); }
    try { data = await resizeImage(f, 1024); } catch { input.value = ""; return toast("Couldn't read that image.", "error"); }
    thumb.src = data; thumb.hidden = false; btn.textContent = "Remove photo";
  });
  function clear() { data = null; input.value = ""; thumb.hidden = true; btn.textContent = "Attach photo"; }
  return { get: () => data, clear };
}
const photoField = () => `<span class="photo-pick"><input type="file" accept="image/*" hidden /><img alt="Attached photo" hidden /><button type="button" class="btn btn-ghost btn-sm">Attach photo</button></span>`;

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

/* ---------- Exact-location picker: draggable pin, place search, GPS, street/satellite ---------- */
let picker, pickMarker, accCircle, pick = null, pickSeq = 0;
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

async function initPicker() {
  if (picker) { setTimeout(() => picker.invalidateSize(), 0); return; }
  if (!(await loadScript(LEAFLET, "L"))) {
    $("#picker").innerHTML = `<div class="map-msg"><div><b>The map couldn't load</b><p>Describe the place in the text instead, or use "My location".</p></div></div>`;
    return;
  }
  if (picker) return; // another call finished first
  const c = meta.cityCenter || { lat: 12.9716, lng: 77.5946 };
  picker = L.map("picker", { scrollWheelZoom: false, zoomControl: true }).setView([c.lat, c.lng], 12);
  addBaseLayers(picker);
  // Wheel zoom only once the citizen is working with the map, so the page still scrolls normally.
  picker.on("click focus", () => picker.scrollWheelZoom.enable());
  picker.getContainer().addEventListener("mouseleave", () => picker.scrollWheelZoom.disable());
  picker.on("click", (e) => setPick(e.latlng.lat, e.latlng.lng, "pin"));
}

function setPick(lat, lng, source, { address = "", accuracy = 0, zoom } = {}) {
  if (!picker) return;
  pick = { lat, lng, source, address };
  if (!pickMarker) {
    pickMarker = L.marker([lat, lng], { draggable: true, autoPan: true, icon: pinIcon(), keyboard: true, title: "Drag to the exact spot" }).addTo(picker);
    pickMarker.on("dragend", () => { const p = pickMarker.getLatLng(); setPick(p.lat, p.lng, "pin"); });
  } else pickMarker.setLatLng([lat, lng]);
  accCircle?.remove();
  accCircle = source === "gps" && accuracy ? L.circle([lat, lng], { radius: accuracy, color: "#0b3a75", weight: 1, fillOpacity: 0.08 }).addTo(picker) : null;
  if (zoom) picker.setView([lat, lng], zoom);
  $("#pick-clear").hidden = false;
  showPickStatus(address ? address : "Looking up the address…", accuracy);
  if (!address) {
    const seq = ++pickSeq;
    api(`/api/geo/reverse?lat=${lat}&lng=${lng}`).then((r) => {
      if (seq !== pickSeq || !pick) return;
      pick.address = r.address || "";
      showPickStatus(pick.address || "Address not found, but the pin position will be sent", accuracy);
    }).catch(() => { if (seq === pickSeq) showPickStatus("Address lookup unavailable, but the pin position will be sent", accuracy); });
  }
}
function showPickStatus(text, accuracy) {
  const el = $("#pick-status");
  el.classList.add("set");
  $("span", el).innerHTML = `<b>${esc(text)}</b><br><span class="muted">${pick.lat.toFixed(5)}, ${pick.lng.toFixed(5)} · ${pick.source === "gps" ? `GPS${accuracy ? ` ±${Math.round(accuracy)} m` : ""}` : "pin placed"} · drag the pin to adjust</span>`;
}
function clearPick() {
  pick = null; pickSeq++;
  pickMarker?.remove(); pickMarker = null;
  accCircle?.remove(); accCircle = null;
  $("#pick-clear").hidden = true;
  $("#pick-status").classList.remove("set");
  $("#pick-status span").textContent = "No location marked yet. Search, use your location, or tap the map.";
}
$("#pick-clear").addEventListener("click", clearPick);

$("#geo").addEventListener("click", async () => {
  if (!navigator.geolocation) return toast("This browser can't share location. Search or tap the map instead.", "error");
  await initPicker();
  const b = $("#geo");
  $("span", b).textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $("span", b).textContent = "My location";
      setPick(pos.coords.latitude, pos.coords.longitude, "gps", { accuracy: pos.coords.accuracy, zoom: 18 });
      toast(pos.coords.accuracy > 100 ? `Location found (±${Math.round(pos.coords.accuracy)} m). Drag the pin to the exact spot.` : "Location found. Drag the pin if it's slightly off.", "success");
    },
    (err) => {
      $("span", b).textContent = "My location";
      toast(err.code === 1 ? "Location permission was denied. Search a place or tap the map instead." : "Couldn't get your location. Search a place or tap the map instead.", "error");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
});

let searchTimer, searchSeq = 0, lastResults = [];
$("#place-q").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 3) { $("#place-results").hidden = true; return; }
  searchTimer = setTimeout(() => runPlaceSearch(q), 450);
});
$("#place-q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); if (lastResults[0]) choosePlace(0); else runPlaceSearch(e.target.value.trim()); }
  if (e.key === "Escape") $("#place-results").hidden = true;
  if (e.key === "ArrowDown") { e.preventDefault(); $("#place-results button")?.focus(); }
});
async function runPlaceSearch(q) {
  const box = $("#place-results");
  const seq = ++searchSeq;
  box.hidden = false;
  box.innerHTML = `<span class="muted">Searching…</span>`;
  let res = [];
  try { res = await api(`/api/geo/search?q=${encodeURIComponent(q)}`); } catch { /* shown below */ }
  if (seq !== searchSeq) return;
  lastResults = res;
  box.innerHTML = res.length
    ? res.map((r, i) => `<button type="button" role="option" data-i="${i}">${esc(r.label)}</button>`).join("")
    : `<span class="muted">No matches. Try a nearby landmark, or tap the map.</span>`;
}
$("#place-results").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) choosePlace(Number(b.dataset.i)); });
$("#place-results").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); e.target.nextElementSibling?.focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); (e.target.previousElementSibling || $("#place-q")).focus(); }
  if (e.key === "Escape") { $("#place-results").hidden = true; $("#place-q").focus(); }
});
document.addEventListener("click", (e) => { if (!e.target.closest(".picker-search")) $("#place-results").hidden = true; });
async function choosePlace(i) {
  const r = lastResults[i];
  if (!r) return;
  $("#place-results").hidden = true;
  $("#place-q").value = r.label;
  await initPicker();
  setPick(r.lat, r.lng, "pin", { address: r.label, zoom: 17 });
  toast("Place found. Drag the pin to the exact spot.", "success");
}

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#text").value.trim();
  if (!text && !photoData) {
    toast("Please describe the problem or add a photo.", "error");
    $("#text").focus();
    return;
  }
  const where = pick ? { lat: pick.lat, lng: pick.lng, locSource: pick.source, address: pick.address } : {};
  try { await submitComplaint({ text, photo: photoData, ...where }); clearPick(); $("#place-q").value = ""; } catch { /* toast already shown */ }
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
    refreshMasthead();
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

function crewBox(c, sev, critical) {
  if (!c) return "";
  const eta = new Date(c.eta).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return critical
    ? `<div class="dispatch-banner"><span class="siren">${ICON.alert}</span><div><b>Emergency crew dispatched: ${esc(c.name)}</b><span>${c.by === "auto" ? "Assigned automatically because this is Critical" : "Assigned by an officer"} · expected on site by <b style="display:inline">${eta}</b></span></div></div>`
    : `<div class="crew-box"><span class="cat-icon sm">${ICON.crew}</span><div><b>${esc(c.name)}</b> is assigned<div class="small muted">Expected on site by ${eta} (${sev} priority target)</div></div></div>`;
}

function renderTicket({ ticket: t, merged, engine, ms, citizen_reply, aiError }) {
  $("#result").innerHTML = `
    <article class="card ticket has-panel">
      <div class="confirm-panel ${merged ? "merged" : ""}">
        <h2>${merged ? "Added to an existing grievance" : "Grievance submitted"}</h2>
        <div class="ref">Your reference number<b>${esc(t.id)}</b></div>
      </div>
      <div class="ticket-inner">
        <div class="ticket-head">
          <span class="cat-icon sev-${t.severity}">${ICON[t.category]}</span>
          <div>
            <div class="ticket-id">TICKET ${esc(t.id)} · ${CAT_LABEL[t.category]}${t.subcategory ? ` · ${esc(t.subcategory)}` : ""}</div>
            <div class="ticket-title">${esc(t.title)}</div>
          </div>
          <span class="badge sev-${t.severity}">${t.severity}</span>
        </div>
        ${crewBox(t.crew, t.severity, t.severity === "Critical")}
        <div class="notice">Save your reference number <b>${esc(t.id)}</b> to track progress on the <a href="#track/${esc(t.id)}">Track status</a> page.</div>
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
   DEMO MODE: 5 complaints, each showing off one feature
   ============================================================ */
// A clean, sunny park scene. Used with a garbage complaint so the AI's photo check can flag the mismatch.
function parkPhoto() {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 480;
  const x = c.getContext("2d");
  const sky = x.createLinearGradient(0, 0, 0, 300); sky.addColorStop(0, "#7cc4f5"); sky.addColorStop(1, "#cfeafc");
  x.fillStyle = sky; x.fillRect(0, 0, 640, 300);
  x.fillStyle = "#fff4b8"; x.beginPath(); x.arc(540, 80, 40, 0, 7); x.fill();
  x.fillStyle = "#5fb04a"; x.fillRect(0, 300, 640, 180);
  x.fillStyle = "#c9b28a"; x.beginPath(); x.moveTo(250, 480); x.lineTo(330, 300); x.lineTo(350, 300); x.lineTo(430, 480); x.fill();
  x.fillStyle = "#6b4a2b"; x.fillRect(120, 200, 26, 130);
  x.fillStyle = "#2f8a3a"; for (const [cx, cy, r] of [[133, 170, 70], [95, 205, 48], [172, 205, 48]]) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); }
  x.fillStyle = "#8a5a2b"; x.fillRect(450, 350, 120, 12); x.fillRect(450, 330, 120, 8); x.fillRect(458, 362, 8, 26); x.fillRect(554, 362, 8, 26);
  return c.toDataURL("image/jpeg", 0.85);
}

const DEMO = [
  { title: "Any language", text: "Kannada complaint → triaged, routed, and answered in Kannada",
    complaint: "ಹೆಬ್ಬಾಳ ಫ್ಲೈಓವರ್ ಹತ್ತಿರ ರಸ್ತೆಯಲ್ಲಿ ದೊಡ್ಡ ಗುಂಡಿ ಇದೆ, ನಿನ್ನೆ ರಾತ್ರಿ ಒಬ್ಬ ಬೈಕ್ ಸವಾರ ಬಿದ್ದರು.", at: [13.03525, 77.59712] },
  { title: "Life-safety first", text: "Live wire near a school → Critical, sent to the power utility's emergency line",
    complaint: "There is an electric wire hanging very low and sparking near Govt Primary School, 4th Cross Malleshwaram. Kids walk here every morning!", at: [12.99652, 77.57134] },
  { title: "Duplicate detection", text: "Same wire reported again, in other words and pinned 25 m away → merged into the existing ticket (×2)",
    complaint: "Sparking wire hanging near the Govt Primary School, 4th Cross Malleshwaram, please send someone urgently", at: [12.99671, 77.57151] },
  { title: "Facts over tone", text: "Shouting \"URGENT!!!\" about a faded sign → still Low priority",
    complaint: "URGENT!!! EMERGENCY!!! PLEASE ACT IMMEDIATELY!!! The road name signboard at Cubbon Road is slightly faded!!!" },
  { title: "Photo cross-check", text: "Garbage complaint with a photo of a clean park → the AI flags that the photo doesn't match",
    complaint: "Huge garbage pile dumped on the footpath near Ulsoor Lake, nobody has cleared it for a week", photo: parkPhoto },
];

let demoRunning = false, demoStop = false, demoConfirmTimer;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

$("#demo").addEventListener("click", async () => {
  const b = $("#demo");
  if (demoRunning) return;
  if (!b.classList.contains("confirm")) {
    b.classList.add("confirm");
    $("span", b).textContent = "Click again to start (clears tickets)";
    demoConfirmTimer = setTimeout(() => { b.classList.remove("confirm"); $("span", b).textContent = "Demo mode"; }, 4000);
    return;
  }
  clearTimeout(demoConfirmTimer);
  b.classList.remove("confirm");
  $("span", b).textContent = "Demo mode";
  runDemo();
});
$("#demo-stop").addEventListener("click", () => { demoStop = true; $("#demo-text").textContent = "Stopping after this step…"; });

async function typeInto(el, text) {
  el.value = "";
  const step = Math.max(1, Math.ceil(text.length / 45));
  for (let i = 0; i < text.length && !demoStop; i += step) {
    el.value = text.slice(0, i + step);
    el.dispatchEvent(new Event("input"));
    await sleep(18);
  }
  el.value = text;
  el.dispatchEvent(new Event("input"));
}

async function runDemo() {
  demoRunning = true; demoStop = false;
  $("#demo").disabled = true;
  $("#demo-banner").hidden = false;
  document.body.classList.add("demo");
  try {
    await api("/api/tickets", { method: "DELETE" });
    loaded = false;
    for (let i = 0; i < DEMO.length && !demoStop; i++) {
      const d = DEMO[i];
      $("#demo-steps").innerHTML = DEMO.map((_, j) => `<i class="${j < i ? "done" : j === i ? "now" : ""}"></i>`).join("");
      $("#demo-title").textContent = `Demo ${i + 1} of ${DEMO.length} · ${d.title}`;
      $("#demo-text").textContent = d.text + (d.photo && meta.engine !== "claude" ? " (the photo check needs the AI engine; the rules engine notes the photo but can't see it)" : "");
      window.scrollTo({ top: 0, behavior: "smooth" });
      clearPhoto();
      clearPick();
      await typeInto($("#text"), d.complaint);
      if (d.photo) {
        photoData = d.photo();
        $(".drop-preview img", drop).src = photoData;
        $("#photo-name").textContent = "park.jpg";
        $("#photo-size").textContent = "Demo photo";
        $(".drop-empty", drop).hidden = true;
        $(".drop-preview", drop).hidden = false;
        drop.classList.add("has-photo");
      }
      let where = {};
      if (d.at) {
        await initPicker();
        setPick(d.at[0], d.at[1], "pin", { zoom: 17 });
        where = { lat: d.at[0], lng: d.at[1], locSource: "pin" };
      }
      await sleep(d.at ? 1200 : 500);
      if (pick?.address) where.address = pick.address;
      await submitComplaint({ text: d.complaint, photo: photoData, ...where });
      clearPick();
      await sleep(i === DEMO.length - 1 ? 1500 : 4500);
    }
    if (!demoStop) {
      toast("Demo finished. Open the dashboard to see the queue, map and charts.", "success", 6000);
      $("#demo-title").textContent = "Demo complete";
      $("#demo-text").textContent = "All 5 complaints are now in the officer queue, sorted by priority.";
      $("#demo-steps").innerHTML = DEMO.map(() => '<i class="done"></i>').join("");
      await sleep(4000);
    }
  } catch (err) {
    toast(`Demo stopped: ${err.message}`, "error", 6000);
  } finally {
    demoRunning = false;
    $("#demo").disabled = false;
    $("#demo-banner").hidden = true;
    document.body.classList.remove("demo");
  }
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
        ${crewBox(t.crew, t.severity, t.severity === "Critical" && t.status !== "Resolved")}
        <div class="facts">
          <div class="fact"><div class="k">Handled by</div><div class="v">${esc(t.department)}</div></div>
          <div class="fact"><div class="k">Location</div><div class="v">${esc(t.location) || "Not given"}</div></div>
          <div class="fact"><div class="k">Citizens reporting</div><div class="v">${t.reportCount}</div></div>
        </div>
        ${t.geo || t.photo ? `<div class="${t.geo && t.photo ? "rv-body" : ""}" style="padding:0">
          ${t.photo ? `<div><div class="d-section" style="margin-top:0"><h3>Your photo</h3></div><img class="d-photo" src="${esc(t.photo)}" alt="Photo of the issue" data-zoom /></div>` : ""}
          ${t.geo ? `<div><div class="d-section" style="margin-top:0"><h3>${EXACT.has(t.geo.source) ? "Exact location" : "Approximate location"}</h3></div><div class="mini-map" id="track-map"></div></div>` : ""}
        </div>` : ""}
        <div class="d-section" style="margin-top:0"><h3>Reviews &amp; department updates (${t.reviews.length})</h3>
          ${t.reviews.length ? `<div class="entries">${t.reviews.map(reviewEntry).join("")}</div>` : `<p class="muted small">No updates or reviews yet.</p>`}
        </div>
        ${t.status === "Resolved"
          ? `<form class="review-form" id="review-form" data-id="${esc(t.id)}" novalidate>
              <h3>How well was this fixed?</h3>
              <fieldset class="star-input" aria-label="Your rating">
                ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="st${n}" value="${n}" /><label for="st${n}" title="${n} star${n > 1 ? "s" : ""}">★</label>`).join("")}
              </fieldset>
              <textarea name="text" maxlength="1000" placeholder="Tell others what happened, e.g. Pothole was filled within a day and the road is smooth now."></textarea>
              <div class="row">
                <input name="name" maxlength="40" placeholder="Your name (optional)" class="status-select" style="cursor:text" aria-label="Your name" />
                ${photoField()}
                <span class="spacer"></span>
                <button class="btn btn-accent" type="submit">Post review</button>
              </div>
            </form>`
          : `<div class="notice">You can rate the work and add an "after" photo once the department marks this ticket <b>Resolved</b>.</div>`}
        <div class="d-section" style="margin-top:0"><h3>Updates</h3>
          <ul class="timeline">${[...t.history].reverse().map((h) => `<li class="${h.type}"><div class="when">${fmtDate(h.at)}</div>${esc(h.text)}</li>`).join("")}</ul>
        </div>
      </div>
    </article>`;

  if (t.geo && (await loadScript(LEAFLET, "L")) && $("#track-map")) {
    const m = L.map("track-map", { scrollWheelZoom: false }).setView([t.geo.lat, t.geo.lng], EXACT.has(t.geo.source) ? 17 : 13);
    addBaseLayers(m);
    L.marker([t.geo.lat, t.geo.lng], { icon: pinIcon(cssVar(SEV_VAR[t.severity])) }).addTo(m);
  }
  const form = $("#review-form");
  if (form) {
    const ph = photoInput($(".photo-pick", form));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rating = Number(form.rating.value);
      if (!rating) return toast("Please choose a star rating.", "error");
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      try {
        await api(`/api/tickets/${form.dataset.id}/reviews`, { method: "POST", body: JSON.stringify({ by: "citizen", rating, text: form.text.value, name: form.name.value, photo: ph.get() }) });
        toast("Thank you! Your review is now public on the Reviews page.", "success");
        refreshMasthead();
        trackLookup(form.dataset.id);
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  }
}

/* ============================================================
   PUBLIC REVIEWS
   ============================================================ */
let reviewData = null, reviewFilter = "all";
async function loadReviews() {
  const list = $("#review-list");
  if (!reviewData) list.innerHTML = `<div class="card"><div class="skel skel-line" style="width:40%;height:16px"></div><div class="skel skel-block" style="margin-top:12px;height:140px"></div></div>`;
  try { reviewData = await api("/api/reviews"); } catch (err) { list.innerHTML = `<div class="card empty"><span class="empty-icon">${ICON.alert}</span><h2>Couldn't load reviews</h2><p>${esc(err.message)}</p></div>`; return; }
  renderReviews();
}
function renderReviews() {
  const { summary: s, items } = reviewData;
  const best = Object.entries(s.byDepartment).sort((a, b) => b[1].average - a[1].average || b[1].count - a[1].count)[0];
  $("#review-summary").innerHTML = [
    ["rating", "★", s.averageRating ? `${s.averageRating}<small style="font-size:.9rem;color:var(--muted)">/5</small>` : "–", `Average rating · ${s.ratings} review${s.ratings === 1 ? "" : "s"}`],
    ["merged", ICON.inbox, s.resolved, "Grievances resolved"],
    ["open", ICON.chat, s.updates, "Department updates"],
    ["rating", "🏆", best ? `${best[1].average}★` : "–", best ? `Top rated: ${esc(best[0])}` : "Top rated department"],
  ].map(([cls, icon, n, l]) => `<div class="stat ${cls}"><span class="stat-icon" style="font-size:1.2rem">${icon}</span><div style="min-width:0"><div class="n">${n}</div><div class="l">${l}</div></div></div>`).join("");

  const filters = [["all", "All"], ["citizen", "Citizen reviews"], ["department", "Department updates"], ["photos", "With photos"]];
  $("#review-filter").innerHTML = filters.map(([k, l]) => `<button class="chip ${reviewFilter === k ? "active" : ""}" data-f="${k}">${l}</button>`).join("");

  const pass = (r) => reviewFilter === "all" || (reviewFilter === "photos" ? Boolean(r.photo) : r.by === reviewFilter);
  const shown = items.map((it) => ({ ...it, reviews: it.reviews.filter(pass) })).filter((it) => it.reviews.length);
  if (!shown.length) {
    $("#review-list").innerHTML = `<div class="card empty"><span class="empty-icon">${ICON.chat}</span><h2>${items.length ? "Nothing matches this filter" : "No reviews yet"}</h2>
      <p>${items.length ? "Try another filter." : "Departments post updates with photo proof, and citizens rate the fix once a grievance is resolved. Both appear here."}</p>
      ${items.length ? "" : '<div class="btns"><a class="btn btn-primary" href="#dashboard">Open officer dashboard</a></div>'}</div>`;
    return;
  }
  $("#review-list").innerHTML = shown.map((it) => {
    const rated = it.reviews.filter((r) => r.rating);
    const avg = rated.length ? rated.reduce((n, r) => n + r.rating, 0) / rated.length : 0;
    return `<article class="card rv-card">
      <div class="rv-head">
        <span class="cat-icon sm">${ICON[it.category]}</span>
        <div style="min-width:0"><div class="ticket-id">${esc(it.id)} · ${esc(it.department)}</div><div class="ticket-title">${esc(it.title)}</div></div>
        <div class="right">${avg ? stars(avg) : ""}<span class="status-badge st-${it.status.replace(/\s/g, "")}">${esc(it.status)}</span><a class="btn btn-ghost btn-sm" href="#track/${esc(it.id)}">View</a></div>
      </div>
      <div class="rv-body">
        <div class="ba">
          <figure>${it.before ? `<img src="${esc(it.before)}" alt="Before: photo from the citizen" data-zoom loading="lazy" />` : `<div class="ph">No photo from citizen</div>`}<figcaption>Before</figcaption></figure>
          <figure>${it.after ? `<img src="${esc(it.after)}" alt="After: photo from the department" data-zoom loading="lazy" />` : `<div class="ph">No "after" photo yet</div>`}<figcaption>After</figcaption></figure>
        </div>
        <div class="entries">${it.reviews.map(reviewEntry).join("")}</div>
      </div>
    </article>`;
  }).join("");
}
$("#review-filter").addEventListener("click", (e) => { const c = e.target.closest("[data-f]"); if (!c) return; reviewFilter = c.dataset.f; renderReviews(); });

/* ============================================================
   OFFICER DASHBOARD
   ============================================================ */
let tickets = [];
let loaded = false;
let serverDown = false;
let crews = [];
const F = { q: "", sev: "", cat: "", status: "active", dept: "" };

async function loadTickets(showSkeleton = false) {
  if (showSkeleton && !loaded) renderListSkeleton();
  try {
    [tickets, crews] = await Promise.all([api("/api/tickets"), api("/api/crews")]);
    loaded = true;
    if (serverDown) { serverDown = false; toast("Reconnected to the server", "success"); }
    renderDashboard();
  } catch (err) {
    // Auto-refresh runs every 15s: tell the officer once, not on every failed poll.
    if (!serverDown) toast(err.message, "error", 6000);
    serverDown = true;
    if (!loaded) $("#list").innerHTML = `<div class="empty"><span class="empty-icon">${ICON.alert}</span><h2>Can't load tickets</h2><p>${esc(err.message)} The page retries automatically every 15 seconds.</p></div>`;
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
  const ratings = tickets.flatMap((t) => (t.reviews || []).filter((r) => r.rating).map((r) => r.rating));
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  $("#m-open").textContent = active.length;
  $("#stats").innerHTML = [
    ["open", ICON.inbox, active.length, "Open tickets"],
    ["critical", ICON.alert, critical, "Critical"],
    ["overdue", ICON.clock, overdue, "Past SLA"],
    ["crewstat", ICON.crew, `${crews.filter((c) => c.load).length}<small style="font-size:.9rem;color:var(--muted)">/${crews.length}</small>`, "Crews on a job"],
    ["merged", ICON.merge, merged, "Duplicates merged"],
    ["rating", '<span style="font-size:1.3rem">★</span>', avgRating ? avgRating.toFixed(1) : "–", `Citizen rating${ratings.length ? ` · ${ratings.length}` : ""}`],
  ].map(([cls, icon, n, l]) => `<div class="stat ${cls} ${n ? "on" : ""}"><span class="stat-icon">${icon}</span><div><div class="n">${n}</div><div class="l">${l}</div></div></div>`).join("");

  // Field crews: load against capacity; click a job to open it
  // Busy crews first as cards; free crews collapse into one compact row.
  const onJob = crews.filter((c) => c.load).sort((a, b) => b.load / b.capacity - a.load / a.capacity);
  const free = crews.filter((c) => !c.load);
  $("#crews").innerHTML = (onJob.length ? "" : `<p class="muted small" style="grid-column:1/-1">All crews are free right now.</p>`) + onJob.map((c) => {
    const ratio = c.load / c.capacity;
    const cls = c.load >= c.capacity ? "full" : c.load ? "busy" : "";
    return `<div class="crew ${cls}">
      <div class="crew-top"><b title="${esc(c.name)}">${esc(c.name)}</b><span>${c.load}/${c.capacity}</span></div>
      <div class="crew-dept" title="${esc(c.dept)}">${esc(c.dept)}</div>
      <div class="crew-bar"><i style="width:${Math.min(100, ratio * 100)}%"></i></div>
      ${c.tickets.length ? `<div class="crew-jobs">${c.tickets.map((j) => `<button class="badge sev-${j.severity}" data-open="${esc(j.id)}" title="${esc(j.title)}">${esc(j.id)}</button>`).join("")}</div>` : '<div class="crew-dept">Available</div>'}
    </div>`;
  }).join("") + (free.length ? `<div class="crew-free"><span class="crew-free-label"><i class="cl-free"></i>Available (${free.length})</span>${free.map((c) => `<span class="free-pill" title="${esc(c.name)} · ${esc(c.dept)}">${esc(c.id)}</span>`).join("")}</div>` : "");

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
      <th>#</th><th>Severity</th><th>Issue</th><th class="t-dept-col">Department · crew</th><th>SLA</th><th>Status</th>
    </tr></thead><tbody>${list.map((t, i) => {
      const sla = slaInfo(t);
      const crewCell = t.crew
        ? `<span class="crew-tag ${t.crew.by === "auto" ? "auto" : ""}" title="${esc(t.crew.name)}">${ICON.crew.replace("<svg", '<svg width="13" height="13"')}${esc(t.crew.id)}${t.crew.by === "auto" ? " · auto" : ""}</span>`
        : t.status !== "Resolved" && t.suggestedCrew?.id
          ? `<button class="assign-btn" data-assign="${t.id}" data-crew="${esc(t.suggestedCrew.id)}" title="Assign ${esc(t.suggestedCrew.name)} (${t.suggestedCrew.load}/${t.suggestedCrew.capacity} jobs)">+ Assign ${esc(t.suggestedCrew.id)}</button>`
          : "";
      return `<tr data-id="${t.id}" class="${t.status === "Resolved" ? "resolved" : ""} ${t.severity === "Critical" && t.status !== "Resolved" ? "crit-row" : ""}">
        <td class="c-rank muted">${i + 1}</td>
        <td class="c-sev"><div class="t-sev"><span class="badge sev-${t.severity}">${t.severity}</span><span class="score" title="Priority score">P${t.priority}</span></div></td>
        <td class="c-issue"><div class="t-issue"><span class="cat-icon sm">${ICON[t.category]}</span><div>
          <div class="t-title">${esc(t.title)}</div>
          <div class="t-reason">${esc(t.severity_reason)}</div>
          <div class="t-tags"><span class="tag mono">${t.id}</span>${t.reportCount > 1 ? `<span class="tag multi">×${t.reportCount} reports</span>` : ""}${t.location ? `<span class="tag">${esc(t.location)}</span>` : ""}${t.vulnerable_site ? '<span class="tag vuln">Vulnerable site</span>' : ""}${t.language !== "English" ? `<span class="tag">${esc(t.language)}</span>` : ""}${t.photo ? '<span class="tag">Photo</span>' : ""}${crewCell ? `<span class="m-only">${crewCell}</span>` : ""}</div>
        </div></div></td>
        <td class="t-dept t-dept-col">${esc(t.department)}<div style="margin-top:6px">${crewCell}</div></td>
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
    addBaseLayers(map);
    map.on("click focus", () => map.scrollWheelZoom.enable());
    map.getContainer().addEventListener("mouseleave", () => map.scrollWheelZoom.disable());
    pinLayer = L.layerGroup().addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 0);
  pinLayer.clearLayers();
  const placed = list.filter((t) => t.geo);
  for (const t of placed) {
    const color = cssVar(SEV_VAR[t.severity]);
    // Solid = exact spot (citizen pin, GPS or officer-confirmed). Half = matched from the text. Hollow = rough guess.
    const kind = EXACT.has(t.geo.source) ? "exact" : t.geo.source === "geocoded" ? "text" : "approx";
    L.circleMarker([t.geo.lat, t.geo.lng], {
      radius: 8 + Math.min(t.reportCount - 1, 4) * 2,
      color, weight: 2.5, fillColor: color, fillOpacity: { exact: 0.9, text: 0.45, approx: 0.12 }[kind], dashArray: kind === "approx" ? "4 3" : null,
    })
      .bindTooltip(`<b>${esc(t.id)} · ${t.severity}</b>${esc(t.title)}<br><i>${{ exact: "Exact spot", text: "Matched from the address text", approx: "Approximate location" }[kind]}</i>`)
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
$("#list").addEventListener("click", async (e) => {
  const assign = e.target.closest("[data-assign]");
  if (assign) {
    e.stopPropagation();
    assign.disabled = true;
    try {
      const t = await api(`/api/tickets/${assign.dataset.assign}`, { method: "PATCH", body: JSON.stringify({ crew: assign.dataset.crew }) });
      toast(`${t.crew.name} assigned to ${t.id}`, "success");
      loadTickets();
    } catch (err) { toast(err.message, "error"); assign.disabled = false; }
    return;
  }
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
    refreshMasthead();
  } catch (err) { toast(err.message, "error"); renderDashboard(); }
  finally { b.disabled = false; b.textContent = "Load demo data"; }
}
$("#seed").addEventListener("click", seed);
$("#crews").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openDrawer(b.dataset.open); });

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
    ${t.photo ? `<div class="d-section"><h3>Photo</h3>${t.photo_observation ? `<p class="small muted" style="margin-bottom:8px">AI: ${esc(t.photo_observation)}</p>` : ""}<img class="d-photo" src="${esc(t.photo)}" alt="Photo from citizen" data-zoom /></div>` : ""}
    <div class="d-section"><h3>Location · ${!t.geo ? "being located…" : EXACT.has(t.geo.source) ? ({ gps: "citizen's GPS", pin: "pinned by citizen", officer: "confirmed by officer" }[t.geo.source]) : t.geo.source === "geocoded" ? "matched from address text" : "approximate"}</h3>
      <div class="mini-map" id="drawer-map"></div>
      <div class="picker-foot">
        <span class="map-hint">Drag the pin to the exact spot, then save. ${t.geo ? `${t.geo.lat.toFixed(5)}, ${t.geo.lng.toFixed(5)}` : ""}</span>
        <button type="button" class="btn btn-primary btn-sm" id="save-geo" hidden>Save exact location</button>
      </div>
    </div>
    <div class="d-section"><h3>Field crew</h3>
      ${t.crew ? crewBox(t.crew, t.severity, t.severity === "Critical" && t.status !== "Resolved") : `<p class="small muted">No crew assigned yet.${t.suggestedCrew?.id ? ` Suggested: <b>${esc(t.suggestedCrew.name)}</b> (${t.suggestedCrew.load}/${t.suggestedCrew.capacity} jobs).` : ""}</p>`}
      <div class="crew-form">
        <select id="crew-pick" aria-label="Choose crew">${crews.filter((c) => c.dept === t.department).map((c) => `<option value="${c.id}" ${t.crew?.id === c.id ? "selected" : ""}>${esc(c.name)} · ${c.load}/${c.capacity} jobs</option>`).join("")}</select>
        <button type="button" class="btn btn-primary btn-sm" data-crew-act="set" data-id="${t.id}">${t.crew ? "Change crew" : "Assign crew"}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-crew-act="auto" data-id="${t.id}" title="Pick the least-loaded crew">Auto-pick</button>
        ${t.crew ? `<button type="button" class="btn btn-ghost btn-sm" data-crew-act="none" data-id="${t.id}">Unassign</button>` : ""}
      </div>
    </div>
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
    <div class="d-section"><h3>Post a public update (shown to citizens)</h3>
      <form class="review-form" id="dept-update" data-id="${t.id}" novalidate>
        <textarea name="text" maxlength="1000" placeholder="e.g. Crew filled the pothole with hot-mix asphalt. Road reopened at 4 pm."></textarea>
        <div class="row">
          ${photoField()}
          <label class="small" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" name="resolve" ${t.status === "Resolved" ? "checked disabled" : ""} /> Mark as Resolved</label>
          <span class="spacer"></span>
          <button class="btn btn-primary btn-sm" type="submit">Post update</button>
        </div>
      </form>
    </div>
    <div class="d-section"><h3>Reviews &amp; updates (${(t.reviews || []).length})</h3>
      ${(t.reviews || []).length ? `<div class="entries">${t.reviews.map(reviewEntry).join("")}</div>` : `<p class="muted small">None yet. Citizens can rate the fix once it's Resolved.</p>`}
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
  drawerPhoto = photoInput($("#dept-update .photo-pick"));
  initDrawerMap(t);
}

/* Officer location correction: a draggable pin in the drawer. */
let drawerPhoto = null;
async function initDrawerMap(t) {
  if (!(await loadScript(LEAFLET, "L")) || !$("#drawer-map")) return;
  const c = t.geo || meta.cityCenter || { lat: 12.9716, lng: 77.5946 };
  const m = L.map("drawer-map", { scrollWheelZoom: false }).setView([c.lat, c.lng], t.geo && EXACT.has(t.geo.source) ? 17 : 14);
  addBaseLayers(m);
  m.on("click focus", () => m.scrollWheelZoom.enable());
  const marker = L.marker([c.lat, c.lng], { draggable: true, autoPan: true, icon: pinIcon(cssVar(SEV_VAR[t.severity])), title: "Drag to the exact spot" }).addTo(m);
  let moved = null;
  const onMove = (ll) => { moved = ll; $("#save-geo").hidden = false; $(".map-hint").textContent = `New position: ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}. Save to confirm.`; };
  marker.on("dragend", () => onMove(marker.getLatLng()));
  m.on("click", (e) => { marker.setLatLng(e.latlng); onMove(e.latlng); });
  setTimeout(() => m.invalidateSize(), 350); // drawer is still sliding in
  $("#save-geo").addEventListener("click", async () => {
    if (!moved) return;
    const btn = $("#save-geo");
    btn.disabled = true;
    try {
      await api(`/api/tickets/${t.id}`, { method: "PATCH", body: JSON.stringify({ geo: { lat: moved.lat, lng: moved.lng } }) });
      toast(`Exact location saved for ${t.id}`, "success");
      fitted = false;
      await loadTickets();
      openDrawer(t.id);
    } catch (err) { toast(err.message, "error"); btn.disabled = false; }
  });
}

$("#drawer").addEventListener("submit", async (e) => {
  if (e.target.id !== "dept-update") return;
  e.preventDefault();
  const form = e.target, id = form.dataset.id;
  const text = form.text.value.trim(), photo = drawerPhoto?.get();
  if (!text && !photo) return toast("Write an update or attach a photo.", "error");
  const btn = $("button[type=submit]", form);
  btn.disabled = true;
  try {
    await api(`/api/tickets/${id}/reviews`, { method: "POST", body: JSON.stringify({ by: "department", text, photo }) });
    if (form.resolve.checked && !form.resolve.disabled) await api(`/api/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status: "Resolved" }) });
    toast(form.resolve.checked && !form.resolve.disabled ? `Update posted and ${id} marked Resolved` : "Update posted publicly", "success");
    await loadTickets();
    openDrawer(id);
  } catch (err) { toast(err.message, "error"); btn.disabled = false; }
});

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

$("#drawer").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-crew-act]");
  if (!b) return;
  const id = b.dataset.id, act = b.dataset.crewAct;
  const crew = act === "auto" ? "auto" : act === "none" ? null : $("#crew-pick")?.value;
  if (act === "set" && !crew) return toast("This department has no crews on the roster.", "error");
  b.disabled = true;
  try {
    const t = await api(`/api/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ crew }) });
    toast(t.crew ? `${t.crew.name} assigned to ${id}` : `Crew unassigned from ${id}`, "success");
    await loadTickets();
    openDrawer(id);
  } catch (err) { toast(err.message, "error"); b.disabled = false; }
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
  refreshMasthead();
}

setInterval(() => { if (!$("#view-dashboard").hidden && !document.hidden) loadTickets(); }, 15000);
init();
