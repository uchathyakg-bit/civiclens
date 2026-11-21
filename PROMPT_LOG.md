# Prompt log (fill in as you go, then export to PDF / Sheet)

| # | Time | Tool | Prompt (summary) | Purpose | Outcome / what we changed |
|---|------|------|------------------|---------|---------------------------|
| 1 | | Claude Code | "Here's our hackathon brief, help us build CivicLens." (brief PDF attached) | Scaffold the full prototype | Node server, Claude triage engine, offline rules engine, citizen form, officer dashboard |
| 2 | | Claude Code | (automatic) offline engine eval showed 3 misses: Kannada pothole, zebra crossing, vague complaint | Verify AI output against labelled samples | Added Kannada keywords, road-marking terms, a "too vague → Low" rule. 9/9 correct |
| 3 | | Claude Code | (automatic) second live-wire report wasn't merged | Test duplicate handling | Stop-word filtered location matching; duplicates now merge (×2) |
| 4 | | Claude API (runtime) | System prompt in `src/triage-ai.js` | The triage itself | Rubric with Critical/High/Medium/Low examples, routing table, "grade facts not tone", photo cross-check |
| 5 | | Claude Code | Deployment prep for Render: PORT/0.0.0.0, `/health`, engines pin, create the tickets file on startup, key scan | Make it deployable and safe to push | All done; tested on PORT=4000; a corrupt tickets file is set aside instead of crashing |
| 6 | | Claude Code | "Polish the UI so it looks like a real civic-tech product" (severity color system, Inter, light/dark, hero, drag-and-drop photo, animated ticket card, stat cards, filter chips, SLA countdowns, ×N badges, sliding drawer, skeletons, toasts, empty states, responsive) | Judges score the demo and pitch; officers need to scan urgency at a glance | Full UI rewrite in plain CSS/JS with no framework. Checked at desktop and 375px phone width in light and dark. Also gave rules-engine tickets English titles, since Kannada or Hindi headlines were hard for officers to scan |
| 7 | | Claude Code | "Strengthen the concept with small, stable features": ticket tracking page, Leaflet map with a geocoding fallback, Chart.js analytics, officer reassign + notes | Show we understood both users: the citizen wants to know what happens next; the officer needs a map, workload and a way to correct the AI | Added all four. Browser review caught that the rules engine cut locations at the first comma, so "Govt Primary School" was mapped to the wrong school. Fixed location extraction and gave the geocoder fallbacks (full text → area → road → approximate). Also fixed chart labels being skipped and a 6px phone overflow. Reassignments are exported as AI-vs-officer training data |

## Key runtime prompt: design decisions (be ready to explain these to the jury)
1. **Explicit rubric with examples per severity level.** Grades stay consistent instead of depending on the model's mood. The brief's own example ("live wire near a school → Critical") is built in.
2. **"Grade the described facts, not the tone."** Stops "URGENT!!!" spam from jumping the queue.
3. **Exact department strings plus a JSON schema with enums.** The model can't invent a department, and the output always parses.
4. **Open tickets go into the prompt** so Claude can spot duplicates written in different words or languages.
5. **Effort `low`.** Triage is classification, so we chose speed over depth. The system prompt is cached.
6. **Rules-engine fallback.** The demo works offline, and the AI can be compared against a baseline (`npm run eval`).
