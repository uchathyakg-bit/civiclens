// Ticket store (JSON file) + duplicate merging + crowd escalation.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, SEVERITIES, DEPARTMENT_LIST, DEFAULT_ROUTE, SLA_HOURS, bumpSeverity, priorityScore } from "./taxonomy.js";

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
    if (dup.reports.length >= ESCALATE_AT && !dup.escalated) {
      dup.escalated = true;
      dup.severity = bumpSeverity(dup.severity);
      dup.severity_reason += ` · Escalated: reported by ${dup.reports.length} citizens`;
      dup.history.push({ at: now, type: "escalated", text: `Severity raised to ${dup.severity} after ${dup.reports.length} reports` });
    }
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
  state.tickets.push(ticket);
  save();
  return { ticket, merged: false };
}

// Older tickets (before history existed) get a minimal history so every view can rely on it.
function withHistory(t) {
  if (!t.history) t.history = [{ at: t.createdAt, type: "status", status: "Open", text: "Complaint received and triaged" }];
  return t;
}

export function listTickets() {
  const now = Date.now();
  return state.tickets
    .map((t) => ({
      ...withHistory(t),
      priority: priorityScore(t, now),
      slaDue: slaDue(t),
      reportCount: t.reports.length,
    }))
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Officer actions. Any combination of: status change, department reassignment, internal note.
 * Every change is logged on the ticket. Reassignments double as labelled training data for the AI.
 */
export function updateTicket(id, { status, department, note, geo }) {
  const t = find(id);
  if (!t) return { error: "Ticket not found", code: 404 };
  if (status !== undefined && !STATUSES.includes(status)) return { error: "Invalid status", code: 400 };
  if (department !== undefined && !DEPARTMENT_LIST.includes(department)) return { error: "Unknown department", code: 400 };
  if (note !== undefined && (typeof note !== "string" || note.length > 1000)) return { error: "Note must be text under 1000 characters", code: 400 };
  if (geo !== undefined && !validLatLng(geo)) return { error: "Location must have a valid lat and lng", code: 400 };
  withHistory(t);
  const now = new Date().toISOString();
  const cleanNote = note?.trim();

  if (department && department !== t.department) {
    t.history.push({ at: now, type: "reassign", from: t.department, to: department, text: `Reassigned from ${t.department} to ${department}`, note: cleanNote || "" });
    t.reassignments = (t.reassignments || 0) + 1;
    t.department = department;
  } else if (cleanNote) {
    t.history.push({ at: now, type: "note", text: cleanNote });
  }
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
