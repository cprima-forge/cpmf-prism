# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Read data/keygen.yaml + data/extensions/*.yaml and emit a Markdown entitlement table."""

import sys
import io
from pathlib import Path

import yaml

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).parent.parent
KEYGEN_FILE = ROOT / "data" / "providers" / "keygen.yaml"
EXTENSIONS_DIR = ROOT / "data" / "extensions"

SKIP_STATUSES = {"legacy"}
SKIP_POLICY_NAMES = {"airgapped", "multi-user", "pre-v0.5"}

CHECK = "✓"
CROSS = "—"


def load_keygen() -> dict:
    return yaml.safe_load(KEYGEN_FILE.read_text(encoding="utf-8"))


def load_extensions() -> dict[str, str]:
    """Returns {code: description} for all active entitlements, canonical extensions first."""
    result = {}
    files = sorted(EXTENSIONS_DIR.glob("*.yaml"))
    # canonical (non-planned) first, planned last
    files = [f for f in files if yaml.safe_load(f.read_text(encoding="utf-8")).get("_status") not in {"planned"}] + \
            [f for f in files if yaml.safe_load(f.read_text(encoding="utf-8")).get("_status") in {"planned"}]
    for f in files:
        ext = yaml.safe_load(f.read_text(encoding="utf-8"))
        for e in ext.get("entitlements", []):
            result[e["code"]] = e.get("description", e["code"])
    return result


def active_policies(keygen: dict) -> list[dict]:
    return [
        p for p in keygen.get("policies", [])
        if p.get("_status") not in SKIP_STATUSES
        and p.get("name") not in SKIP_POLICY_NAMES
    ]


def fmt_duration(seconds) -> str:
    if not seconds:
        return "—"
    days = seconds // 86400
    if days >= 365:
        return f"{days // 365} yr"
    return f"{days} days"


def fmt_machines(p: dict) -> str:
    m = p.get("maxMachines", "?")
    floating = p.get("floating", False)
    return f"{m} {'(float)' if floating else ''}"


def main() -> None:
    keygen = load_keygen()
    entitlement_defs = load_extensions()
    policies = active_policies(keygen)

    if not policies:
        print("No active policies found.", file=sys.stderr)
        sys.exit(1)

    policy_names = [p["name"] for p in policies]

    # ── header ────────────────────────────────────────────────────────────────
    col_w = 14
    sep = " | "

    def row(*cells) -> str:
        return "| " + " | ".join(str(c).ljust(col_w) for c in cells) + " |"

    def divider(n: int) -> str:
        return "| " + " | ".join("-" * col_w for _ in range(n)) + " |"

    header_cells = ["Feature"] + policy_names
    print(row(*header_cells))
    print(divider(len(header_cells)))

    # ── metadata rows ─────────────────────────────────────────────────────────
    print(row("**Duration**", *[fmt_duration(p.get("duration")) for p in policies]))
    print(row("**Machines**", *[fmt_machines(p) for p in policies]))
    print(row("**Users**", *[str(p.get("maxUsers", "1")) if p.get("maxUsers") is not None else "negotiated" for p in policies]))
    print(row("**Requires**", *[p.get("_triggers_on", "—").replace("orchestrator_license.", "") for p in policies]))
    print(row("", *["" for _ in policies]))  # spacer

    # ── entitlement rows grouped by extension prefix ───────────────────────────
    # collect all codes referenced in any active policy
    all_codes_ordered = list(entitlement_defs.keys())

    # group by prefix (e.g. uisor, semver)
    prefixes: dict[str, list[str]] = {}
    for code in all_codes_ordered:
        prefix = code.split(".")[0]
        prefixes.setdefault(prefix, []).append(code)

    for prefix, codes in prefixes.items():
        # group header
        print(row(f"**{prefix.upper()}**", *["" for _ in policies]))
        for code in codes:
            desc = entitlement_defs.get(code, code)
            cells = []
            for p in policies:
                granted = code in p.get("entitlements", [])
                cells.append(CHECK if granted else CROSS)
            print(row(f"  {desc}", *cells))

    print()
    print(f"_Generated from `data/providers/keygen.yaml` + `data/extensions/*.yaml`_")


if __name__ == "__main__":
    main()
