// Primary triage engine: Claude reads the complaint text (any language) and the optional photo,
// and returns a structured ticket that matches TRIAGE_SCHEMA exactly (structured outputs).

import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, SEVERITIES, DEPARTMENT_LIST } from "./taxonomy.js";

export const MODEL = process.env.CIVICLENS_MODEL || "claude-opus-5-5";

export function aiAvailable() {
  if (process.env.CIVICLENS_ENGINE === "rules") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client;
function getClient() {
  client ??= new Anthropic();
  return client;
}

const TRIAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "language", "english_translation", "title", "category", "subcategory", "severity", "severity_reason",
    "department", "location", "vulnerable_site", "photo_observation", "photo_consistency", "missing_info",
    "duplicate_of", "citizen_reply", "confidence",
  ],
  properties: {
    language: { type: "string", description: "Language the citizen wrote in, e.g. English, Kannada, Hindi, Hinglish, Tamil" },
    english_translation: { type: "string" },
    title: { type: "string", description: "Officer-facing headline, max 8 words" },
    category: { type: "string", enum: CATEGORIES },
    subcategory: { type: "string", description: "e.g. pothole, streetlight out, live wire, pipe burst, garbage pile" },
    severity: { type: "string", enum: SEVERITIES },
    severity_reason: { type: "string", description: "ONE line, max 20 words, naming the concrete risk" },
    department: { type: "string", enum: DEPARTMENT_LIST },
    location: { type: "string", description: "Location / landmark as stated, empty string if none given" },
    vulnerable_site: { type: "boolean", description: "Near a school, hospital, anganwadi, bus stop, or affects children/elderly" },
    photo_observation: { type: "string", description: "What the photo shows in one sentence; empty string if no photo" },
    photo_consistency: { type: "string", enum: ["consistent", "inconsistent", "no_photo"] },
    missing_info: { type: "array", items: { type: "string" }, description: "Details the officer still needs; empty if actionable" },
    duplicate_of: { type: "string", description: "id of an OPEN ticket describing the same issue at the same place, else empty string" },
    citizen_reply: { type: "string", description: "Short acknowledgement to the citizen, IN THE CITIZEN'S LANGUAGE, with what happens next" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

// Frozen system prompt (no timestamps / ids) so it can be prompt-cached across requests.
const SYSTEM_PROMPT = `You are CivicLens, the triage desk of an Indian city municipal corporation.
Citizens send complaints from apps, WhatsApp and social media: often vague, misspelt, in English, Kannada, Hindi, Hinglish or another Indian language, sometimes with a photo.
Turn each complaint into a ticket an officer can act on immediately.

CATEGORIES
- roads: potholes, damaged roads/footpaths, broken dividers, speed breakers
- waste: garbage piles, uncollected waste, overflowing bins, debris dumping, dead animals
- water: drinking-water leaks, burst pipes, no supply, contaminated water
- electricity: streetlights, live/hanging wires, transformers, electric poles, outages
- trees: fallen or dangerous trees and branches
- drainage: storm drains, sewage overflow, open/blocked manholes, waterlogging
- other: anything else (route to the grievance cell)

ROUTING (department must be one of these exact strings)
- roads → "Roads & Infrastructure"
- waste → "Solid Waste Management"
- water → "Water Supply & Sewerage Board"
- electricity, streetlight not working → "Electrical (Streetlights)"
- electricity, live/fallen/sparking wire, transformer, outage → "Power Distribution Utility – Emergency"
- trees → "Horticulture & Tree Cell"
- drainage → "Storm Water Drains"
- other / unclear → "Public Grievance Cell (manual review)"

SEVERITY (judge the risk to people first, then to property, then inconvenience)
- Critical: immediate danger to life or public health. Exposed live wire, open manhole on a busy road, contaminated drinking water making people sick, a tree that has fallen on a house or vehicle, a fire.
- High: likely to cause injury, accidents or wide disruption soon. Deep pothole on a main road, fallen tree blocking a road, burst main pipe, sewage overflowing onto a street, a dark stretch at night.
- Medium: a real problem with limited immediate risk. Garbage not cleared for a few days, a single streetlight out on a lit road, a small leak.
- Low: cosmetic or improvement requests. Faded road markings, a request for a new bench.
Escalate one level when the issue is next to a school, hospital, anganwadi or bus stop, or affects children or the elderly, and say so in the reason.
If the citizen exaggerates ("very very urgent!!!") but describes a minor issue, grade the described facts, not the tone.

PHOTO
If a photo is attached, describe what it shows and say whether it matches the text. If the photo shows a worse problem than the text describes, grade the photo. If they do not match, mark "inconsistent" and lower confidence.

DUPLICATES
You will get a list of open tickets nearby. Set duplicate_of to a ticket id only if it is clearly the same issue at the same place; otherwise use an empty string.

OUTPUT
- title: max 8 words, in English.
- severity_reason: exactly one line naming the concrete risk, e.g. "Exposed live wire beside a primary school; electrocution risk to children."
- location: copy the landmark/area the citizen gave; never invent one.
- missing_info: only what an officer truly needs (usually exact location); empty list if actionable.
- citizen_reply: 1–2 friendly sentences in the citizen's own language and script.
- english_translation: the complaint in plain English (copy as is if already English).`;

export async function triageWithAI({ text, photo, openTickets }) {
  const content = [];
  if (photo) {
    const m = photo.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  const nearby = openTickets.length
    ? openTickets.map((t) => `- ${t.id} | ${t.category} | ${t.location || "no location"} | ${t.title}`).join("\n")
    : "(none)";
  content.push({
    type: "text",
    text: `<open_tickets>\n${nearby}\n</open_tickets>\n\n<complaint>\n${text || "(no text – photo only)"}\n</complaint>`,
  });

  const request = {
    model: MODEL,
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { effort: "low", format: { type: "json_schema", schema: TRIAGE_SCHEMA } },
  };

  let response;
  try {
    // Server-side fallback: if the model declines, the API re-runs on a fallback model in the same call.
    response = await getClient().beta.messages.create({
      ...request,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      response = await getClient().messages.create(request); // account without the fallback beta
    } else {
      throw err;
    }
  }

  if (response.stop_reason === "refusal") throw new Error("Model declined to triage this complaint");
  if (response.stop_reason === "max_tokens") throw new Error("Triage output was cut off");
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No triage output returned");
  return JSON.parse(textBlock.text);
}
