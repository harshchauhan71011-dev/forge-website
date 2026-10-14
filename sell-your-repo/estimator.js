/*
 * Forge repository estimator — runs entirely in the browser; nothing is sent anywhere.
 * Ported from the Forge estimator engine (engine version 2026-10-14.1). Five self-reported
 * answers -> a deliberately low-anchored range: unmeasured quality signals are priced
 * cautiously, and the low end carries an anchor discount so that a verified review moves the
 * price up rather than down.
 */

export const ENGINE_VERSION = "2026-10-14.1";

export const LANGUAGES = ["TypeScript", "JavaScript", "Python", "Java", "Go", "C#", "C++", "C", "Rust", "Ruby", "PHP", "Kotlin", "Swift", "Scala", "COBOL", "Other"];

export const AGE = [
  { value: "lt1", label: "Less than 1 year", short: "<1 yr", months: [0, 12] },
  { value: "1-2", label: "1–2 years", short: "1–2", months: [12, 24] },
  { value: "2-4", label: "2–4 years", short: "2–4", months: [24, 48] },
  { value: "4-7", label: "4–7 years", short: "4–7", months: [48, 84] },
  { value: "7plus", label: "7+ years", short: "7+", months: [84, Infinity] },
];
export const CONTRIBUTORS = [
  { value: "1", label: "Just me", short: "1", range: [1, 1] },
  { value: "2-3", label: "2–3 people", short: "2–3", range: [2, 3] },
  { value: "4-10", label: "4–10 people", short: "4–10", range: [4, 10] },
  { value: "11-50", label: "11–50 people", short: "11–50", range: [11, 50] },
  { value: "50plus", label: "More than 50", short: "50+", range: [50, Infinity] },
];
export const LOC = [
  { value: "lt10k", label: "Under 10k lines", short: "<10k", range: [0, 10000] },
  { value: "10k-100k", label: "10k–100k lines", short: "10k–100k", range: [10000, 100000] },
  { value: "100k-1m", label: "100k–1M lines", short: "100k–1M", range: [100000, 1000000] },
  { value: "1mplus", label: "Over 1M lines", short: "1M+", range: [1000000, Infinity] },
];
export const BYTES = [
  { value: "lt50mb", label: "Under 50 MB", short: "<50 MB" },
  { value: "50-500mb", label: "50–500 MB", short: "50–500 MB" },
  { value: "500mbplus", label: "Over 500 MB", short: "500 MB+" },
];
export const PR_BUCKETS = [
  { value: "lt50", label: "Fewer than 50", range: [0, 49] },
  { value: "50-200", label: "50–200", range: [50, 200] },
  { value: "200-1000", label: "200–1,000", range: [200, 1000] },
  { value: "1000-5000", label: "1,000–5,000", range: [1000, 5000] },
  { value: "5000plus", label: "More than 5,000", range: [5000, Infinity] },
];

const W = {
  activeMonths: [[36, 1.2], [12, 1.1], [3, 1.0], [0, 0.8]],
  contributors: [[20, 1.15], [5, 1.1], [2, 1.0], [0, 0.85]],
  loc: [[100000, 1.15], [20000, 1.1], [5000, 1.0], [0, 0.85]],
  baseHalfWidth: 0.15,
  step: 5,
  minSpread: 10,
  activityFactor: 0.5,
  unverifiedIntegrity: 0.85,
  bytesSize: { lt50mb: 0.85, "50-500mb": 1.0, "500mbplus": 1.0 },
  extraDownWidth: 0.15,
  prBucketWidth: 0.1,
  otherLanguageWidth: 0.1,
  implausibleWidth: 0.1,
  maxDownWidth: 0.6,
  anchorDiscount: 0.15,
};

/** The open buyer program: private application repositories, exclusive rights. */
export const PROGRAM = {
  name: "Private application repositories",
  baseUsd: 75,
  minUsd: 50,
  maxUsd: 150,
  languageMultipliers: {},
  rules: [
    { key: "min_contributors", field: "contributors", op: "gte", value: 2, label: "At least 2 people committed to it" },
    { key: "max_top_author_share", field: null, label: "No single author wrote more than 90% of the commits" },
    { key: "max_bot_share", field: null, label: "Fewer than 30% of commits are from bots" },
    { key: "min_loc", field: "loc", op: "gte", value: 5000, label: "At least 5,000 lines of your own source code" },
    { key: "min_prs", field: "prs", op: "gt", value: 100, label: "More than 100 pull requests or merge requests" },
    { key: "no_secret_files", field: null, label: "No committed credential files (.env, keys, certificates)" },
  ],
  overrides: [{ whenLanguageIn: ["COBOL"], waive: ["min_prs"], reason: "Mainframe code predates pull requests, so there is no PR requirement for COBOL." }],
};

const find = (xs, v) => xs.find((x) => x.value === v);
const band = (bands, v) => bands.find(([t]) => v >= t)?.[1];
const fmt = (n) => n.toLocaleString("en-US");

function factor(key, label, weight, explanation) {
  const direction = weight > 1 ? "up" : weight < 1 ? "down" : "neutral";
  const effect = direction === "up" ? "increases value" : direction === "down" ? "lowers value" : "no effect on price";
  return { key, label, weight, direction, explanation: `${explanation} — ${effect}` };
}

function prInterval(input) {
  return input.pr.mode === "exact" ? [input.pr.count, input.pr.count] : [...find(PR_BUCKETS, input.pr.bucket).range];
}
function intervalFor(field, input) {
  if (field === "prs") return prInterval(input);
  if (field === "contributors") return [...find(CONTRIBUTORS, input.contributors).range];
  if (field === "loc") return input.size.unit === "loc" ? [...find(LOC, input.size.bucket).range] : [0, Infinity];
  return undefined;
}
/** true = passes for every value in the interval, false = fails for all, null = depends. */
function evaluate(rule, [lo, hi]) {
  const v = rule.value;
  if (rule.op === "gte") return lo >= v ? true : hi < v ? false : null;
  if (rule.op === "gt") return lo > v ? true : hi <= v ? false : null;
  return null;
}

function eligibility(input) {
  const lang = input.language.toLowerCase();
  const waivers = new Map();
  for (const o of PROGRAM.overrides) if (o.whenLanguageIn.some((l) => l.toLowerCase() === lang)) for (const k of o.waive) waivers.set(k, o.reason);
  const out = { status: "eligible", failed: [], pending: [], waived: [], audited: [] };
  for (const rule of PROGRAM.rules) {
    const ref = { key: rule.key, label: rule.label };
    if (waivers.has(rule.key)) {
      out.waived.push({ ...ref, reason: waivers.get(rule.key) });
      continue;
    }
    const interval = rule.field ? intervalFor(rule.field, input) : undefined;
    const outcome = interval ? evaluate(rule, interval) : undefined;
    if (outcome === undefined) out.audited.push(ref);
    else if (outcome === false) out.failed.push(ref);
    else if (outcome === null) out.pending.push(ref);
  }
  out.status = out.failed.length ? "ineligible" : out.pending.length ? "pending" : "eligible";
  return out;
}

function factors(input, langMultiplier) {
  const age = find(AGE, input.age);
  const team = find(CONTRIBUTORS, input.contributors);
  const list = [
    factor("history", "Repository age", band(W.activeMonths, age.months[0] * W.activityFactor) ?? 1, `${age.label} old, counted at the low end of that range`),
    factor("contributors", "Team size", band(W.contributors, team.range[0]) ?? 1, `${team.label} wrote code, counted at the low end`),
  ];
  if (input.size.unit === "loc") {
    const loc = find(LOC, input.size.bucket);
    list.push(factor("volume", "Code volume", band(W.loc, loc.range[0]) ?? 1, `${loc.label}, counted at the low end. Size counts for less than history and team`));
  } else {
    list.push(factor("volume", "Code volume", W.bytesSize[input.size.bucket], "Repository size on disk includes history and assets, so it tells us little about code volume"));
  }
  list.push(factor("unverified_integrity", "Not yet measured", W.unverifiedIntegrity, "Tests, CI, bot activity and vendored code can only be measured in review, so we assume the cautious case for now"));
  if (langMultiplier !== 1) list.push(factor("language", `${input.language} source`, langMultiplier, `This program pays a premium for ${input.language}`));
  return list;
}

function implausible(input, [prLo]) {
  const soloOrNew = input.contributors === "1" || input.age === "lt1";
  const tiny = input.size.bucket === "lt10k" || input.size.bucket === "lt50mb";
  return (soloOrNew && prLo > 1000) || (tiny && prLo > 5000) || prLo > 100000;
}

function reasons(input) {
  const r = [{ key: "self_reported", explanation: "Every answer above is self-reported, so each one is counted cautiously." }];
  if (input.pr.mode === "bucket") r.push({ key: "pr_bucket", explanation: "You gave a range for pull requests rather than the exact count." });
  if (input.language === "Other") r.push({ key: "other_language", explanation: "We price some languages differently, and we don't know yours yet." });
  if (implausible(input, prInterval(input))) r.push({ key: "implausible", explanation: "The pull-request count is unusual for the team size, age or size you chose." });
  return r;
}

function roundBand(lowRaw, highRaw, min, max) {
  const EPS = 1e-9;
  min = Math.ceil(min / W.step - EPS) * W.step;
  max = Math.max(min, Math.floor(max / W.step + EPS) * W.step);
  const clamp = (v) => Math.min(max, Math.max(min, v));
  let low = clamp(Math.floor(lowRaw / W.step + EPS) * W.step);
  let high = clamp(Math.ceil(highRaw / W.step - EPS) * W.step);
  if (high - low < W.minSpread) {
    if (low + W.minSpread <= max) high = low + W.minSpread;
    else low = Math.max(min, high - W.minSpread);
  }
  return [low, high];
}

function prFactor(input, elig) {
  const what = input.pr.mode === "exact" ? `${fmt(input.pr.count)} merged pull requests` : `${find(PR_BUCKETS, input.pr.bucket).label} merged pull requests`;
  const note = elig.waived.some((r) => r.key === "min_prs") ? "not required for this language" : "used to check eligibility";
  return factor("pr_count", "Pull requests", 1, `${what} (${note})`);
}

/**
 * input: { language, pr: {mode:'exact',count} | {mode:'bucket',bucket}, age, contributors,
 *          size: {unit:'loc'|'bytes', bucket} }
 */
export function estimate(input) {
  const langMultiplier = Object.entries(PROGRAM.languageMultipliers).find(([l]) => l.toLowerCase() === input.language.toLowerCase())?.[1] ?? 1;
  const elig = eligibility(input);
  const fs = factors(input, langMultiplier);
  const point = fs.reduce((p, f) => p * f.weight, PROGRAM.baseUsd);
  const rs = reasons(input);
  const extra = rs.reduce((w, r) => w + (r.key === "pr_bucket" ? W.prBucketWidth : r.key === "other_language" ? W.otherLanguageWidth : r.key === "implausible" ? W.implausibleWidth : 0), 0);
  const downWidth = Math.min(W.maxDownWidth, W.baseHalfWidth + W.extraDownWidth + extra);
  const [low, high] = roundBand(point * (1 - downWidth) * (1 - W.anchorDiscount), point * (1 + W.baseHalfWidth), PROGRAM.minUsd * langMultiplier, PROGRAM.maxUsd * langMultiplier);
  const priced = elig.status !== "ineligible";
  return {
    low: priced ? low : null,
    high: priced ? high : null,
    eligibility: elig,
    factors: [...fs, prFactor(input, elig)],
    reasons: rs,
    engineVersion: ENGINE_VERSION,
  };
}
