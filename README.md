# CivicLens: AI triage for citizen complaints

A citizen sends a vague complaint (any language, optional photo). CivicLens turns it into a **structured, prioritised and correctly routed ticket** that a municipal officer can act on, and shows it on a dashboard sorted by priority.

| Required feature | How CivicLens does it |
|---|---|
| 1. Free text in English / regional language + optional photo | Text box, voice input (en/kn/hi/ta/te), photo upload (resized in the browser). Claude reads the text **and** the photo. |
| 2. Category | roads · waste · water · electricity · trees · drainage · other |
| 3. Severity + one-line reason | Low / Medium / High / Critical, with a written rubric; escalated one level near schools/hospitals |
| 4. Routing | 8 departments. Electricity is split: streetlights go to the municipal electrical dept, live wires go to the power utility emergency line |
| 5. Priority dashboard | Sorted by a priority score (severity + repeat reports + vulnerable site + time against SLA), with filters, SLA countdown, status workflow and load per department |

## Beyond the brief
- **Duplicate merging and crowd escalation.** A repeat report of the same issue is attached to the existing ticket instead of creating a new one. When 3 or more citizens report it, severity goes up one level.
- **Photo cross-check.** Claude describes the photo and flags it when the photo doesn't match the text.
- **Missing-info detection.** The officer sees what's still needed, for example "exact location".
- **Reply in the citizen's language.** The acknowledgement goes back in Kannada, Hindi and so on.
- **SLA timers** per severity (Critical 4h, High 24h, Medium 72h, Low 7d), plus overdue alerts.
- **Never-fail demo.** If there's no API key, or the AI call fails, an offline multilingual rules engine takes over.
- **Citizen ticket tracking.** Every complaint gets a short ID like `CL-1042`. The **Track** page shows a Received → Assigned → In progress → Resolved timeline and the expected resolution time from the SLA. Internal officer notes are never shown to citizens.
- **Map view.** Pins on OpenStreetMap (Leaflet), coloured by severity and sized by number of reports. A position comes from the citizen's GPS if they tap "Use my current location". Otherwise the location text is looked up with Nominatim in the background, then with broader guesses (the area, the road). If that fails or times out, the pin is placed approximately near the city centre and drawn hollow. Submissions never wait on this.
- **Analytics strip** (Chart.js): complaints by category, open load per department split by severity, and the top hotspot areas weighted by repeat reports.
- **Officer actions.** In the ticket drawer an officer can change the status, reassign the department and add internal notes, all logged in the ticket's activity timeline. Reassignments are also exported at `GET /api/reassignments` as *AI said X → officer chose Y* records, ready to use for evaluating or fine-tuning the triage model.

## Run it
Requires Node.js 20.6+ (tested on Node 24).

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY to use Claude (optional)
npm start                 # http://localhost:3000
```
Open **Officer dashboard → Load demo data** to fill it with 10 sample complaints.

Check accuracy against the labelled samples:
```bash
npm run eval         # Claude if a key is set, else rules
npm run eval:rules   # offline rules engine only
```

## Deploy to Render
1. Push this repo to GitHub. In Render, choose **New → Web Service**, pick the repo, and select the **Free** instance type.
2. Settings:

   | Setting | Value |
   |---|---|
   | Runtime | Node (version comes from `engines` in `package.json`: Node 24) |
   | Build command | `npm install` |
   | Start command | `npm start` |
   | Health check path | `/health` |

3. Environment variables:

   | Variable | Required? | Notes |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | Required for AI triage | Without it the app still runs on the offline rules engine. `/health` reports `"engine": "rules"` |
   | `PORT` | No | Render sets this itself. The server reads it and binds to `0.0.0.0` |
   | `CIVICLENS_MODEL` | No | Defaults to `claude-opus-5-5` |
   | `CIVICLENS_CITY`, `CIVICLENS_CITY_LAT`, `CIVICLENS_CITY_LNG` | No | City used for map lookups and the fallback map centre (default Bengaluru) |
   | `CIVICLENS_GEOCODE` | No | Set to `off` to skip Nominatim lookups (pins become approximate) |

   Add the key under **Environment** in the Render dashboard. Never commit it: `.env` is git-ignored.

> **Free tier caveats.** The service **sleeps after about 15 minutes without traffic**. The next request wakes it, which can take 30–60 seconds, so open the URL a minute before you demo. The free tier has no persistent disk, so **`data/tickets.json` is wiped on every restart, redeploy or wake-up**. Click **Load demo data** on the dashboard to refill it. For real use, move tickets to a database (Render Postgres, for example).

Check a deployment with `curl https://<your-app>.onrender.com/health`. It should return `{"status":"ok","engine":"ai"}`.

## Architecture
```
Browser (public/)  ──POST /api/complaints──►  server.js
  citizen form                                   │
  officer dashboard ◄──GET /api/tickets────      ├─ src/triage-ai.js     Claude (claude-opus-5-5): vision + structured JSON output
                                                 ├─ src/triage-rules.js  offline fallback (EN / HI / KN keywords)
                                                 ├─ src/store.js         JSON store, duplicate merge, escalation
                                                 └─ src/taxonomy.js      categories, departments, SLA, priority formula
```
- **Structured outputs:** Claude's response must match a JSON schema whose enums cover categories, severities and departments, so the output always parses.
- **Prompt caching:** the system prompt is frozen and cached.
- **Server-side refusal fallback** is turned on, and anything out of range is sanitised before it's stored.

## Limitations
- Storage is a JSON file, which is fine for a prototype. Production would use Postgres + PostGIS for geo-based duplicate detection.
- Locations are free text. The next step is GPS capture from the phone and ward mapping.
- The offline engine can't translate or analyse photos. Those need Claude.

## Credits
Built during the event with Claude (Anthropic) via Claude Code. Uses `@anthropic-ai/sdk`. No external datasets or assets. Sample complaints were written by the team.
