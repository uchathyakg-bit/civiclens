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

// Field crews per department (sample roster for the prototype). `capacity` = jobs a crew can hold at once.
export const CREWS = [
  { id: "R-1", name: "Road Repair Crew R-1", dept: DEPARTMENTS.ROADS, capacity: 3 },
  { id: "R-2", name: "Road Repair Crew R-2", dept: DEPARTMENTS.ROADS, capacity: 3 },
  { id: "W-1", name: "Waste Clearance Team W-1", dept: DEPARTMENTS.SWM, capacity: 4 },
  { id: "W-2", name: "Waste Clearance Team W-2", dept: DEPARTMENTS.SWM, capacity: 4 },
  { id: "P-1", name: "Water Line Crew P-1", dept: DEPARTMENTS.WATER, capacity: 3 },
  { id: "P-2", name: "Water Line Crew P-2", dept: DEPARTMENTS.WATER, capacity: 3 },
  { id: "L-1", name: "Streetlight Crew L-1", dept: DEPARTMENTS.STREETLIGHTS, capacity: 4 },
  { id: "E-1", name: "Power Emergency Crew E-1", dept: DEPARTMENTS.POWER, capacity: 2 },
  { id: "E-2", name: "Power Emergency Crew E-2", dept: DEPARTMENTS.POWER, capacity: 2 },
  { id: "T-1", name: "Tree Cutting Crew T-1", dept: DEPARTMENTS.HORTICULTURE, capacity: 3 },
  { id: "D-1", name: "Drain & Manhole Crew D-1", dept: DEPARTMENTS.SWD, capacity: 3 },
  { id: "D-2", name: "Drain & Manhole Crew D-2", dept: DEPARTMENTS.SWD, capacity: 3 },
  { id: "G-1", name: "Grievance Field Officer G-1", dept: DEPARTMENTS.GRIEVANCE, capacity: 5 },
];

// Target time for a dispatched crew to reach the site (minutes).
export const ETA_MINUTES = { Critical: 45, High: 240, Medium: 1440, Low: 4320 };

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
