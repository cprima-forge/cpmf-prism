"""Stream UiPath Object Repository inventory as NDJSON to stdout.

Usage:
    uv run --with cpmf-uips-or python tools/stream_inventory.py <project_root>

Output (one JSON line per event):
    {"type": "header",  "project": "...", "schema_version": "v0.1.2"}
    {"type": "screen",  "reference": "...", ...all ScreenEntry fields...}
    {"type": "element", "reference": "...", ...all ElementEntry fields...}
    {"type": "done",    "total": N, "elapsed_ms": X}

Observability:
    All log lines go to stderr so stdout stays clean NDJSON.
"""

import json
import sys
import time
from dataclasses import asdict
from pathlib import Path


def _log(msg: str) -> None:
    print(f"[stream_inventory] {msg}", file=sys.stderr, flush=True)


def _entry_to_dict(entry) -> dict:
    """Convert ScreenEntry or ElementEntry dataclass to JSON-serialisable dict."""
    from enum import Enum
    from pathlib import Path as _Path

    def _coerce(obj):
        if isinstance(obj, Enum):
            return obj.value
        if isinstance(obj, _Path):
            return str(obj)
        if isinstance(obj, dict):
            return {k: _coerce(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_coerce(i) for i in obj]
        return obj

    d = _coerce(asdict(entry))
    # entry_type -> type
    d["type"] = d.pop("entry_type", entry.entry_type.value)
    d.pop("content_path", None)
    # url_status -> status (ScreenEntry)
    if "url_status" in d:
        d.setdefault("status", d.pop("url_status"))
    return d


def stream(project_root: Path) -> None:
    t0 = time.monotonic()

    try:
        from cpmf_uips_or.discovery import discover_all
        from cpmf_uips_or.parser import parse_metadata
    except ImportError as exc:
        _log(f"ERROR import cpmf_uips_or: {exc}")
        print(json.dumps({"type": "error", "message": str(exc)}), flush=True)
        sys.exit(1)

    objects_dir = project_root / ".objects"
    if not objects_dir.exists():
        _log(f"ERROR .objects not found at {objects_dir}")
        print(json.dumps({"type": "error", "message": f".objects not found: {objects_dir}"}), flush=True)
        sys.exit(1)

    # Project name from project.json if present
    project_json = project_root / "project.json"
    project_name = project_root.name
    if project_json.exists():
        try:
            data = json.loads(project_json.read_text(encoding="utf-8"))
            project_name = data.get("name", project_name)
        except Exception:
            pass

    _log(f"project={project_name} root={project_root}")
    print(json.dumps({
        "type": "header",
        "project": project_name,
        "schema_version": "v0.1.2",
        "objects_dir": str(objects_dir),
    }), flush=True)

    screens, elements = discover_all(objects_dir)
    total = len(screens) + len(elements)
    _log(f"discovered: {len(screens)} screens, {len(elements)} elements")

    count = 0
    for entry in screens:
        d = _entry_to_dict(entry)
        print(json.dumps(d), flush=True)
        count += 1
        _log(f"screen ref={entry.reference[:24]} name={entry.screen_name} ({count}/{total})")

    for entry in elements:
        d = _entry_to_dict(entry)
        print(json.dumps(d), flush=True)
        count += 1
        _log(f"element ref={entry.reference[:24]} name={entry.element_name} ({count}/{total})")

    elapsed_ms = round((time.monotonic() - t0) * 1000)
    _log(f"done: {count} entries in {elapsed_ms}ms")
    print(json.dumps({"type": "done", "total": count, "elapsed_ms": elapsed_ms}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: stream_inventory.py <project_root>", file=sys.stderr)
        sys.exit(1)
    stream(Path(sys.argv[1]))
