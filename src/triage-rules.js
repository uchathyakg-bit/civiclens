// Offline triage engine: keyword rules in English, Hindi (Devanagari + romanised) and Kannada.
// Used when no Claude API key is configured, or as a safety net if the AI call fails,
// so the demo never breaks. Claude is the primary engine (see triage-ai.js).

import { DEFAULT_ROUTE, DEPARTMENTS } from "./taxonomy.js";

const CATEGORY_KEYWORDS = {
  electricity: ["streetlight", "street light", "street-light", "lamp post", "light pole", "wire", "transformer", "electric", "power cut", "power outage", "current", "sparking", "pole",
    "bijli", "taar", "बिजली", "तार", "बत्ती", "खंभा", "ವಿದ್ಯುತ್", "ತಂತಿ", "ಬೀದಿ ದೀಪ", "ದೀಪ", "ಕರೆಂಟ್", "ಕಂಬ"],
  trees: ["tree", "branch", "fallen tree", "uprooted", "ped ", "पेड़", "पेड", "डाल", "ಮರ", "ಕೊಂಬೆ"],
  water: ["water leak", "pipe", "pipeline", "leak", "no water", "water supply", "tap", "contaminated", "dirty water", "borewell", "water", "paani", "पानी", "पाइप", "ನೀರು", "ಪೈಪ್", "ಸೋರಿಕೆ"],
  drainage: ["drain", "sewage", "sewer", "manhole", "waterlog", "flood", "clogged", "overflowing drain", "gutter", "naali", "नाली", "सीवर", "ಚರಂಡಿ", "ಒಳಚರಂಡಿ", "ಮ್ಯಾನ್‌ಹೋಲ್"],
  waste: ["garbage", "trash", "waste", "rubbish", "litter", "dump", "debris", "dead animal", "bin", "kachra", "kooda", "कचरा", "कूड़ा", "ಕಸ"],
  roads: ["pothole", "road", "footpath", "pavement", "speed breaker", "zebra", "road marking", "divider", "crack", "tar", "asphalt", "sadak", "gaddha", "सड़क", "गड्ढा", "गड्ढे", "ರಸ್ತೆ", "ಗುಂಡಿ"],
};

// Life-safety hazards → Critical.
const CRITICAL = [
  { k: ["live wire", "exposed wire", "hanging wire", "naked wire", "fallen wire", "sparking", "electrocut", "shock", "bijli ka taar", "बिजली का तार", "करंट", "ತಂತಿ", "ಕರೆಂಟ್"], why: "Exposed / live electrical hazard – risk of electrocution" },
  { k: ["open manhole", "uncovered manhole", "manhole open", "खुला मैनहोल", "ಮ್ಯಾನ್‌ಹೋಲ್ ತೆರೆದ"], why: "Open manhole – serious fall risk to pedestrians and two-wheelers" },
  { k: ["fire", "gas leak", "blast", "explosion", "आग", "ಬೆಂಕಿ"], why: "Fire / explosion hazard – immediate danger to life" },
  { k: ["collapsed", "collapse", "fell on", "fallen on a car", "fallen on house", "injured", "accident happened", "someone fell", "ಕುಸಿದ"], why: "Structure or object has already caused or is causing harm" },
  { k: ["contaminated", "sewage mixing", "dirty water coming", "people falling sick", "ಕಲುಷಿತ", "गंदा पानी"], why: "Contaminated drinking water – public health emergency" },
];

const HIGH = [
  { k: ["deep pothole", "big pothole", "huge pothole", "large pothole", "accident", "blocking the road", "blocked road", "blocking road", "ದೊಡ್ಡ ಗುಂಡಿ", "ಬಿದ್ದರು", "बड़ा गड्ढा", "fallen tree", "tree fell", "uprooted", "पेड़ गिर", "ಮರ ಬಿದ್ದ"], why: "Obstructs traffic and poses an accident risk" },
  { k: ["burst", "pipe broke", "major leak", "water gushing", "wasting water", "no water for", "no water since", "ನೀರು ಬಂದಿಲ್ಲ"], why: "Major water loss / supply disruption affecting many households", cat: ["water"] },
  { k: ["sewage overflow", "overflowing sewage", "sewage on road", "waterlogging", "waterlogged", "flooded", "flood"], why: "Overflowing sewage / flooding – health and mobility risk" },
  { k: ["dark", "no light", "street is dark", "unsafe at night", "women", "ಕತ್ತಲು", "अंधेरा"], why: "Dark street at night creates a safety risk for residents", cat: ["electricity"] },
  { k: ["not collected for", "days", "stinking", "rotting", "dead animal", "mosquito", "dengue", "बदबू", "ದುರ್ವಾಸನೆ"], why: "Accumulated waste is a sanitation and disease risk", cat: ["waste"] },
];

const LOW = [
  { k: ["faded", "paint", "suggest", "request", "would be nice", "minor", "small crack", "beautif", "signboard", "name board", "bench"], why: "Cosmetic / improvement request with no immediate risk" },
];

const VULNERABLE = ["school", "hospital", "college", "anganwadi", "clinic", "children", "kids", "elderly", "bus stop", "playground", "market",
  "स्कूल", "अस्पताल", "बच्चे", "ಶಾಲೆ", "ಆಸ್ಪತ್ರೆ", "ಮಕ್ಕಳು"];

const POWER_HAZARD = ["live wire", "exposed wire", "hanging wire", "naked wire", "fallen wire", "transformer", "sparking", "power cut", "power outage", "electrocut", "shock", "taar", "तार", "ತಂತಿ", "करंट", "ಕರೆಂಟ್"];

function has(text, words) {
  return words.find((w) => text.includes(w));
}

export function detectLanguage(text) {
  if (/[ಀ-೿]/.test(text)) return "Kannada";
  if (/[ऀ-ॿ]/.test(text)) return "Hindi";
  if (/[஀-௿]/.test(text)) return "Tamil";
  if (/[ఀ-౿]/.test(text)) return "Telugu";
  if (/\b(hai|nahi|kar|raha|bahut|ka|ki|ke|mein)\b/i.test(text)) return "Hinglish";
  return "English";
}

function extractLocation(raw) {
  const m = raw.match(/\b(?:near|opposite|opp\.?|behind|beside|next to|in front of|at|on|in)\s+(?:the\s+)?([A-Z0-9][^,.!?\n]{2,60})/);
  return m ? m[0].trim() : "";
}

const REPLY = {
  English: (id, dept, sev) => `Thank you. Your complaint ${id} has been registered as ${sev} priority and sent to ${dept}.`,
  Hinglish: (id, dept, sev) => `Dhanyavaad. Aapki shikayat ${id} ${sev} priority ke saath ${dept} ko bhej di gayi hai.`,
  Hindi: (id, dept, sev) => `धन्यवाद। आपकी शिकायत ${id} को ${sev} प्राथमिकता के साथ ${dept} विभाग को भेज दिया गया है।`,
  Kannada: (id, dept, sev) => `ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ದೂರು ${id} ಅನ್ನು ${sev} ಆದ್ಯತೆಯೊಂದಿಗೆ ${dept} ಇಲಾಖೆಗೆ ಕಳುಹಿಸಲಾಗಿದೆ.`,
};

export function citizenReply(language, id, dept, sev) {
  return (REPLY[language] || REPLY.English)(id, dept, sev);
}

export function triageWithRules({ text, hasPhoto }) {
  const raw = text || "";
  const t = " " + raw.toLowerCase() + " ";
  const language = detectLanguage(raw);

  // Category: score each by number of keyword hits, earliest-listed category wins ties.
  let category = "other";
  let best = 0;
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = words.filter((w) => t.includes(w)).length;
    if (hits > best) { best = hits; category = cat; }
  }

  const vulnerableWord = has(t, VULNERABLE);
  let severity = "Medium";
  let reason = "Civic issue affecting residents; needs attention within the standard window";
  const applies = (r) => (!r.cat || r.cat.includes(category)) && has(t, r.k);
  let hit;
  if ((hit = CRITICAL.find(applies))) { severity = "Critical"; reason = hit.why; }
  else if ((hit = HIGH.find(applies))) { severity = "High"; reason = hit.why; }
  else if ((hit = LOW.find(applies))) { severity = "Low"; reason = hit.why; }

  if (category === "other" && severity === "Medium") {
    severity = "Low";
    reason = "Too vague to assess – no specific issue or location described; needs follow-up";
  }

  // A hazard next to a school / hospital is escalated one level.
  if (vulnerableWord && severity === "High") {
    severity = "Critical";
    reason = `${reason}, next to a ${vulnerableWord.trim()} (vulnerable users)`;
  } else if (vulnerableWord && severity !== "Low") {
    reason = `${reason}; located near a ${vulnerableWord.trim()}`;
  }

  let department = DEFAULT_ROUTE[category];
  if (category === "electricity" && has(t, POWER_HAZARD)) department = DEPARTMENTS.POWER;

  const location = extractLocation(raw);
  const missing = [];
  if (!location) missing.push("Exact location or nearest landmark");
  if (category === "other") missing.push("What kind of problem it is (road, garbage, water, power, tree, drain)");

  // Officer-facing English headline (the AI engine writes its own; here we build one from the category).
  const TITLE = {
    roads: "Road damage / pothole", waste: "Garbage not cleared", water: "Water leak / supply problem",
    electricity: department === DEPARTMENTS.POWER ? "Live electrical hazard" : "Streetlight not working",
    trees: "Fallen / dangerous tree", drainage: "Drain or manhole problem", other: "Unclear complaint – needs review",
  };
  const shortLoc = location.replace(/^(?:near|opposite|opp\.?|behind|beside|next to|in front of|at|on|in)\s+(?:the\s+)?/i, "");
  return {
    language,
    english_translation: language === "English" ? raw : "(translation needs the AI engine – original text kept)",
    title: shortLoc ? `${TITLE[category]} – ${shortLoc}` : TITLE[category],
    category,
    subcategory: "",
    severity,
    severity_reason: reason,
    department,
    location,
    vulnerable_site: Boolean(vulnerableWord),
    photo_observation: hasPhoto ? "Photo attached – not analysed in offline mode" : "",
    photo_consistency: hasPhoto ? "not_checked" : "no_photo",
    missing_info: missing,
    duplicate_of: "",
    confidence: best >= 2 ? "medium" : "low",
  };
}
