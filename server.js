// CivicLens server: zero-framework Node HTTP server.
//   POST  /api/complaints      triage a complaint (text + optional photo) into a ticket
//   GET   /api/tickets         tickets sorted by priority (officer dashboard)
//   PATCH /api/tickets/:id     officer actions: status, reassign department, add note
//   GET   /api/track/:id       citizen-safe view of one ticket (status timeline)
//   GET   /api/reassignments   officer corrections, exportable as AI training/eval data
//   POST  /api/tickets/:id/reviews  citizen rating (after resolution) or department update, with photo
//   GET   /api/reviews         public reviews feed + satisfaction summary
//   GET   /api/crews           field crews with current workload
//   GET   /api/stats           headline service figures for the home page
//   GET   /api/nearby?lat=&lng=  open tickets within 250 m ("already reported?")
//   POST  /api/tickets/:id/metoo   a citizen confirms an existing issue instead of filing a duplicate
//   GET   /api/export.csv      all tickets as CSV for officers
//   GET   /api/geo/search?q=   place search for the map picker (Nominatim)
//   GET   /api/geo/reverse?lat=&lng=  address for a dropped pin
//   POST  /api/demo/seed       load the sample complaints
//   DELETE /api/tickets        clear all tickets
//   GET   /health              liveness check for the host (Render)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { triageWithAI, aiAvailable, MODEL } from "./src/triage-ai.js";
import { triageWithRules, citizenReply } from "./src/triage-rules.js";
import { addComplaint, listTickets, openTickets, updateTicket, trackTicket, reassignmentLog, setGeo, resetAll, addReview, reviewFeed, validLatLng, crewsStatus, serviceStats, nearby, meToo, exportCsv, slaSweep, STATUSES } from "./src/store.js";
import { geocode, searchPlaces, reverseGeocode, CITY, CITY_CENTER } from "./src/geocode.js";
import { SAMPLES } from "./src/samples.js";
import { DEPARTMENT_LIST, CATEGORIES, CREWS } from "./src/taxonomy.js";

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
    let tooBig = false;
    const chunks = [];
    const fail = (status, message) => reject(Object.assign(new Error(message), { status }));
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { tooBig = true; chunks.length = 0; } // keep draining so we can still send a clean 413
      else if (!tooBig) chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return fail(413, "That upload is too large. Please use a smaller photo (under 8 MB after resizing).");
      let body;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
      catch { return fail(400, "Invalid JSON"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Request body must be a JSON object");
      resolve(body);
    });
    req.on("error", reject);
  });
}

const PHOTO_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
function checkPhoto(photo) {
  if (photo == null || photo === "") return null;
  if (typeof photo !== "string") throw Object.assign(new Error("Photo must be an image data URL"), { status: 400 });
  if (!PHOTO_RE.test(photo)) throw Object.assign(new Error("Photo must be a JPEG, PNG, WebP or GIF image"), { status: 400 });
  return photo;
}

export async function triageComplaint({ text, photo, lat, lng, locSource, address }) {
  if (text != null && typeof text !== "string") throw Object.assign(new Error("Complaint text must be a string"), { status: 400 });
  photo = checkPhoto(photo);
  text = (text || "").trim().slice(0, 4000);
  // Exact position from the citizen: a pin they placed/dragged on the map, or their phone's GPS.
  const coords = validLatLng({ lat, lng })
    ? { lat, lng, source: locSource === "gps" ? "gps" : "pin", address: typeof address === "string" ? address.trim().slice(0, 200) : "" }
    : null;
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
      return send(res, 200, { engine: aiAvailable() ? "claude" : "rules", model: aiAvailable() ? MODEL : null, departments: DEPARTMENT_LIST, categories: CATEGORIES, statuses: STATUSES, city: CITY, cityCenter: CITY_CENTER, open: openTickets().length, crews: CREWS.map(({ id, name, dept, capacity }) => ({ id, name, dept, capacity })) });
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
      const { status, department, note, geo, crew } = await readBody(req);
      const r = updateTicket(m[1], { status, department, note, geo, crew });
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
    const rv = p.match(/^\/api\/tickets\/(CL-\d+)\/reviews$/);
    if (rv && req.method === "POST") {
      const { by, rating, text, photo, name } = await readBody(req);
      const r = addReview(rv[1], { by, rating, text, photo: checkPhoto(photo), name });
      return r.error ? send(res, r.code, { error: r.error }) : send(res, 201, r.review);
    }
    if (p === "/api/crews" && req.method === "GET") {
      return send(res, 200, crewsStatus());
    }
    if (p === "/api/nearby" && req.method === "GET") {
      const lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
      if (!validLatLng({ lat, lng })) return send(res, 400, { error: "lat and lng are required" });
      return send(res, 200, nearby(lat, lng, 250));
    }
    const mt = p.match(/^\/api\/tickets\/(CL-\d+)\/metoo$/);
    if (mt && req.method === "POST") {
      const { text, photo } = await readBody(req);
      if (text != null && typeof text !== "string") return send(res, 400, { error: "Text must be a string" });
      const r = meToo(mt[1], { text, photo: checkPhoto(photo) });
      return r.error ? send(res, r.code, { error: r.error }) : send(res, 200, r.ticket);
    }
    if (p === "/api/export.csv" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="civiclens-tickets-${new Date().toISOString().slice(0, 10)}.csv"` });
      return res.end("\uFEFF" + exportCsv()); // BOM so Excel reads Kannada/Hindi correctly
    }
    if (p === "/api/stats" && req.method === "GET") {
      return send(res, 200, serviceStats());
    }
    if (p === "/api/reviews" && req.method === "GET") {
      return send(res, 200, reviewFeed());
    }
    if (p === "/api/geo/search" && req.method === "GET") {
      return send(res, 200, await searchPlaces(url.searchParams.get("q")));
    }
    if (p === "/api/geo/reverse" && req.method === "GET") {
      const lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
      if (!validLatLng({ lat, lng })) return send(res, 400, { error: "lat and lng are required" });
      return send(res, 200, (await reverseGeocode(lat, lng)) || { address: "", area: "" });
    }
    if (p === "/api/demo/seed" && req.method === "POST") {
      resetAll();
      for (const s of SAMPLES) await triageComplaint({ text: s.text });
      // Two resolved tickets with sample updates and ratings, so the Reviews page isn't empty in a demo.
      const resolved = [
        ["trees", "Tree cut and cleared by the horticulture crew; road reopened to traffic by 11 am.", 5, "Cleared the same morning. Thank you!"],
        ["water", "Burst valve replaced and the line pressure-tested. Supply restored to the street.", 4, "Fixed in a day. The road is still a bit muddy where they dug."],
      ];
      for (const [cat, update, rating, review] of resolved) {
        const t = listTickets().find((x) => x.category === cat);
        if (!t) continue;
        addReview(t.id, { by: "department", text: update });
        updateTicket(t.id, { status: "Resolved" });
        addReview(t.id, { by: "citizen", rating, text: review, name: "Sample resident" });
      }
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
    setInterval(slaSweep, 60_000).unref(); // SLA watchdog
    // Tickets saved before they had a map position (or whose lookup was interrupted) get one now.
    for (const t of listTickets()) if (!t.geo) geocode(t.location, t.id).then((g) => setGeo(t.id, g));
    console.log(aiAvailable() ? `Triage engine: Claude (${MODEL})` : "Triage engine: offline rules (set ANTHROPIC_API_KEY in .env to enable Claude)");
  });
}
