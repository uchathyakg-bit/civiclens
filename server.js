// CivicLens server: zero-framework Node HTTP server.
//   POST  /api/complaints      triage a complaint (text + optional photo) into a ticket
//   GET   /api/tickets         tickets sorted by priority (officer dashboard)
//   PATCH /api/tickets/:id     officer actions: status, reassign department, add note
//   GET   /api/track/:id       citizen-safe view of one ticket (status timeline)
//   GET   /api/reassignments   officer corrections, exportable as AI training/eval data
//   POST  /api/demo/seed       load the sample complaints
//   DELETE /api/tickets        clear all tickets
//   GET   /health              liveness check for the host (Render)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { triageWithAI, aiAvailable, MODEL } from "./src/triage-ai.js";
import { triageWithRules, citizenReply } from "./src/triage-rules.js";
import { addComplaint, listTickets, openTickets, updateTicket, trackTicket, reassignmentLog, setGeo, resetAll, STATUSES } from "./src/store.js";
import { geocode, CITY, CITY_CENTER } from "./src/geocode.js";
import { SAMPLES } from "./src/samples.js";
import { DEPARTMENT_LIST, CATEGORIES } from "./src/taxonomy.js";

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0"; // Render (and most hosts) need the server reachable on all interfaces
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

function send(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("Payload too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

export async function triageComplaint({ text, photo, lat, lng }) {
  text = (text || "").trim().slice(0, 4000);
  if (photo && !/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(photo)) {
    throw Object.assign(new Error("Photo must be a JPEG, PNG, WebP or GIF image"), { status: 400 });
  }
  const coords = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  if (!text && !photo) throw Object.assign(new Error("Enter a complaint or attach a photo"), { status: 400 });

  let triage, engine, aiError;
  const started = Date.now();
  if (aiAvailable()) {
    try {
      triage = await triageWithAI({ text, photo, openTickets: openTickets().slice(-40) });
      engine = "claude";
    } catch (err) {
      aiError = err.message;
      console.error("[triage] AI failed, using rules engine:", err.message);
    }
  }
  if (!triage) {
    triage = triageWithRules({ text, hasPhoto: Boolean(photo) });
    engine = "rules";
  }
  const reply = triage.citizen_reply;
  const { ticket, merged } = addComplaint({ triage, text, photo, engine, coords });
  // Map position is resolved in the background so the citizen never waits on an outside service.
  if (!ticket.geo) geocode(ticket.location, ticket.id).then((g) => setGeo(ticket.id, g));
  return {
    ticket,
    merged,
    engine,
    aiError,
    ms: Date.now() - started,
    citizen_reply: reply || citizenReply(triage.language, ticket.id, ticket.department, ticket.severity),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === "/health" && req.method === "GET") {
      return send(res, 200, { status: "ok", engine: aiAvailable() ? "ai" : "rules" });
    }
    if (p === "/api/health" && req.method === "GET") {
      return send(res, 200, { engine: aiAvailable() ? "claude" : "rules", model: aiAvailable() ? MODEL : null, departments: DEPARTMENT_LIST, categories: CATEGORIES, statuses: STATUSES, city: CITY, cityCenter: CITY_CENTER });
    }
    if (p === "/api/samples" && req.method === "GET") {
      return send(res, 200, SAMPLES.map(({ label, text }) => ({ label, text })));
    }
    if (p === "/api/complaints" && req.method === "POST") {
      const body = await readBody(req);
      return send(res, 201, await triageComplaint(body));
    }
    if (p === "/api/tickets" && req.method === "GET") {
      return send(res, 200, listTickets());
    }
    if (p === "/api/tickets" && req.method === "DELETE") {
      resetAll();
      return send(res, 200, { ok: true });
    }
    const m = p.match(/^\/api\/tickets\/(CL-\d+)$/);
    if (m && req.method === "PATCH") {
      const { status, department, note } = await readBody(req);
      const r = updateTicket(m[1], { status, department, note });
      return r.error ? send(res, r.code, { error: r.error }) : send(res, 200, r.ticket);
    }
    const tr = p.match(/^\/api\/track\/([A-Za-z0-9-]{1,20})$/);
    if (tr && req.method === "GET") {
      const t = trackTicket(tr[1]);
      return t ? send(res, 200, t) : send(res, 404, { error: `No complaint found with ID ${tr[1].toUpperCase()}. Check the ID and try again.` });
    }
    if (p === "/api/reassignments" && req.method === "GET") {
      return send(res, 200, reassignmentLog());
    }
    if (p === "/api/demo/seed" && req.method === "POST") {
      resetAll();
      for (const s of SAMPLES) await triageComplaint({ text: s.text });
      return send(res, 200, { ok: true, count: SAMPLES.length });
    }

    // Static files
    if (req.method === "GET") {
      const file = path.join(PUBLIC, p === "/" ? "index.html" : p);
      if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        return fs.createReadStream(file).pipe(res);
      }
    }
    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    send(res, err.status || 500, { error: err.message });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => {
    console.log(`CivicLens listening on ${HOST}:${PORT} (http://localhost:${PORT})`);
    // Tickets saved before they had a map position (or whose lookup was interrupted) get one now.
    for (const t of listTickets()) if (!t.geo) geocode(t.location, t.id).then((g) => setGeo(t.id, g));
    console.log(aiAvailable() ? `Triage engine: Claude (${MODEL})` : "Triage engine: offline rules (set ANTHROPIC_API_KEY in .env to enable Claude)");
  });
}
