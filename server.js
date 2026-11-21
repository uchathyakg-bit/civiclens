// CivicLens server: zero-framework Node HTTP server.
//   POST  /api/complaints      triage a complaint (text + optional photo) into a ticket
//   GET   /api/tickets         tickets sorted by priority (officer dashboard)
//   PATCH /api/tickets/:id     update status
//   POST  /api/demo/seed       load the sample complaints
//   DELETE /api/tickets        clear all tickets
//   GET   /health              liveness check for the host (Render)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { triageWithAI, aiAvailable, MODEL } from "./src/triage-ai.js";
import { triageWithRules, citizenReply } from "./src/triage-rules.js";
import { addComplaint, listTickets, openTickets, updateStatus, resetAll } from "./src/store.js";
import { SAMPLES } from "./src/samples.js";
import { DEPARTMENT_LIST, CATEGORIES } from "./src/taxonomy.js";

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0"; // Render (and most hosts) need the server reachable on all interfaces
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const STATUSES = ["Open", "Assigned", "In Progress", "Resolved"];

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

export async function triageComplaint({ text, photo }) {
  text = (text || "").trim().slice(0, 4000);
  if (photo && !/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(photo)) {
    throw Object.assign(new Error("Photo must be a JPEG, PNG, WebP or GIF image"), { status: 400 });
  }
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
  const { ticket, merged } = addComplaint({ triage, text, photo, engine });
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
      return send(res, 200, { engine: aiAvailable() ? "claude" : "rules", model: aiAvailable() ? MODEL : null, departments: DEPARTMENT_LIST, categories: CATEGORIES, statuses: STATUSES });
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
      const { status } = await readBody(req);
      if (!STATUSES.includes(status)) return send(res, 400, { error: "Invalid status" });
      const t = updateStatus(m[1], status);
      return t ? send(res, 200, t) : send(res, 404, { error: "Not found" });
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
    console.log(aiAvailable() ? `Triage engine: Claude (${MODEL})` : "Triage engine: offline rules (set ANTHROPIC_API_KEY in .env to enable Claude)");
  });
}
