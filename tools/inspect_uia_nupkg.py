"""Inspect UiPath.UIAutomation.Activities nupkg files for Object Repository descriptor versions.

Parses the .NET #US (User Strings) heap in UiPath.UIAutomationNext.Activities.Design.dll
to identify which TargetApp (screen) and TargetAnchorable (element) descriptor versions
each package generation supports. Output is grouped by unique descriptor-version set, not
per-package properties.

Usage:
    uv run python tools/inspect_uia_nupkg.py <nupkg_dir_or_file> [<nupkg_dir_or_file> ...]

Output (one JSON line per event):
    {"type": "header",         "sources": [...], "total_packages": N}
    {"type": "descriptor_set", "screen_versions": [...], "element_versions": [...],
                               "package_range": {"first": "X", "last": "Y"},
                               "package_count": N, "adapter_dispatch": {...}}
    {"type": "done",           "total_packages": N, "unique_sets": N, "elapsed_ms": X}

Observability:
    All log lines go to stderr so stdout stays clean NDJSON.
"""

import json
import re
import sys
import time
import zipfile
from pathlib import Path


def _log(msg: str) -> None:
    print(f"[inspect_uia_nupkg] {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Input resolution — supports .nupkg files AND extracted package directories
# ---------------------------------------------------------------------------

def _is_extracted_pkg_dir(p: Path) -> bool:
    """True if p looks like an extracted NuGet package (has lib/ + .nuspec, no .nupkg)."""
    return (p.is_dir()
            and (p / "lib").is_dir()
            and any(p.glob("*.nuspec"))
            and not any(p.glob("*.nupkg")))


def _collect_sources(sources: list[str]) -> list[Path]:
    """Return list of Paths — each is either a .nupkg file or an extracted package dir."""
    found: list[Path] = []
    for src in sources:
        p = Path(src)
        if p.is_file() and p.suffix.lower() == ".nupkg":
            if "uiautomation.activities" in p.name.lower():
                found.append(p)
        elif _is_extracted_pkg_dir(p):
            # single extracted package dir passed directly
            found.append(p)
        elif p.is_dir():
            # recurse: find .nupkg files
            for nupkg in sorted(p.rglob("*.nupkg")):
                if "uiautomation.activities" in nupkg.name.lower():
                    found.append(nupkg)
            # recurse: find extracted package dirs (version subdirs with lib/ + nuspec)
            for child in sorted(p.rglob("lib")):
                parent = child.parent
                if _is_extracted_pkg_dir(parent):
                    nuspec_names = [f.name.lower() for f in parent.glob("*.nuspec")]
                    if any("uiautomation.activities" in n for n in nuspec_names):
                        found.append(parent)
        else:
            _log(f"WARNING: source not found or unrecognised: {src}")
    # deduplicate preserving order
    seen: set[Path] = set()
    result: list[Path] = []
    for p in found:
        rp = p.resolve()
        if rp not in seen:
            seen.add(rp)
            result.append(p)
    return result


# ---------------------------------------------------------------------------
# nuspec version extraction
# ---------------------------------------------------------------------------

def _extract_package_version(nuspec_bytes: bytes) -> str:
    text = nuspec_bytes.decode("utf-8", errors="replace")
    m = re.search(r"<version>([^<]+)</version>", text, re.IGNORECASE)
    return m.group(1).strip() if m else "unknown"


# ---------------------------------------------------------------------------
# DLL entry selection
# ---------------------------------------------------------------------------

_DLL_NAME = "UiPath.UIAutomationNext.Activities.Design.dll"
_DLL_PRIORITY = [
    f"lib/net6.0-windows7.0/{_DLL_NAME}",
    f"lib/net6.0-windows/{_DLL_NAME}",
    f"lib/net461/{_DLL_NAME}",
]


def _pick_dll_entry(namelist: list[str]) -> str | None:
    lower = {e.lower(): e for e in namelist}
    for candidate in _DLL_PRIORITY:
        actual = lower.get(candidate.lower())
        if actual:
            return actual
    # fallback: any matching name
    for e in namelist:
        if e.lower().endswith(_DLL_NAME.lower()):
            return e
    return None


# ---------------------------------------------------------------------------
# .NET #US heap parser
# ---------------------------------------------------------------------------

def _parse_us_heap(data: bytes) -> list[str]:
    """Extract all UTF-16LE user string literals from a .NET PE's #US stream."""
    # Locate BSJB metadata root magic
    bsjb = b"BSJB"
    idx = data.find(bsjb)
    if idx == -1:
        return []

    strings: list[str] = []
    try:
        # Version string length at offset +12 (uint32 LE), padded to 4 bytes
        v_len = int.from_bytes(data[idx + 12: idx + 16], "little")
        v_len = (v_len + 3) & ~3

        # Stream count at offset +16+v_len+2 (uint16 LE)
        sc_off = idx + 16 + v_len + 2
        num_streams = int.from_bytes(data[sc_off: sc_off + 2], "little")
        sc_off += 2

        for _ in range(num_streams):
            s_offset = int.from_bytes(data[sc_off: sc_off + 4], "little")
            s_size   = int.from_bytes(data[sc_off + 4: sc_off + 8], "little")
            # stream name: null-terminated ASCII, padded to 4 bytes
            name_start = sc_off + 8
            name_end = name_start
            while name_end < len(data) and data[name_end] != 0:
                name_end += 1
            stream_name = data[name_start:name_end].decode("ascii", errors="replace")
            name_raw_len = name_end - name_start + 1
            name_padded = (name_raw_len + 3) & ~3
            sc_off += 8 + name_padded

            if stream_name != "#US":
                continue

            # Found #US stream
            heap_start = idx + s_offset
            heap_end = heap_start + s_size
            cur = heap_start + 1  # skip leading null byte

            while cur < heap_end:
                b0 = data[cur]
                if b0 == 0:
                    cur += 1
                    continue
                # compressed length (ECMA-335 II.24.2.4)
                if (b0 & 0x80) == 0:
                    length = b0
                    cur += 1
                elif (b0 & 0xC0) == 0x80:
                    if cur + 1 >= heap_end:
                        break
                    length = ((b0 & 0x3F) << 8) | data[cur + 1]
                    cur += 2
                else:
                    if cur + 3 >= heap_end:
                        break
                    length = ((b0 & 0x1F) << 24) | (data[cur + 1] << 16) | (data[cur + 2] << 8) | data[cur + 3]
                    cur += 4

                if length <= 0 or length > 4000 or cur + length > heap_end:
                    cur += max(1, length)
                    continue

                # UTF-16LE, terminal byte excluded
                char_count = (length - 1) // 2
                if char_count > 0:
                    raw = data[cur: cur + char_count * 2]
                    try:
                        s = raw.decode("utf-16-le")
                        if s.strip():
                            strings.append(s)
                    except UnicodeDecodeError:
                        pass
                cur += length

            break  # only one #US stream

    except (IndexError, ValueError):
        pass

    return strings


# ---------------------------------------------------------------------------
# Fingerprint classification
# ---------------------------------------------------------------------------

def _classify_fingerprint(us_strings: list[str]) -> dict:
    """Derive descriptor version sets from authoritative #US signals."""
    is_v4_check = any("IsV4 = " in s for s in us_strings)
    is_v6_check = any("IsV6 = " in s for s in us_strings)

    # Screen (TargetApp): V2 co-debuts with the V6 element check in 24.10.7
    screen_versions = ["V1", "V2"] if is_v6_check else ["V1"]

    # Element (TargetAnchorable)
    if is_v4_check and is_v6_check:
        element_versions = ["V4", "V6"]
    elif is_v4_check:
        element_versions = ["V4"]
    else:
        element_versions = []

    return {
        "screen_versions": screen_versions,
        "element_versions": element_versions,
        "is_v4_check": is_v4_check,
        "is_v6_check": is_v6_check,
    }


def _adapter_dispatch(screen_versions: list[str], element_versions: list[str]) -> dict:
    screen_parts = []
    for v in screen_versions:
        if v == "V2":
            screen_parts.append("V2 → mutations (adapter_screen_V2)")
        else:
            screen_parts.append(f"{v} → read-only (adapter_screen_V2 requires V2)")

    element_parts = []
    for v in element_versions:
        if v == "V6":
            element_parts.append("V6 → mutations (adapter_element_V6)")
        else:
            element_parts.append(f"{v} → read-only (adapter_element_V6 requires V6)")

    return {
        "screen": "; ".join(screen_parts) if screen_parts else "unknown",
        "element": "; ".join(element_parts) if element_parts else "unknown",
    }


# ---------------------------------------------------------------------------
# Version sorting key (handles semver + preview suffix)
# ---------------------------------------------------------------------------

def _version_sort_key(ver: str) -> tuple:
    parts = re.split(r"[.\-]", ver)
    result = []
    for p in parts:
        try:
            result.append((0, int(p)))
        except ValueError:
            result.append((1, p))
    return tuple(result)


# ---------------------------------------------------------------------------
# Main scan
# ---------------------------------------------------------------------------

def _read_from_nupkg(path: Path) -> tuple[str, str, bytes] | None:
    """Read (pkg_ver, dll_entry, dll_bytes) from a .nupkg zip file."""
    with zipfile.ZipFile(path, "r") as zf:
        names = zf.namelist()
        nuspec_entries = [e for e in names if e.endswith(".nuspec")]
        pkg_ver = _extract_package_version(zf.read(nuspec_entries[0])) if nuspec_entries else "unknown"
        dll_entry = _pick_dll_entry(names)
        if not dll_entry:
            return None
        return pkg_ver, dll_entry, zf.read(dll_entry)


def _read_from_extracted(path: Path) -> tuple[str, str, bytes] | None:
    """Read (pkg_ver, dll_entry, dll_bytes) from an extracted package directory."""
    nuspec_files = list(path.glob("*.nuspec"))
    pkg_ver = _extract_package_version(nuspec_files[0].read_bytes()) if nuspec_files else "unknown"
    # find DLL in priority order
    for candidate in _DLL_PRIORITY:
        dll_path = path / candidate.replace("/", "\\")
        if not dll_path.exists():
            dll_path = path / candidate  # forward slash
        if dll_path.exists():
            return pkg_ver, candidate, dll_path.read_bytes()
    # fallback: any matching name in lib/
    for dll_path in (path / "lib").rglob(_DLL_NAME):
        rel = str(dll_path.relative_to(path)).replace("\\", "/")
        return pkg_ver, rel, dll_path.read_bytes()
    return None


def scan(sources: list[str]) -> None:
    t0 = time.monotonic()

    pkg_sources = _collect_sources(sources)
    _log(f"found {len(pkg_sources)} matching package(s)")

    print(json.dumps({
        "type": "header",
        "sources": sources,
        "total_packages": len(pkg_sources),
    }), flush=True)

    # per-package fingerprints: version_str → fingerprint dict
    per_package: dict[str, dict] = {}

    for src_path in pkg_sources:
        label = src_path.name
        _log(f"scanning {label}")
        try:
            if src_path.is_file():
                result = _read_from_nupkg(src_path)
            else:
                result = _read_from_extracted(src_path)

            if result is None:
                _log(f"  WARNING: {_DLL_NAME} not found in {label}")
                continue

            pkg_ver, dll_entry, dll_bytes = result
            us_strings = _parse_us_heap(dll_bytes)
            fp = _classify_fingerprint(us_strings)
            fp["dll_entry"] = dll_entry
            per_package[pkg_ver] = fp
            _log(f"  {pkg_ver}: screen={fp['screen_versions']} element={fp['element_versions']}")

        except Exception as exc:
            _log(f"  ERROR processing {label}: {exc}")

    # Group by (screen_versions, element_versions) → descriptor sets
    groups: dict[tuple, dict] = {}
    for pkg_ver, fp in per_package.items():
        key = (tuple(fp["screen_versions"]), tuple(fp["element_versions"]))
        if key not in groups:
            groups[key] = {
                "screen_versions": fp["screen_versions"],
                "element_versions": fp["element_versions"],
                "packages": [],
            }
        groups[key]["packages"].append(pkg_ver)

    # Emit descriptor_set rows, sorted by first package version
    for key, g in sorted(groups.items(),
                         key=lambda kv: _version_sort_key(
                             sorted(kv[1]["packages"], key=_version_sort_key)[0])):
        sorted_pkgs = sorted(g["packages"], key=_version_sort_key)
        print(json.dumps({
            "type": "descriptor_set",
            "screen_versions": g["screen_versions"],
            "element_versions": g["element_versions"],
            "package_range": {"first": sorted_pkgs[0], "last": sorted_pkgs[-1]},
            "package_count": len(sorted_pkgs),
            "adapter_dispatch": _adapter_dispatch(g["screen_versions"], g["element_versions"]),
        }), flush=True)

    elapsed_ms = round((time.monotonic() - t0) * 1000)
    print(json.dumps({
        "type": "done",
        "total_packages": len(per_package),
        "unique_sets": len(groups),
        "elapsed_ms": elapsed_ms,
    }), flush=True)
    _log(f"done: {len(per_package)} packages, {len(groups)} unique descriptor sets, {elapsed_ms}ms")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: inspect_uia_nupkg.py <nupkg_dir_or_file> [...]", file=sys.stderr)
        sys.exit(1)
    scan(sys.argv[1:])
