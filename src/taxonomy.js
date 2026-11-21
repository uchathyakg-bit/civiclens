// Shared taxonomy: categories, severities, departments, SLAs and the priority formula.
// Kept in one place so the AI prompt, the offline rules engine and the dashboard all agree.

export const CATEGORIES = ["roads", "waste", "water", "electricity", "trees", "drainage", "other"];
export const SEVERITIES = ["Low", "Medium", "High", "Critical"];

export const DEPARTMENTS = {
  ROADS: "Roads & Infrastructure",
  SWM: "Solid Waste Management",
  WATER: "Water Supply & Sewerage Board",
  STREETLIGHTS: "Electrical (Streetlights)",
  POWER: "Power Distribution Utility – Emergency",
  HORTICULTURE: "Horticulture & Tree Cell",
  SWD: "Storm Water Drains",
  GRIEVANCE: "Public Grievance Cell (manual review)",
};

export const DEPARTMENT_LIST = Object.values(DEPARTMENTS);

// Default routing per category. Electricity is split: streetlights are a municipal job,
// live wires / transformers / outages belong to the power utility.
export const DEFAULT_ROUTE = {
  roads: DEPARTMENTS.ROADS,
  waste: DEPARTMENTS.SWM,
  water: DEPARTMENTS.WATER,
  electricity: DEPARTMENTS.STREETLIGHTS,
  trees: DEPARTMENTS.HORTICULTURE,
  drainage: DEPARTMENTS.SWD,
  other: DEPARTMENTS.GRIEVANCE,
};

// Response-time targets (hours) per severity.
export const SLA_HOURS = { Critical: 4, High: 24, Medium: 72, Low: 168 };

const SEVERITY_BASE = { Critical: 100, High: 70, Medium: 40, Low: 15 };

export function bumpSeverity(sev) {
  const i = SEVERITIES.indexOf(sev);
  return SEVERITIES[Math.min(i + 1, SEVERITIES.length - 1)];
}

// Priority score used to sort the officer dashboard.
// severity dominates; repeat reports, vulnerable sites (schools, hospitals) and waiting time add on top.
export function priorityScore(t, now = Date.now()) {
  if (t.status === "Resolved") return 0;
  const hoursOpen = (now - new Date(t.createdAt).getTime()) / 36e5;
  const slaRatio = hoursOpen / (SLA_HOURS[t.severity] || 72);
  let score = SEVERITY_BASE[t.severity] ?? 40;
  score += Math.min((t.reports?.length || 1) - 1, 5) * 6;
  if (t.vulnerable_site) score += 10;
  score += Math.min(slaRatio, 2) * 10; // up to +20 as the ticket approaches / passes its SLA
  return Math.round(score);
}
