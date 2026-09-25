// Pure interpreter for the generalized program schema (see PLANNING.md).
// Takes `content` explicitly -- no globals, no DOM -- so the same module runs
// in the browser and in tests. Not wired into the live UI yet (see
// PLANNING.md Phase A2/B): this exists purely to be proven equivalent to the
// current ski-specific app.js logic before any real program data migrates.

export function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const MS_PER_DAY = 864e5;

// Cumulative walk over periods, since a period's lengthDays can vary --
// NOT the old fixed "divide by 7" math, which assumed every week was 7 days.
function periodOffsets(content) {
  let offset = 0;
  return content.periods.map((p) => {
    const dayOffsetStart = offset;
    offset += p.lengthDays;
    return { ...p, dayOffsetStart, dayOffsetEnd: offset };
  });
}

export function periodStart(content, n) {
  const p = periodOffsets(content).find((x) => x.n === n);
  if (!p) return null;
  const base = parseISO(content.startDate);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + p.dayOffsetStart);
}

export function periodEnd(content, n) {
  const p = periodOffsets(content).find((x) => x.n === n);
  if (!p) return null;
  const base = parseISO(content.startDate);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + p.dayOffsetEnd - 1);
}

// Returns a period number, or "ongoing" once every period has elapsed.
export function currentPeriod(content, now = new Date()) {
  const base = parseISO(content.startDate);
  const days = Math.floor((now - base) / MS_PER_DAY);
  if (days < 0) return content.periods[0]?.n ?? null;
  const hit = periodOffsets(content).find((p) => days >= p.dayOffsetStart && days < p.dayOffsetEnd);
  return hit ? hit.n : "ongoing";
}

export function periodMeta(content, n) {
  return content.periods.find((p) => p.n === n) || null;
}

export function periodLabel(n) {
  return n === "ongoing" ? "In-season" : `Week ${n}`;
}

export function periodPhase(content, n) {
  if (n === "ongoing") return content.ongoingPeriod?.phase || "";
  return periodMeta(content, n)?.phase || "";
}

function templateAppliesTo(template, n) {
  if (n === "ongoing") return template.scope.type === "ongoing";
  if (template.scope.type === "period") return template.scope.n === n;
  if (template.scope.type === "periodRange") return template.scope.periods.includes(n);
  return false;
}

export function sessionKeysFor(content, n) {
  return content.sessionTemplates.filter((t) => templateAppliesTo(t, n)).map((t) => t.key);
}

// rx is either a fixed string, or an object keyed by period number (as a
// string, since JSON object keys are always strings) for a recurring
// template's per-period variant. Returns null if this period is skipped.
function resolveRx(rx, n) {
  if (typeof rx === "string") return rx;
  const v = rx[String(n)];
  return v === undefined ? null : v;
}

function parseRx(rx, o) {
  const r = { sets: 1, reps: "", pct: o.pct || null };
  let m;
  if ((m = rx.match(/^(\d+)\s*×\s*(\d+)/))) {
    r.sets = +m[1];
    r.reps = m[2];
  } else if ((m = rx.match(/^(\d+)\s*×/))) {
    r.sets = +m[1];
  } else if ((m = rx.match(/(\d+)\s*rounds?/))) {
    r.sets = +m[1];
  }
  if ((m = rx.match(/@\s*([\d.]+)%/))) r.pct = +m[1] / 100;
  return r;
}

export function getSession(content, n, key) {
  const template = content.sessionTemplates.find((t) => t.key === key && templateAppliesTo(t, n));
  if (!template) return null;
  const items = template.items
    .map(({ name, rx, options }) => [name, resolveRx(rx, n), options || {}])
    .filter(([, rx]) => rx != null)
    .map(([name, rx, o], i) => Object.assign({ i, name, rx }, o, parseRx(rx, o)));
  const deload = n !== "ongoing" && !!periodMeta(content, n)?.deload;
  return {
    id: `p${n}-${key}`,
    period: n,
    key,
    title: template.title,
    shortLabel: template.shortLabel || key,
    items,
    isTest: !!template.isTest,
    noWarmupSpikes: !!template.noWarmupSpikes || deload,
    warmupTemplate: template.warmupTemplate ?? null,
    testDayNote: template.testDayNote ?? null,
  };
}
