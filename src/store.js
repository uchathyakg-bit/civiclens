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

function findDuplicate(triage) {
  const open = openTickets();
  if (triage.duplicate_of) {
    const t = open.find((x) => x.id === triage.duplicate_of);
    if (t) return t;
  }
  return open.find(
    (t) =>
      t.category === triage.category &&
      ((triage.location && t.location && jaccard(t.location, triage.location) >= 0.5) ||
        jaccard(t.english_translation, triage.english_translation) >= 0.45),
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

export function addComplaint({ triage, text, photo, engine, coords }) {
  const tr = sanitize(triage);
  const now = new Date().toISOString();
  const report = { at: now, text, language: tr.language, photo: photo || null };

  const dup = findDuplicate(tr);
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
    if (coords && dup.geo?.source !== "gps") dup.geo = { ...coords, source: "gps" };
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
    geo: coords ? { ...coords, source: "gps" } : null,
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
export function updateTicket(id, { status, department, note }) {
  const t = find(id);
  if (!t) return { error: "Ticket not found", code: 404 };
  if (status !== undefined && !STATUSES.includes(status)) return { error: "Invalid status", code: 400 };
  if (department !== undefined && !DEPARTMENT_LIST.includes(department)) return { error: "Unknown department", code: 400 };
  if (note !== undefined && (typeof note !== "string" || note.length > 1000)) return { error: "Note must be text under 1000 characters", code: 400 };
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
    history: t.history.filter((h) => h.type !== "note").map(({ at, type, status, text }) => ({ at, type, status, text })),
  };
}

/** Officer corrections in a form that can be used to evaluate or fine-tune the triage model. */
export function reassignmentLog() {
  return state.tickets.flatMap((t) => (t.history || [])
    .filter((h) => h.type === "reassign")
    .map((h) => ({ ticket: t.id, at: h.at, complaint: t.english_translation, category: t.category, ai_department: h.from, officer_department: h.to, note: h.note, engine: t.engine })));
}

export function setGeo(id, geo) {
  const t = find(id);
  if (!t || t.geo?.source === "gps") return;
  t.geo = geo;
  save();
}

export function resetAll() {
  state = { nextId: 1001, tickets: [] };
  save();
}
