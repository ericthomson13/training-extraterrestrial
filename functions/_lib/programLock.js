// Enforces "an update can revise a program going forward, but must never
// rewrite periods that have already happened" (see PLANNING.md). Compares
// the INTERPRETED output of programEngine.js -- the same module the client
// renders sessions with -- rather than a raw JSON diff, so a change hidden
// inside a periodRange session's per-period rx map is still caught, and
// harmless reshuffling that renders identically isn't a false positive.
import { currentPeriod, getSession, periodMeta, sessionKeysFor } from "../../public/programEngine.js";

// The "ongoing" phase is deliberately exempt: by definition it's the
// open-ended, still-happening segment -- exactly the "going forward" part an
// update is meant to be able to revise live.
export function lockedPeriodNumbers(content, now = new Date()) {
  const cp = currentPeriod(content, now);
  if (cp === "ongoing") return content.periods.map((p) => p.n);
  return content.periods.filter((p) => p.n < cp).map((p) => p.n);
}

export function findUpdateViolations(oldContent, newContent, now = new Date()) {
  const violations = [];

  if (oldContent.startDate !== newContent.startDate) {
    violations.push("startDate cannot change once a program has versions -- it would retroactively shift when past periods happened");
  }
  if (oldContent.units !== newContent.units) {
    violations.push("units cannot change once a program has versions -- it would reinterpret already-logged loads under a different unit");
  }

  for (const n of lockedPeriodNumbers(oldContent, now)) {
    const oldMeta = periodMeta(oldContent, n);
    const newMeta = periodMeta(newContent, n);
    if (!newMeta) {
      violations.push(`period ${n}: already happened and cannot be removed`);
      continue;
    }
    if (JSON.stringify(oldMeta) !== JSON.stringify(newMeta)) {
      violations.push(`period ${n}: already happened -- its phase, length, or deload flag cannot change`);
    }

    const oldKeys = sessionKeysFor(oldContent, n).slice().sort();
    const newKeys = sessionKeysFor(newContent, n).slice().sort();
    if (JSON.stringify(oldKeys) !== JSON.stringify(newKeys)) {
      violations.push(`period ${n}: already happened -- its sessions cannot be added or removed (was [${oldKeys.join(", ")}], now [${newKeys.join(", ")}])`);
      continue;
    }

    for (const key of oldKeys) {
      const oldSession = getSession(oldContent, n, key);
      const newSession = getSession(newContent, n, key);
      if (JSON.stringify(oldSession) !== JSON.stringify(newSession)) {
        violations.push(`period ${n}, session ${key}: already happened and its content cannot change`);
      }
    }
  }

  return violations;
}
