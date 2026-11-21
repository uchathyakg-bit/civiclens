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

export function addComplaint({ triage, text, photo, engine }) {
  const tr = sanitize(triage);
  const now = new Date().toISOString();
  const report = { at: now, text, language: tr.language, photo: photo || null };

  const dup = findDuplicate(tr);
  if (dup) {
    dup.reports.push(report);
    if (SEVERITIES.indexOf(tr.severity) > SEVERITIES.indexOf(dup.severity)) {
      dup.severity = tr.severity;
      dup.severity_reason = tr.severity_reason;
    }
    if (dup.reports.length >= ESCALATE_AT && !dup.escalated) {
      dup.escalated = true;
      dup.severity = bumpSeverity(dup.severity);
      dup.severity_reason += ` · Escalated: reported by ${dup.reports.length} citizens`;
    }
    if (!dup.photo && photo) dup.photo = photo;
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
  };
  delete ticket.duplicate_of;
  state.tickets.push(ticket);
  save();
  return { ticket, merged: false };
}

export function peekNextId() {
  return `CL-${state.nextId}`;
}

export function listTickets() {
  const now = Date.now();
  return state.tickets
    .map((t) => ({
      ...t,
      priority: priorityScore(t, now),
      slaDue: new Date(new Date(t.createdAt).getTime() + SLA_HOURS[t.severity] * 36e5).toISOString(),
      reportCount: t.reports.length,
    }))
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
}

export function updateStatus(id, status) {
  const t = state.tickets.find((x) => x.id === id);
  if (!t) return null;
  t.status = status;
  t.updatedAt = new Date().toISOString();
  save();
  return t;
}

export function resetAll() {
  state = { nextId: 1001, tickets: [] };
  save();
}
