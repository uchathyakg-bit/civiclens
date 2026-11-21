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
- **Exact location picker.** The report form has a movable map (street or satellite view). Citizens search a road or landmark, tap "My location" (GPS, with an accuracy circle), or tap the map. Then they **drag the pin to the exact spot**, and the address is looked up and shown with the coordinates. Officers can drag a ticket's pin in the drawer to correct it ("confirmed by officer"). Two reports in the same category pinned within 60 m are merged as duplicates.
- **Map view.** Officer dashboard pins coloured by severity and sized by number of reports. Solid = exact (citizen pin, GPS or officer-confirmed), half-filled = matched from the address text through Nominatim, hollow = approximate near the city centre if the lookup fails. Submissions never wait on a lookup.
- **Reviews with photos.** Departments post public updates with an "after" photo (and can mark the ticket Resolved in the same step). Once a ticket is resolved, the citizen rates the fix 1–5 stars with a comment and an optional photo on the Track page. The **Reviews** page shows before/after photos, department updates and citizen ratings, with overall and per-department averages. The dashboard and header show the average citizen rating.
- **Automatic crew dispatch for Critical issues.** The moment a ticket is triaged as Critical (or escalates to Critical through repeat reports), it is assigned to the department's least-loaded field crew, relative to capacity, with a target time on site (45 min for Critical). It moves to *Assigned* and the citizen sees "Emergency crew dispatched" on their confirmation. High, Medium and Low tickets show a **suggested crew** that an officer assigns with one click, or changes, auto-picks or unassigns in the drawer. Moving a ticket to another department releases its crew, and a Critical ticket is re-dispatched in the new department. The dashboard's **Field crews** panel shows each crew's load against capacity (free, busy or at capacity). `GET /api/crews` and `GET /api/stats` expose the same data.
- **Design references.** The visual layer borrows patterns from open-source official design systems: the GOV.UK Design System (phase banner, green confirmation panel with the reference number, high-contrast yellow focus state), the U.S. Web Design System (Public Sans typeface, colour tokens, small radii) and IBM Carbon (dense data-table headers). Only patterns are reused; there is no branding from those organisations.
- **Government-portal design.** Tricolour strip, utility bar with A−/A/A+ text size and a light/dark switch, skip-to-content link, masthead, breadcrumbs, a response-time charter, an emergency notice and a full footer. The site is clearly labelled as a prototype, not an official government website, and uses a generic civic emblem (not the State Emblem).
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

## Demo mode
On the Report page, **Demo mode** clears the queue and submits 5 complaints, each showing one feature: a Kannada complaint, a live wire near a school (Critical, emergency routing), a duplicate of it (merged ×2), an "URGENT!!!" complaint about a faded sign (still Low), and a garbage complaint with a photo of a clean park (photo mismatch, flagged by the AI engine).

## Limitations
- **No login.** Anyone with the link can open the dashboard, change tickets, post "department" updates, leave a citizen review on any resolved ticket, or clear everything (Demo mode does this too). Production needs officer accounts, OTP-verified citizens (one review per reporter) and moderation of review photos.
- **Photos are public.** Citizen and department photos appear on the Reviews and Track pages. A real deployment should blur faces and number plates.
- **Map services.** Place search and address lookup use Nominatim's free public service (one request a second), and satellite imagery comes from Esri's public tiles. Both need internet access and have usage limits.
- **Storage is one JSON file** in a single process, which is fine for a prototype. It's wiped on Render's free tier. Production would use Postgres + PostGIS, which would also allow distance-based duplicate detection. Photos are stored inline as base64 and sent with the ticket list, which won't scale.
- **The offline rules engine is a fallback, not the product.** It can't translate, can't read places written in Kannada or Hindi (those tickets get an approximate map pin), can't see photos (so the photo-mismatch check needs Claude), and finds duplicates by word overlap only.
- **Map positions are best-effort.** Nominatim is a free public service (1 request a second) and free-text matching can pick the wrong place. Hollow pins mark approximate positions.
- **SLA targets** (4h / 24h / 72h / 7d) are our assumptions, not official municipal SLAs.
- **Citizens aren't notified** of status changes. They have to check the Track page. SMS or WhatsApp updates are the obvious next step.
- **Internet needed** for the Inter font, Leaflet map tiles and Chart.js (from CDNs). Without it the app still works, with plain fonts and "couldn't load" messages in place of the map and charts.
- **Voice input** uses the browser's speech recognition, so it works in Chrome and Edge only.
- **The demo's park photo** is a drawn illustration, not a real photograph.

## Credits
Built during the event with Claude (Anthropic) via Claude Code. Uses `@anthropic-ai/sdk`. No external datasets or assets. Sample complaints were written by the team.
