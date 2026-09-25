#!/usr/bin/env python3
"""Validate a program.json against program.schema.json plus the cross-reference
integrity rules a JSON Schema can't express on its own (every v/circuit/t/lift/
activationGroup/warmupTemplate reference actually resolves, period numbers have
no gaps, a periodRange session's rx only covers periods in its own range, a
percentage target has a matching test definition).

Usage:
    python3 validate_program.py program.json [program.schema.json]

Uses the `jsonschema` package for schema validation if it's installed;
otherwise falls back to a smaller built-in structural check and still runs
every cross-reference check below, which is the harder-to-get-wrong half of
"is this program file actually loadable."

No dependencies required to run -- stdlib only, `jsonschema` is optional.
"""
import json
import sys


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def schema_check(program, schema_path):
    """Returns a list of error strings. Uses jsonschema if available."""
    try:
        import jsonschema
    except ImportError:
        return minimal_structural_check(program)

    try:
        schema = load(schema_path)
    except FileNotFoundError:
        print(f"warning: schema file not found at {schema_path}, skipping schema validation", file=sys.stderr)
        return []

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    errors = sorted(validator.iter_errors(program), key=lambda e: list(e.path))
    return [f"{'/'.join(str(p) for p in e.path) or '(root)'}: {e.message}" for e in errors]


def minimal_structural_check(program):
    """A dependency-free fallback covering the required top-level shape.
    Not a substitute for the full schema -- install `jsonschema` (pip install
    jsonschema) for complete validation. This just catches the basics."""
    errors = []
    required = ["startDate", "units", "periods", "testDefinitions", "videos", "circuits", "activation", "warmupTemplates", "sessionTemplates"]
    for key in required:
        if key not in program:
            errors.append(f"(root): missing required field '{key}'")
    if program.get("units") not in (None, "lb", "kg"):
        errors.append(f"units: must be 'lb' or 'kg', got {program.get('units')!r}")
    if not isinstance(program.get("periods"), list) or not program.get("periods"):
        errors.append("periods: must be a non-empty array")
    if not isinstance(program.get("sessionTemplates"), list) or not program.get("sessionTemplates"):
        errors.append("sessionTemplates: must be a non-empty array")
    print("note: `jsonschema` package not installed -- running a minimal structural check only.", file=sys.stderr)
    print("      pip install jsonschema for complete schema validation.", file=sys.stderr)
    return errors


def reference_checks(program):
    """Cross-reference integrity: every key an item points at must actually
    exist elsewhere in the document. A JSON Schema can express types and
    required fields, but not "this string must be a key in that other object" --
    so these checks matter as much as the schema does."""
    errors = []

    periods = program.get("periods", [])
    period_numbers = {p.get("n") for p in periods if isinstance(p, dict)}
    expected = set(range(1, len(periods) + 1))
    if period_numbers != expected:
        errors.append(f"periods: numbers must be 1..{len(periods)} with no gaps, got {sorted(period_numbers)}")

    test_keys = {t.get("key") for t in program.get("testDefinitions", []) if isinstance(t, dict)}
    video_keys = set(program.get("videos", {}).keys())
    circuit_keys = set(program.get("circuits", {}).keys())
    activation_keys = set(program.get("activation", {}).keys())
    warmup_keys = {w.get("key") for w in program.get("warmupTemplates", []) if isinstance(w, dict)}
    seed_max_keys = set(program.get("seedMaxes", {}).keys())

    for w in program.get("warmupTemplates", []):
        if not isinstance(w, dict):
            continue
        group = w.get("activationGroup")
        if group is not None and group not in activation_keys:
            errors.append(f"warmupTemplates[{w.get('key')}]: activationGroup '{group}' not found in activation")

    for k in seed_max_keys:
        if k not in test_keys:
            errors.append(f"seedMaxes: key '{k}' has no matching testDefinitions entry")

    for si, session in enumerate(program.get("sessionTemplates", [])):
        if not isinstance(session, dict):
            continue
        label = session.get("key", f"#{si}")
        wt = session.get("warmupTemplate")
        if wt is not None and wt not in warmup_keys:
            errors.append(f"sessionTemplates[{label}]: warmupTemplate '{wt}' not found in warmupTemplates")

        scope = session.get("scope", {})
        scope_periods = None
        if scope.get("type") == "period":
            scope_periods = {scope.get("n")}
        elif scope.get("type") == "periodRange":
            scope_periods = set(scope.get("periods", []))

        for ii, item in enumerate(session.get("items", [])):
            if not isinstance(item, dict):
                continue
            name = item.get("name", f"item#{ii}")
            opts = item.get("options", {}) or {}

            if "v" in opts and opts["v"] not in video_keys:
                errors.append(f"sessionTemplates[{label}].{name}: v '{opts['v']}' not found in videos")
            if "circuit" in opts and opts["circuit"] not in circuit_keys:
                errors.append(f"sessionTemplates[{label}].{name}: circuit '{opts['circuit']}' not found in circuits")
            if "t" in opts and opts["t"] not in test_keys:
                errors.append(f"sessionTemplates[{label}].{name}: t '{opts['t']}' not found in testDefinitions")
            if "lift" in opts and opts["lift"] not in test_keys:
                errors.append(f"sessionTemplates[{label}].{name}: lift '{opts['lift']}' not found in testDefinitions")
            if "pct" in opts and "lift" not in opts:
                errors.append(f"sessionTemplates[{label}].{name}: pct set without a lift")
            if "lift" in opts and opts["lift"] not in seed_max_keys and "pct" in opts:
                # Not fatal -- a planned test can supply the max later -- but
                # worth flagging since %-targets show nothing until then.
                errors.append(
                    f"sessionTemplates[{label}].{name}: lift '{opts['lift']}' has no seedMaxes entry and no way to "
                    f"know if a test is planned -- target will show as \"appears after your test\" until logged"
                )

            rx = item.get("rx")
            if isinstance(rx, dict) and scope_periods is not None:
                rx_periods = {int(k) for k in rx.keys()}
                extra = rx_periods - scope_periods
                if extra:
                    errors.append(f"sessionTemplates[{label}].{name}: rx has periods {sorted(extra)} outside this session's scope {sorted(scope_periods)}")

        # A `group` value is only meaningful across items adjacent to each
        # other in the array -- the app renders/logs a run of consecutive
        # same-group items as one superset block. The same group value
        # reappearing later, non-adjacently, silently becomes a second,
        # separate block instead of joining the first -- almost always an
        # authoring mistake worth flagging.
        items = session.get("items", [])
        seen_groups = {}
        prev_group = None
        for ii, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            g = (item.get("options") or {}).get("group")
            if g is None:
                prev_group = None
                continue
            if g in seen_groups and prev_group != g:
                errors.append(
                    f"sessionTemplates[{label}]: group '{g}' appears at non-adjacent items "
                    f"(position {seen_groups[g]} and {ii}) -- these render as two separate superset "
                    f"blocks, not one. Move them next to each other in `items`."
                )
            seen_groups[g] = ii
            prev_group = g

    return errors


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    program_path = sys.argv[1]
    schema_path = sys.argv[2] if len(sys.argv) > 2 else "program.schema.json"

    try:
        program = load(program_path)
    except json.JSONDecodeError as e:
        print(f"✘ {program_path} is not valid JSON: {e}")
        sys.exit(1)
    except FileNotFoundError:
        print(f"✘ file not found: {program_path}")
        sys.exit(1)

    errors = schema_check(program, schema_path) + reference_checks(program)

    if errors:
        print(f"✘ {len(errors)} problem(s) found in {program_path}:\n")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    print(f"✔ {program_path} looks valid.")


if __name__ == "__main__":
    main()
