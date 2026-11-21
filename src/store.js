// Ticket store (JSON file) + duplicate merging + crowd escalation.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, SEVERITIES, DEPARTMENT_LIST, DEFAULT_ROUTE, SLA_HOURS, CREWS, ETA_MINUTES, bumpSeverity, priorityScore } from "./taxonomy.js";

// Resolved from this file, not the working directory, so it works wherever the host starts the app.
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "tickets.json");
const ESCALATE_AT = 3; // reports from 3+ citizens bump severity one level

const empty = () => ({ nextId: 1001, tickets: [] });
let state = load();

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}
function save() {
  write(state);
}

// On startup: create data/tickets.json (and its folder) if missing. A corrupt file is
// set aside as tickets.json.corrupt-<time> rather than crashing the server or being overwritten silently.
function load() {
  if (!fs.existsSync(FILE)) {
    write(empty());
    console.log(`[store] created ${FILE}`);
    return empty();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (Array.isArray(parsed.tickets) && Number.isInteger(parsed.nextId)) return parsed;
    throw new Error("unexpected shape");
  } catch (err) {
    const backup = `${FILE}.corrupt-${Date.now()}`;
    fs.renameSync(FILE, backup);
    console.error(`[store] ${FILE} was unreadable (${err.message}); moved to ${backup} and started empty`);
    write(empty());
    return empty();
  }
}

const STOP = new Set(["near", "the", "opposite", "behind", "beside", "next", "front", "and", "road", "main", "cross", "there", "this", "please", "very", "since", "from", "with"]);
const tokens = (s) => new Set((s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)));
function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function openTickets() {
  return state.tickets.filter((t) => t.status !== "Resolved");
}

export const EXACT = new Set(["gps", "pin", "officer"]);
const DUP_RADIUS_M = 60;

function metres(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function findDuplicate(triage, coords) {
  const open = openTickets();
  if (triage.duplicate_of) {
    const t = open.find((x) => x.id === triage.duplicate_of);
    if (t) return t;
  }
  return open.find(
    (t) =>
      t.category === triage.category &&
      (
        // Both pinned on the map within ~60 m: same spot, same kind of problem.
        (coords && t.geo && EXACT.has(t.geo.source) && metres(coords, t.geo) <= DUP_RADIUS_M) ||
        (triage.location && t.location && jaccard(t.location, triage.location) >= 0.5) ||
        jaccard(t.english_translation, triage.english_translation) >= 0.45
      ),
  );
}

// Guard against any out-of-range values so the dashboard never shows garbage.
function sanitize(tr) {
  const category = CATEGORIES.includes(tr.category) ? tr.category : "other";
  return {
    ...tr,
    category,
    severity: SEVERITIES.includes(tr.severity) ? tr.severity : "Medium",
    department: DEPARTMENT_LIST.includes(tr.department) ? tr.department : DEFAULT_ROUTE[category],
    missing_info: Array.isArray(tr.missing_info) ? tr.missing_info : [],
  };
}

export const STATUSES = ["Open", "Assigned", "In Progress", "Resolved"];

const slaDue = (t) => new Date(new Date(t.createdAt).getTime() + SLA_HOURS[t.severity] * 36e5).toISOString();
const find = (id) => state.tickets.find((x) => x.id === id);

/* ---------- Field crews & dispatch ----------
 * Critical tickets get a crew the moment they're filed (or the moment they escalate to Critical).
 * Everything else gets a suggested crew that an officer can confirm in one click.
 * The crew chosen is the department's least-loaded one, relative to its capacity. */
function crewLoad() {
  const load = Object.fromEntries(CREWS.map((c) => [c.id, 0]));
  for (const t of state.tickets) if (t.status !== "Resolved" && t.crew?.id in load) load[t.crew.id]++;
  return load;
}
function bestCrew(dept) {
  const load = crewLoad();
  return CREWS.filter((c) => c.dept === dept)
    .map((c) => ({ ...c, load: load[c.id] }))
    .sort((a, b) => a.load / a.capacity - b.load / b.capacity || a.load - b.load)[0] || null;
}
const hhmm = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

function dispatch(t, crew, by, now = new Date().toISOString()) {
  if (!crew) return null;
  const eta = new Date(Date.parse(now) + ETA_MINUTES[t.severity] * 60000).toISOString();
  t.crew = { id: crew.id, name: crew.name, assignedAt: now, by, eta };
  t.history ??= [];
  t.history.push({ at: now, type: "dispatch", text: `${by === "auto" ? "Auto-dispatched (Critical)" : "Assigned"} to ${crew.name} · on site by ${hhmm(eta)}` });
  if (t.status === "Open") {
    t.status = "Assigned";
    t.history.push({ at: now, type: "status", status: "Assigned", text: "Status changed to Assigned" });
  }
  return t.crew;
}
function autoDispatchIfCritical(t) {
  if (t.severity === "Critical" && !t.crew && t.status !== "Resolved") dispatch(t, bestCrew(t.department), "auto");
}

export function crewsStatus() {
  const load = crewLoad();
  return CREWS.map((c) => ({
    ...c, load: load[c.id],
    tickets: state.tickets.filter((t) => t.status !== "Resolved" && t.crew?.id === c.id).map((t) => ({ id: t.id, severity: t.severity, title: t.title })),
  }));
}

/** coords: { lat, lng, source: "gps" | "pin", address? } from the citizen's map pin or phone GPS. */
export function addComplaint({ triage, text, photo, engine, coords }) {
  const tr = sanitize(triage);
  const now = new Date().toISOString();
  const report = { at: now, text, language: tr.language, photo: photo || null };
  // A pinned address is better than nothing when the text named no place.
  if (!tr.location && coords?.address) {
    tr.location = coords.address;
    tr.missing_info = tr.missing_info.filter((m) => !/location|landmark/i.test(m));
  }

  const dup = findDuplicate(tr, coords);
  if (dup) {
    dup.reports.push(report);
    dup.history.push({ at: now, type: "report", text: `Another citizen reported this (${dup.reports.length} reports)` });
    if (SEVERITIES.indexOf(tr.severity) > SEVERITIES.indexOf(dup.severity)) {
      dup.severity = tr.severity;
      dup.severity_reason = tr.severity_reason;
    }
    if (dup.reports.length >= ESCALATE_AT && !dup.escalated && dup.severity !== "Critical") {
      dup.escalated = true;
      dup.severity = bumpSeverity(dup.severity);
      dup.severity_reason += ` · Escalated: reported by ${dup.reports.length} citizens`;
      dup.history.push({ at: now, type: "escalated", text: `Severity raised to ${dup.severity} after ${dup.reports.length} reports` });
    }
    autoDispatchIfCritical(dup);
    if (!dup.photo && photo) dup.photo = photo;
    if (coords && !EXACT.has(dup.geo?.source)) dup.geo = { ...coords };
    dup.updatedAt = now;
    save();
    return { ticket: dup, merged: true };
  }

  const ticket = {
    id: `CL-${state.nextId++}`,
    createdAt: now,
    updatedAt: now,
    status: "Open",
    engine,
    ...tr,
    photo: photo || null,
    reports: [report],
    escalated: false,
    geo: coords ? { ...coords } : null,
    reviews: [],
    history: [{ at: now, type: "status", status: "Open", text: "Complaint received and triaged" }],
  };
  delete ticket.duplicate_of;
  autoDispatchIfCritical(ticket);
  state.tickets.push(ticket);
  save();
  return { ticket, merged: false };
}

// Older tickets (before history existed) get a minimal history so every view can rely on it.
function withHistory(t) {
  if (!t.history) t.history = [{ at: t.createdAt, type: "status", status: "Open", text: "Complaint received and triaged" }];
  return t;
}

/**
 * SLA watchdog: an open ticket that passes its response deadline is escalated to the zonal
 * supervisor once, and gets a crew if it still has none. Runs on every list and every minute.
 */
export function slaSweep(nowMs = Date.now()) {
  let changed = 0;
  for (const t of state.tickets) {
    if (t.status === "Resolved" || t.slaBreached) continue;
    if (Date.parse(slaDue(t)) > nowMs) continue;
    withHistory(t);
    const at = new Date(nowMs).toISOString();
    t.slaBreached = at;
    t.history.push({ at, type: "escalated", text: `Response deadline missed. Escalated to the Zonal Supervisor of ${t.department}` });
    if (!t.crew) dispatch(t, bestCrew(t.department), "auto", at);
    changed++;
  }
  if (changed) save();
  return changed;
}

export function listTickets() {
  slaSweep();
  const now = Date.now();
  return state.tickets
    .map((t) => ({
      ...withHistory(t),
      priority: priorityScore(t, now),
      slaDue: slaDue(t),
      reportCount: t.reports.length,
      suggestedCrew: t.status !== "Resolved" && !t.crew ? (({ id, name, load, capacity }) => ({ id, name, load, capacity }))(bestCrew(t.department) || {}) : null,
    }))
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Officer actions. Any combination of: status change, department reassignment, internal note.
 * Every change is logged on the ticket. Reassignments double as labelled training data for the AI.
 */
export function updateTicket(id, { status, department, note, geo, crew }) {
  const t = find(id);
  if (!t) return { error: "Ticket not found", code: 404 };
  if (status !== undefined && !STATUSES.includes(status)) return { error: "Invalid status", code: 400 };
  if (department !== undefined && !DEPARTMENT_LIST.includes(department)) return { error: "Unknown department", code: 400 };
  if (note !== undefined && (typeof note !== "string" || note.length > 1000)) return { error: "Note must be text under 1000 characters", code: 400 };
  if (geo !== undefined && !validLatLng(geo)) return { error: "Location must have a valid lat and lng", code: 400 };
  const deptAfter = department || t.department;
  let crewPick;
  if (crew !== undefined && crew !== null && crew !== "") {
    if (crew === "auto") crewPick = bestCrew(deptAfter);
    else crewPick = CREWS.find((c) => c.id === crew);
    if (!crewPick) return { error: "Unknown crew", code: 400 };
    if (crewPick.dept !== deptAfter) return { error: `${crewPick.name} belongs to ${crewPick.dept}, not ${deptAfter}`, code: 400 };
  }
  withHistory(t);
  const now = new Date().toISOString();
  const cleanNote = note?.trim();

  if (department && department !== t.department) {
    t.history.push({ at: now, type: "reassign", from: t.department, to: department, text: `Reassigned from ${t.department} to ${department}`, note: cleanNote || "" });
    t.reassignments = (t.reassignments || 0) + 1;
    t.department = department;
    if (t.crew && CREWS.find((c) => c.id === t.crew.id)?.dept !== department) {
      t.history.push({ at: now, type: "dispatch", text: `${t.crew.name} released (ticket moved to another department)` });
      t.crew = null;
    }
  } else if (cleanNote) {
    t.history.push({ at: now, type: "note", text: cleanNote });
  }
  if (crewPick && crewPick.id !== t.crew?.id) dispatch(t, crewPick, "officer", now);
  else if (crew === null || crew === "") {
    if (t.crew) t.history.push({ at: now, type: "dispatch", text: `${t.crew.name} unassigned` });
    t.crew = null;
  }
  if (!crewPick && department) autoDispatchIfCritical(t); // a Critical ticket moved to a new department gets that department's crew
  if (geo) {
    t.geo = { lat: geo.lat, lng: geo.lng, source: "officer", area: t.geo?.area || "", address: typeof geo.address === "string" ? geo.address.slice(0, 200) : t.geo?.address || "" };
    t.history.push({ at: now, type: "moved", text: "Exact location confirmed on the map by an officer" });
  }
  if (status && status !== t.status) {
    t.history.push({ at: now, type: "status", status, text: `Status changed to ${status}` });
    t.status = status;
    if (status === "Resolved") t.resolvedAt = now;
    else delete t.resolvedAt;
  }
  t.updatedAt = now;
  save();
  return { ticket: t };
}

/** What a citizen may see when tracking: no internal notes, photos or other citizens' text. */
export function trackTicket(id) {
  const t = find(String(id || "").toUpperCase().trim());
  if (!t) return null;
  withHistory(t);
  return {
    id: t.id, title: t.title, category: t.category, severity: t.severity, severity_reason: t.severity_reason,
    department: t.department, location: t.location, status: t.status, createdAt: t.createdAt, slaDue: slaDue(t),
    resolvedAt: t.resolvedAt || null, reportCount: t.reports.length,
    geo: t.geo ? { lat: t.geo.lat, lng: t.geo.lng, source: t.geo.source } : null,
    crew: t.crew ? { name: t.crew.name, eta: t.crew.eta, assignedAt: t.crew.assignedAt, by: t.crew.by } : null,
    photo: t.photo || null,
    reviews: t.reviews || [],
    history: t.history.filter((h) => h.type !== "note").map(({ at, type, status, text }) => ({ at, type, status, text })),
  };
}

/** Officer corrections in a form that can be used to evaluate or fine-tune the triage model. */
export function reassignmentLog() {
  return state.tickets.flatMap((t) => (t.history || [])
    .filter((h) => h.type === "reassign")
    .map((h) => ({ ticket: t.id, at: h.at, complaint: t.english_translation, category: t.category, ai_department: h.from, officer_department: h.to, note: h.note, engine: t.engine })));
}

export function validLatLng(g) {
  return g && Number.isFinite(g.lat) && Number.isFinite(g.lng) && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180;
}

/**
 * Reviews: citizens rate the fix (1-5 stars, once the ticket is resolved); the department posts
 * updates with photo proof (any time). Both can attach a photo. Shown publicly on the Reviews page.
 */
export function addReview(id, { by, rating, text, photo, name }) {
  const t = find(id);
  if (!t) return { error: "Ticket not found", code: 404 };
  if (by !== "citizen" && by !== "department") return { error: "Reviewer must be citizen or department", code: 400 };
  if (text != null && typeof text !== "string") return { error: "Review text must be a string", code: 400 };
  const clean = (text || "").trim().slice(0, 1000);
  t.reviews ??= [];
  if (t.reviews.length >= 50) return { error: "This ticket already has the maximum number of reviews", code: 409 };
  withHistory(t);
  const now = new Date().toISOString();
  let entry;
  if (by === "citizen") {
    if (t.status !== "Resolved") return { error: "You can rate the work once the ticket is marked Resolved.", code: 409 };
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "Please choose a rating from 1 to 5 stars", code: 400 };
    const who = typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "Citizen";
    entry = { id: `${t.id}-R${t.reviews.length + 1}`, at: now, by, name: who, rating, text: clean, photo: photo || null };
    t.history.push({ at: now, type: "review", text: `${who} rated the resolution ${rating}/5` });
  } else {
    if (!clean && !photo) return { error: "Write an update or attach a photo", code: 400 };
    entry = { id: `${t.id}-R${t.reviews.length + 1}`, at: now, by, name: t.department, text: clean, photo: photo || null };
    t.history.push({ at: now, type: "update", text: `${t.department} posted an update${photo ? " with a photo" : ""}` });
  }
  t.reviews.push(entry);
  t.updatedAt = now;
  save();
  return { review: entry, ticket: t };
}

/** Public reviews feed + satisfaction summary. */
export function reviewFeed() {
  const items = state.tickets
    .filter((t) => t.reviews?.length)
    .map((t) => ({
      id: t.id, title: t.title, category: t.category, severity: t.severity, department: t.department, status: t.status,
      location: t.location, createdAt: t.createdAt, resolvedAt: t.resolvedAt || null, before: t.photo || null,
      after: [...t.reviews].reverse().find((r) => r.by === "department" && r.photo)?.photo || null,
      reviews: t.reviews,
      lastAt: t.reviews.at(-1).at,
    }))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const ratings = state.tickets.flatMap((t) => (t.reviews || []).filter((r) => r.by === "citizen").map((r) => ({ dept: t.department, rating: r.rating })));
  const byDept = {};
  for (const r of ratings) (byDept[r.dept] ??= []).push(r.rating);
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  return {
    summary: {
      averageRating: avg(ratings.map((r) => r.rating)),
      ratings: ratings.length,
      updates: state.tickets.reduce((n, t) => n + (t.reviews || []).filter((r) => r.by === "department").length, 0),
      resolved: state.tickets.filter((t) => t.status === "Resolved").length,
      byDepartment: Object.fromEntries(Object.entries(byDept).map(([d, a]) => [d, { average: avg(a), count: a.length }])),
    },
    items,
  };
}

/** Open tickets within `radius` metres of a point, nearest first (for "already reported?" checks). */
export function nearby(lat, lng, radius = 250) {
  return state.tickets
    .filter((t) => t.status !== "Resolved" && t.geo && t.geo.source !== "approx")
    .map((t) => ({ t, d: metres({ lat, lng }, t.geo) }))
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(({ t, d }) => ({ id: t.id, title: t.title, category: t.category, severity: t.severity, status: t.status, department: t.department, reports: t.reports.length, distance: Math.round(d), crew: t.crew ? t.crew.name : null }));
}

/** A citizen confirms an existing open ticket ("me too") instead of filing a duplicate. */
export function meToo(id, { text, photo }) {
  const t = find(id);
  if (!t) return { error: "Ticket not found", code: 404 };
  if (t.status === "Resolved") return { error: "This issue is already resolved. Please file a new grievance if it has come back.", code: 409 };
  withHistory(t);
  const now = new Date().toISOString();
  t.reports.push({ at: now, text: (text || "").trim().slice(0, 1000) || "(confirmed the issue)", language: "", photo: photo || null, metoo: true });
  t.history.push({ at: now, type: "report", text: `Another citizen confirmed this issue (${t.reports.length} reports)` });
  if (t.reports.length >= ESCALATE_AT && !t.escalated && t.severity !== "Critical") {
    t.escalated = true;
    t.severity = bumpSeverity(t.severity);
    t.severity_reason += ` · Escalated: reported by ${t.reports.length} citizens`;
    t.history.push({ at: now, type: "escalated", text: `Severity raised to ${t.severity} after ${t.reports.length} reports` });
  }
  autoDispatchIfCritical(t);
  if (!t.photo && photo) t.photo = photo;
  t.updatedAt = now;
  save();
  return { ticket: t };
}

/** Officer export: one row per ticket. */
export function exportCsv() {
  const cols = ["id", "createdAt", "status", "severity", "category", "department", "crew", "location", "lat", "lng", "reports", "slaDue", "slaBreached", "resolvedAt", "avgRating", "title", "reason", "complaint"];
  const q = (v) => {
    let x = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; // neutralise spreadsheet formulas
    return `"${x.replace(/"/g, '""')}"`;
  };
  const rows = state.tickets.map((t) => {
    const r = (t.reviews || []).filter((x) => x.rating).map((x) => x.rating);
    return [t.id, t.createdAt, t.status, t.severity, t.category, t.department, t.crew?.name, t.location, t.geo?.lat, t.geo?.lng, t.reports.length, slaDue(t), t.slaBreached, t.resolvedAt,
      r.length ? (r.reduce((a, b) => a + b, 0) / r.length).toFixed(1) : "", t.title, t.severity_reason, t.english_translation].map(q).join(",");
  });
  return [cols.join(","), ...rows].join("\r\n");
}

/** Headline service figures for the public home page. */
export function serviceStats() {
  const ts = state.tickets;
  const active = ts.filter((t) => t.status !== "Resolved");
  const ratings = ts.flatMap((t) => (t.reviews || []).filter((r) => r.by === "citizen").map((r) => r.rating));
  const critical = ts.filter((t) => t.severity === "Critical");
  const dispatchMins = critical.filter((t) => t.crew).map((t) => (Date.parse(t.crew.assignedAt) - Date.parse(t.createdAt)) / 60000);
  return {
    total: ts.length,
    open: active.length,
    criticalOpen: active.filter((t) => t.severity === "Critical").length,
    resolved: ts.length - active.length,
    averageRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    criticalDispatched: critical.filter((t) => t.crew).length,
    criticalTotal: critical.length,
    avgCriticalDispatchMinutes: dispatchMins.length ? Math.round(dispatchMins.reduce((a, b) => a + b, 0) / dispatchMins.length) : null,
    crewsOnJob: new Set(active.filter((t) => t.crew).map((t) => t.crew.id)).size,
    crews: CREWS.length,
  };
}

export function setGeo(id, geo) {
  const t = find(id);
  if (!t || EXACT.has(t.geo?.source)) return;
  t.geo = geo;
  save();
}

export function resetAll() {
  state = { nextId: 1001, tickets: [] };
  save();
}
