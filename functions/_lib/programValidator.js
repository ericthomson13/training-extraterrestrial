// Validates and sanitizes a program document before it's ever stored or
// re-served (see PLANNING.md "Security: JSON, not JS -- and ingestion
// sanitization"). This is the actual gatekeeper: everything reaching D1 via
// POST /api/programs* passes through here first. Deliberately dependency-free
// (no JSON-Schema library) so it runs identically to program.schema.json's
// intent without needing a bundler step -- kept in sync with
// validate_program.py's reference-integrity checks by hand; if you change one,
// change the other.
//
// Fails closed: any problem is collected and the whole document is rejected
// with the full list of specific errors -- never silently stripped/repaired.

const MAX_CONTENT_BYTES = 200_000;
// Control characters except \t (\x09) and \n (\x0A), which are allowed only
// in fields explicitly marked multiline below.
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const KIND_VALUES = new Set(["load-reps-e1rm", "max-load", "max-value"]);
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

// testDefinitions/warmupTemplates/sessionTemplates keys end up as DOM element
// ids and data-attribute values at render time (see app.js's `s.id`,
// `data-key`, `id="t-${k}..."` etc.) -- HTML-escaping doesn't help there, an
// escaped id just fails to match the id it names. So these are restricted to
// a safe identifier charset rather than the general string sanitization
// `checkString` applies elsewhere. Matches program.schema.json's existing
// testDefinitions.key pattern, extended to the other two identifier fields.
function checkKey(errors, path, value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 50 || !KEY_RE.test(value)) {
    errors.push(`${path}: must be a short identifier -- letters, numbers, underscore, starting with a letter (max 50 chars)`);
  }
}

// Scheme allowlist is a *different* protection than HTML-escaping: an
// `<a href="javascript:...">` needs no HTML metacharacters to execute, so
// escaping the string doesn't stop it -- the scheme itself must be checked.
function isSafeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (e) {
    return false;
  }
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function checkString(errors, path, value, maxLength, multiline) {
  if (typeof value !== "string") {
    errors.push(`${path}: must be a string`);
    return;
  }
  if (value.length === 0) errors.push(`${path}: must not be empty`);
  if (value.length > maxLength) errors.push(`${path}: exceeds max length of ${maxLength}`);
  if (CONTROL_CHAR_RE.test(value)) errors.push(`${path}: contains disallowed control characters`);
  if (!multiline && /[\r\n]/.test(value)) errors.push(`${path}: must not contain newlines`);
}

export function validateProgram(content) {
  const errors = [];

  // Size cap first -- an abuse guard, not a real constraint (a real season's
  // content is ~16.5KB).
  let json;
  try {
    json = JSON.stringify(content);
  } catch (e) {
    return { valid: false, errors: ["content is not serializable to JSON"] };
  }
  if (json.length > MAX_CONTENT_BYTES) {
    return { valid: false, errors: [`content is too large (${json.length} bytes, max ${MAX_CONTENT_BYTES})`] };
  }

  if (typeof content !== "object" || content === null || Array.isArray(content)) {
    return { valid: false, errors: ["content must be a JSON object"] };
  }

  const required = ["startDate", "units", "periods", "testDefinitions", "videos", "circuits", "activation", "warmupTemplates", "sessionTemplates"];
  for (const key of required) if (!(key in content)) errors.push(`(root): missing required field '${key}'`);
  if (content.units !== undefined && content.units !== "lb" && content.units !== "kg") errors.push("units: must be 'lb' or 'kg'");
  if (content.startDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(content.startDate)) errors.push("startDate: must be an ISO date (YYYY-MM-DD)");
  if (content.displayName !== undefined) checkString(errors, "displayName", content.displayName, 200, false);
  if (!Array.isArray(content.periods) || content.periods.length === 0) errors.push("periods: must be a non-empty array");
  if (!Array.isArray(content.testDefinitions)) errors.push("testDefinitions: must be an array");
  if (typeof content.videos !== "object" || content.videos === null || Array.isArray(content.videos)) errors.push("videos: must be an object");
  if (typeof content.circuits !== "object" || content.circuits === null || Array.isArray(content.circuits)) errors.push("circuits: must be an object");
  if (typeof content.activation !== "object" || content.activation === null || Array.isArray(content.activation)) errors.push("activation: must be an object");
  if (!Array.isArray(content.warmupTemplates)) errors.push("warmupTemplates: must be an array");
  if (!Array.isArray(content.sessionTemplates) || content.sessionTemplates.length === 0) errors.push("sessionTemplates: must be a non-empty array");

  // Bail before deeper checks that assume these exist and have the right shape.
  if (errors.length) return { valid: false, errors };

  // periods
  const periodNumbers = new Set();
  content.periods.forEach((p, i) => {
    if (typeof p !== "object" || p === null) { errors.push(`periods[${i}]: must be an object`); return; }
    if (Number.isInteger(p.n) && p.n >= 1) periodNumbers.add(p.n);
    else errors.push(`periods[${i}]: n must be a positive integer`);
    checkString(errors, `periods[${i}].phase`, p.phase, 200, true);
    if (!Number.isInteger(p.lengthDays) || p.lengthDays < 1) errors.push(`periods[${i}]: lengthDays must be a positive integer`);
    if (p.deload !== undefined && typeof p.deload !== "boolean") errors.push(`periods[${i}]: deload must be a boolean`);
  });
  const expectedPeriods = new Set(Array.from({ length: content.periods.length }, (_, i) => i + 1));
  if (!setsEqual(periodNumbers, expectedPeriods)) {
    errors.push(`periods: numbers must be 1..${content.periods.length} with no gaps, got [${Array.from(periodNumbers).sort((a, b) => a - b)}]`);
  }

  if (content.ongoingPeriod !== undefined) {
    if (typeof content.ongoingPeriod !== "object" || content.ongoingPeriod === null) {
      errors.push("ongoingPeriod: must be an object");
    } else {
      checkString(errors, "ongoingPeriod.phase", content.ongoingPeriod.phase, 200, true);
      if (typeof content.ongoingPeriod.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(content.ongoingPeriod.startDate)) {
        errors.push("ongoingPeriod.startDate: must be an ISO date");
      }
    }
  }

  // testDefinitions
  const testKeys = new Set();
  content.testDefinitions.forEach((t, i) => {
    if (typeof t !== "object" || t === null) { errors.push(`testDefinitions[${i}]: must be an object`); return; }
    checkKey(errors, `testDefinitions[${i}].key`, t.key);
    if (typeof t.key === "string" && KEY_RE.test(t.key)) testKeys.add(t.key);
    checkString(errors, `testDefinitions[${i}].label`, t.label, 200, false);
    checkString(errors, `testDefinitions[${i}].unit`, t.unit, 20, false);
    if (!KIND_VALUES.has(t.kind)) errors.push(`testDefinitions[${i}]: kind must be one of load-reps-e1rm, max-load, max-value`);
  });

  // videos -- scheme allowlist, not just string type
  const videoKeys = new Set(Object.keys(content.videos));
  for (const [key, url] of Object.entries(content.videos)) {
    checkString(errors, `videos.${key}`, url, 2000, false);
    if (typeof url === "string" && !isSafeUrl(url)) errors.push(`videos.${key}: must be an http:// or https:// URL`);
  }

  const circuitKeys = new Set(Object.keys(content.circuits));
  for (const [key, desc] of Object.entries(content.circuits)) checkString(errors, `circuits.${key}`, desc, 2000, true);

  const activationKeys = new Set(Object.keys(content.activation));
  for (const [key, desc] of Object.entries(content.activation)) checkString(errors, `activation.${key}`, desc, 2000, true);

  if (content.seedMaxes !== undefined) {
    if (typeof content.seedMaxes !== "object" || content.seedMaxes === null || Array.isArray(content.seedMaxes)) {
      errors.push("seedMaxes: must be an object");
    } else {
      for (const [key, val] of Object.entries(content.seedMaxes)) {
        if (val !== null && typeof val !== "number") errors.push(`seedMaxes.${key}: must be a number or null (no seed yet)`);
        if (!testKeys.has(key)) errors.push(`seedMaxes: key '${key}' has no matching testDefinitions entry`);
      }
    }
  }

  // warmupTemplates
  const warmupKeys = new Set();
  content.warmupTemplates.forEach((w, i) => {
    if (typeof w !== "object" || w === null) { errors.push(`warmupTemplates[${i}]: must be an object`); return; }
    checkKey(errors, `warmupTemplates[${i}].key`, w.key);
    if (typeof w.key === "string" && KEY_RE.test(w.key)) warmupKeys.add(w.key);
    checkString(errors, `warmupTemplates[${i}].ergName`, w.ergName, 100, false);
    if (!Array.isArray(w.erg)) {
      errors.push(`warmupTemplates[${i}]: erg must be an array`);
    } else {
      w.erg.forEach((row, ri) => {
        if (!Array.isArray(row) || row.length !== 3) errors.push(`warmupTemplates[${i}].erg[${ri}]: must be a 3-element array`);
        else row.forEach((cell, ci) => checkString(errors, `warmupTemplates[${i}].erg[${ri}][${ci}]`, cell, 200, false));
      });
    }
    checkString(errors, `warmupTemplates[${i}].mobility`, w.mobility, 1000, true);
    if (w.activationGroup !== undefined && !activationKeys.has(w.activationGroup)) {
      errors.push(`warmupTemplates[${i}]: activationGroup '${w.activationGroup}' not found in activation`);
    }
  });

  // sessionTemplates -- the largest surface
  content.sessionTemplates.forEach((session, si) => {
    if (typeof session !== "object" || session === null) { errors.push(`sessionTemplates[${si}]: must be an object`); return; }
    const label = typeof session.key === "string" && KEY_RE.test(session.key) ? session.key : `#${si}`;
    checkKey(errors, `sessionTemplates[${label}].key`, session.key);
    checkString(errors, `sessionTemplates[${label}].title`, session.title, 200, false);
    if (session.shortLabel !== undefined) checkString(errors, `sessionTemplates[${label}].shortLabel`, session.shortLabel, 50, false);

    const scope = session.scope;
    let scopePeriods = null;
    if (!scope || typeof scope !== "object") {
      errors.push(`sessionTemplates[${label}]: scope is required`);
    } else if (scope.type === "period") {
      if (!Number.isInteger(scope.n)) errors.push(`sessionTemplates[${label}].scope: n must be an integer`);
      scopePeriods = new Set([scope.n]);
    } else if (scope.type === "periodRange") {
      if (!Array.isArray(scope.periods) || !scope.periods.length) errors.push(`sessionTemplates[${label}].scope: periods must be a non-empty array`);
      else scopePeriods = new Set(scope.periods);
    } else if (scope.type !== "ongoing") {
      errors.push(`sessionTemplates[${label}].scope: type must be 'period', 'periodRange', or 'ongoing'`);
    }

    if (session.warmupTemplate != null && !warmupKeys.has(session.warmupTemplate)) {
      errors.push(`sessionTemplates[${label}]: warmupTemplate '${session.warmupTemplate}' not found in warmupTemplates`);
    }
    if (session.noWarmupSpikes !== undefined && typeof session.noWarmupSpikes !== "boolean") {
      errors.push(`sessionTemplates[${label}]: noWarmupSpikes must be a boolean`);
    }
    if (session.testDayNote != null) checkString(errors, `sessionTemplates[${label}].testDayNote`, session.testDayNote, 500, true);
    if (session.isTest !== undefined && typeof session.isTest !== "boolean") errors.push(`sessionTemplates[${label}]: isTest must be a boolean`);

    if (!Array.isArray(session.items) || !session.items.length) {
      errors.push(`sessionTemplates[${label}]: items must be a non-empty array`);
      return;
    }

    let prevGroup = null;
    const seenGroups = new Map();
    session.items.forEach((item, ii) => {
      if (typeof item !== "object" || item === null) { errors.push(`sessionTemplates[${label}].items[${ii}]: must be an object`); return; }
      const name = typeof item.name === "string" && item.name ? item.name : `items[${ii}]`;
      checkString(errors, `sessionTemplates[${label}].${name}.name`, item.name, 200, false);

      const rx = item.rx;
      let rxPeriods = null;
      if (typeof rx === "string") {
        checkString(errors, `sessionTemplates[${label}].${name}.rx`, rx, 200, false);
      } else if (rx && typeof rx === "object" && !Array.isArray(rx)) {
        rxPeriods = new Set();
        for (const [pk, pv] of Object.entries(rx)) {
          if (!/^[0-9]+$/.test(pk)) errors.push(`sessionTemplates[${label}].${name}.rx: key '${pk}' must be a period number`);
          else rxPeriods.add(Number(pk));
          checkString(errors, `sessionTemplates[${label}].${name}.rx.${pk}`, pv, 200, false);
        }
      } else {
        errors.push(`sessionTemplates[${label}].${name}: rx must be a string or an object keyed by period number`);
      }
      if (rxPeriods && scopePeriods) {
        const extra = Array.from(rxPeriods).filter((p) => !scopePeriods.has(p));
        if (extra.length) errors.push(`sessionTemplates[${label}].${name}: rx has periods [${extra}] outside this session's scope`);
      }

      const opts = item.options;
      if (opts === undefined) {
        // options is optional -- nothing to check
      } else if (typeof opts !== "object" || opts === null || Array.isArray(opts)) {
        errors.push(`sessionTemplates[${label}].${name}: options must be an object`);
      } else {
        if (opts.bw !== undefined && opts.bw !== 1) errors.push(`sessionTemplates[${label}].${name}: bw must be 1 if set`);
        if (opts.u !== undefined) checkString(errors, `sessionTemplates[${label}].${name}.u`, opts.u, 20, false);
        if (opts.norpe !== undefined && opts.norpe !== 1) errors.push(`sessionTemplates[${label}].${name}: norpe must be 1 if set`);
        if (opts.lift !== undefined) {
          checkString(errors, `sessionTemplates[${label}].${name}.lift`, opts.lift, 100, false);
          if (typeof opts.lift === "string" && !testKeys.has(opts.lift)) errors.push(`sessionTemplates[${label}].${name}: lift '${opts.lift}' not found in testDefinitions`);
        }
        if (opts.pct !== undefined) {
          if (typeof opts.pct !== "number" || opts.pct <= 0 || opts.pct > 3) errors.push(`sessionTemplates[${label}].${name}: pct must be a number between 0 and 3`);
          if (!opts.lift) errors.push(`sessionTemplates[${label}].${name}: pct set without a lift`);
        }
        if (opts.t !== undefined) {
          checkString(errors, `sessionTemplates[${label}].${name}.t`, opts.t, 100, false);
          if (typeof opts.t === "string" && !testKeys.has(opts.t)) errors.push(`sessionTemplates[${label}].${name}: t '${opts.t}' not found in testDefinitions`);
        }
        if (opts.v !== undefined) {
          checkString(errors, `sessionTemplates[${label}].${name}.v`, opts.v, 100, false);
          if (typeof opts.v === "string" && !videoKeys.has(opts.v)) errors.push(`sessionTemplates[${label}].${name}: v '${opts.v}' not found in videos`);
        }
        if (opts.n !== undefined) checkString(errors, `sessionTemplates[${label}].${name}.n`, opts.n, 1000, true);
        if (opts.circuit !== undefined) {
          checkString(errors, `sessionTemplates[${label}].${name}.circuit`, opts.circuit, 100, false);
          if (typeof opts.circuit === "string" && !circuitKeys.has(opts.circuit)) errors.push(`sessionTemplates[${label}].${name}: circuit '${opts.circuit}' not found in circuits`);
        }
        if (opts.desc !== undefined) checkString(errors, `sessionTemplates[${label}].${name}.desc`, opts.desc, 1000, true);
        if (opts.group !== undefined) checkString(errors, `sessionTemplates[${label}].${name}.group`, opts.group, 50, false);
      }

      // Group-adjacency tracking runs unconditionally per item, independent
      // of whether `options` exists or validated cleanly above -- an item
      // with no options at all (or a group-less options bag) must still
      // reset prevGroup, or a later duplicate group value spanning across it
      // would be wrongly treated as still-adjacent.
      const g = opts && typeof opts === "object" && !Array.isArray(opts) ? opts.group : undefined;
      if (typeof g === "string" && g) {
        if (seenGroups.has(g) && prevGroup !== g) {
          errors.push(`sessionTemplates[${label}]: group '${g}' appears at non-adjacent items (position ${seenGroups.get(g)} and ${ii}) -- move them next to each other in items`);
        }
        seenGroups.set(g, ii);
        prevGroup = g;
      } else {
        prevGroup = null;
      }
    });
  });

  return { valid: errors.length === 0, errors };
}
