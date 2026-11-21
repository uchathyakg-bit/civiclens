// Accuracy check: runs every sample complaint through the triage engine and compares
// category / severity / department with the expected answer.
//   npm run eval          → Claude if a key is set, otherwise the rules engine
//   npm run eval:rules    → rules engine only
import { SAMPLES } from "../src/samples.js";
import { triageWithRules } from "../src/triage-rules.js";
import { triageWithAI, aiAvailable, MODEL } from "../src/triage-ai.js";

const useAI = aiAvailable();
console.log(`Engine: ${useAI ? `Claude (${MODEL})` : "offline rules"}\n`);

const fields = ["category", "severity", "department"];
const score = { category: 0, severity: 0, department: 0 };
const cases = SAMPLES.filter((s) => !s.expect.duplicate);

for (const s of cases) {
  const r = useAI ? await triageWithAI({ text: s.text, openTickets: [] }) : triageWithRules({ text: s.text });
  const marks = fields.map((f) => {
    const ok = r[f] === s.expect[f];
    if (ok) score[f]++;
    return ok ? "✓" : `✗ ${f}: got "${r[f]}", want "${s.expect[f]}"`;
  });
  console.log(`${s.label.padEnd(24)} ${marks.filter((m) => m !== "✓").join("  ") || "✓ all correct"}`);
  console.log(`${"".padEnd(24)} ↳ ${r.severity}: ${r.severity_reason}`);
}

console.log("\nAccuracy:");
for (const f of fields) console.log(`  ${f.padEnd(11)} ${score[f]}/${cases.length}`);
