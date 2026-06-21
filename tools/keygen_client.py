# /// script
# requires-python = ">=3.11"
# dependencies = ["typer", "httpx", "rich", "pyyaml"]
# ///
"""Keygen.sh API client — license validation, machine activation, account provisioning."""

import json
import os
import sys
from pathlib import Path
from typing import Optional

import httpx
import typer
import yaml
from rich import print as rprint
from rich.console import Console
from rich.syntax import Syntax

ACCOUNT = os.environ.get("KEYGEN_ACCOUNT", "cprima")
PRODUCT = os.environ.get("KEYGEN_PRODUCT", "19c1f481-a383-4e9d-8714-40459788102b")
POLICY  = os.environ.get("KEYGEN_POLICY",  "27eef182-8d80-4daf-b3b2-4b58803289d4")
BASE    = f"https://api.keygen.sh/v1/accounts/{ACCOUNT}"

DATA_FILE       = Path(__file__).parent.parent / "data" / "providers" / "keygen.yaml"
EXTENSIONS_DIR  = Path(__file__).parent.parent / "data" / "extensions"

# Keys that are local-only metadata — never sent to Keygen API
_LOCAL_KEYS = {"entitlements", "_triggers_on", "_status", "_note", "_version_lt_0.5"}

HEADERS_JSON = {
    "Content-Type": "application/vnd.api+json",
    "Accept":       "application/vnd.api+json",
}

console = Console()
app = typer.Typer(help="Keygen.sh API client", no_args_is_help=True)


def _dump(data: dict, label: str = "") -> None:
    if label:
        rprint(f"[bold cyan]{label}[/bold cyan]")
    console.print(Syntax(json.dumps(data, indent=2), "json", theme="monokai"))


def _auth_license(key: str) -> dict:
    return {"Authorization": f"License {key}"}


def _auth_bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _load_cfg() -> dict:
    if not DATA_FILE.exists():
        rprint(f"[red]data/providers/keygen.yaml not found at {DATA_FILE}[/red]")
        raise typer.Exit(1)
    return yaml.safe_load(DATA_FILE.read_text())


def _load_entitlement_defs() -> list[dict]:
    """Load all entitlement definitions from data/extensions/*.yaml."""
    result = []
    for f in sorted(EXTENSIONS_DIR.glob("*.yaml")):
        ext = yaml.safe_load(f.read_text(encoding="utf-8"))
        for e in ext.get("entitlements", []):
            result.append({"code": e["code"], "name": e.get("description", e["code"])})
    return result


def _get_entitlement_id(code: str, auth: dict) -> Optional[str]:
    """Return Keygen entitlement ID for code, or None if not found."""
    r = httpx.get(f"{BASE}/entitlements", headers={**HEADERS_JSON, **auth},
                  params={"filter[code]": code})
    rows = r.json().get("data", [])
    return rows[0]["id"] if rows else None


def _get_policy_entitlement_codes(pol_id: str, auth: dict) -> set[str]:
    """Return set of entitlement codes already attached to a policy."""
    r = httpx.get(f"{BASE}/policies/{pol_id}/entitlements", headers={**HEADERS_JSON, **auth})
    rows = r.json().get("data", [])
    return {row.get("attributes", {}).get("code") for row in rows}


# ── environments ──────────────────────────────────────────────────────────────

@app.command()
def environments(
    token: str = typer.Option(..., "--token", envvar="KEYGEN_TOKEN", help="Admin Bearer token"),
):
    """List all environments for the account (top of Keygen hierarchy)."""
    auth = _auth_bearer(token)
    r = httpx.get(f"{BASE}/environments", headers={**HEADERS_JSON, **auth})
    data = r.json()
    rows = data.get("data", [])

    if not rows:
        rprint("[dim]No named environments — account uses default environment only[/dim]")
        return

    rprint(f"[bold]{len(rows)} environment(s):[/bold]")
    for e in rows:
        a = e.get("attributes", {})
        rprint(f"  id={e.get('id')}  name={a.get('name')}  code={a.get('code')}  isolationStrategy={a.get('isolationStrategy')}")


# ── create ────────────────────────────────────────────────────────────────────

@app.command()
def create(
    token: str = typer.Option(..., "--token", envvar="KEYGEN_TOKEN", help="Admin/product Bearer token"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print what would be created without doing it"),
):
    """Create product, entitlements, and policies. Idempotent — safe to re-run."""
    cfg = _load_cfg()
    product = cfg.get("product", {})
    policies = cfg.get("policies", [])
    auth = _auth_bearer(token)

    # ── 1. Product ────────────────────────────────────────────────────────────
    product_id = product.get("id") or PRODUCT
    if product.get("id"):
        rprint(f"[dim]Product already has id={product_id[:8]}*** — skipping[/dim]")
    else:
        body = {"data": {"type": "products", "attributes": {
            "name": product["name"],
            "code": product.get("code"),
            "url": product.get("url"),
            "platforms": product.get("platforms", ["windows"]),
        }}}
        if dry_run:
            rprint("[dim]DRY-RUN: POST /products[/dim]")
            _dump(body)
        else:
            r = httpx.post(f"{BASE}/products", headers={**HEADERS_JSON, **auth}, json=body)
            data = r.json()
            _dump(data, f"HTTP {r.status_code}")
            product_id = data.get("data", {}).get("id", "")
            rprint(f"[green]Created product id={product_id}[/green]")
            rprint(f"[yellow]-> add to data/providers/keygen.yaml: product.id: {product_id}[/yellow]")

    # ── 2. Entitlements (GET-before-POST, idempotent by code) ─────────────────
    rprint("\n[bold]Entitlements[/bold]")
    entitlement_defs = _load_entitlement_defs()
    code_to_id: dict[str, str] = {}

    for ent in entitlement_defs:
        code = ent["code"]
        existing_id = _get_entitlement_id(code, auth)
        if existing_id:
            rprint(f"[dim]Entitlement '{code}' exists id={existing_id[:8]}*** — skipping[/dim]")
            code_to_id[code] = existing_id
            continue

        body = {"data": {"type": "entitlements", "attributes": {
            "name": ent["name"],
            "code": code,
        }}}
        if dry_run:
            rprint(f"[dim]DRY-RUN: POST /entitlements — {code}[/dim]")
            _dump(body)
        else:
            r = httpx.post(f"{BASE}/entitlements", headers={**HEADERS_JSON, **auth}, json=body)
            data = r.json()
            new_id = data.get("data", {}).get("id", "")
            if r.status_code in (200, 201):
                rprint(f"[green]Created entitlement '{code}' id={new_id}[/green]")
                code_to_id[code] = new_id
            else:
                rprint(f"[red]Failed entitlement '{code}' HTTP {r.status_code}[/red]")
                _dump(data)

    # ── 3. Policies (skip if id present) ──────────────────────────────────────
    rprint("\n[bold]Policies[/bold]")
    skip_statuses = {"legacy", "planned"}

    for pol in policies:
        pol_name = pol.get("name", "?")
        if pol.get("_status") in skip_statuses:
            rprint(f"[dim]Policy '{pol_name}' _status={pol['_status']} — skipping[/dim]")
            continue

        pol_id = pol.get("id")
        if not pol_id:
            attrs = {k: v for k, v in pol.items()
                     if k not in _LOCAL_KEYS and not k.startswith("_") and k != "id" and v is not None}
            body = {"data": {
                "type": "policies",
                "attributes": attrs,
                "relationships": {"product": {"data": {"type": "products", "id": product_id}}},
            }}
            if dry_run:
                rprint(f"[dim]DRY-RUN: POST /policies — {pol_name}[/dim]")
                _dump(body)
            else:
                r = httpx.post(f"{BASE}/policies", headers={**HEADERS_JSON, **auth}, json=body)
                data = r.json()
                pol_id = data.get("data", {}).get("id", "")
                if r.status_code in (200, 201):
                    rprint(f"[green]Created policy '{pol_name}' id={pol_id}[/green]")
                    rprint(f"[yellow]-> add to data/providers/keygen.yaml: id: {pol_id}[/yellow]")
                else:
                    rprint(f"[red]Failed policy '{pol_name}' HTTP {r.status_code}[/red]")
                    _dump(data)
                    continue
        else:
            rprint(f"[dim]Policy '{pol_name}' already has id={pol_id[:8]}*** — checking entitlements[/dim]")

        # ── 4. Attach entitlements to policy (idempotent) ─────────────────────
        if not pol_id or dry_run:
            if dry_run:
                for code in pol.get("entitlements", []):
                    rprint(f"[dim]DRY-RUN: attach '{code}' -> policy '{pol_name}'[/dim]")
            continue

        already_attached = _get_policy_entitlement_codes(pol_id, auth)
        to_attach = [
            code for code in pol.get("entitlements", [])
            if code not in already_attached and code in code_to_id
        ]
        missing_from_keygen = [
            code for code in pol.get("entitlements", [])
            if code not in code_to_id
        ]
        if missing_from_keygen:
            rprint(f"[yellow]  Entitlements not yet in Keygen (skipped): {missing_from_keygen}[/yellow]")

        if not to_attach:
            rprint(f"[dim]  All entitlements already attached to '{pol_name}'[/dim]")
            continue

        attach_body = {"data": [
            {"type": "entitlements", "id": code_to_id[code]} for code in to_attach
        ]}
        r = httpx.post(f"{BASE}/policies/{pol_id}/relationships/entitlements",
                       headers={**HEADERS_JSON, **auth}, json=attach_body)
        if r.status_code in (200, 201, 204):
            rprint(f"[green]  Attached to '{pol_name}': {to_attach}[/green]")
        else:
            rprint(f"[red]  Failed attach to '{pol_name}' HTTP {r.status_code}[/red]")
            _dump(r.json())


# ── check ─────────────────────────────────────────────────────────────────────

@app.command()
def check(
    token: str = typer.Option(..., "--token", envvar="KEYGEN_TOKEN", help="Admin/product Bearer token"),
):
    """Check if Keygen resources match data/providers/keygen.yaml (read-only, no changes made)."""
    cfg = _load_cfg()
    product = cfg.get("product", {})
    policies = cfg.get("policies", [])
    auth = _auth_bearer(token)
    drifts = []

    product_id = product.get("id") or PRODUCT
    if product_id:
        r = httpx.get(f"{BASE}/products/{product_id}", headers={**HEADERS_JSON, **auth})
        if r.status_code == 200:
            remote = r.json().get("data", {}).get("attributes", {})
            for field in ("name", "code"):
                local_val = product.get(field)
                remote_val = remote.get(field)
                if local_val and local_val != remote_val:
                    drifts.append(f"product.{field}: yaml={local_val!r}  remote={remote_val!r}")
        else:
            drifts.append(f"product id={product_id} not found (HTTP {r.status_code})")

    for pol in policies:
        pol_id = pol.get("id")
        if not pol_id:
            drifts.append(f"policy '{pol['name']}' has no id — not yet created")
            continue
        r = httpx.get(f"{BASE}/policies/{pol_id}", headers={**HEADERS_JSON, **auth})
        if r.status_code == 200:
            remote = r.json().get("data", {}).get("attributes", {})
            for field in ("name", "scheme", "duration", "maxMachines", "strict", "floating"):
                local_val = pol.get(field)
                remote_val = remote.get(field)
                if local_val is not None and local_val != remote_val:
                    drifts.append(f"policy '{pol['name']}'.{field}: yaml={local_val!r}  remote={remote_val!r}")
        else:
            drifts.append(f"policy '{pol['name']}' id={pol_id} not found (HTTP {r.status_code})")

    if drifts:
        rprint("[bold red]DRIFT DETECTED:[/bold red]")
        for d in drifts:
            rprint(f"  [red]FAIL[/red] {d}")
        raise typer.Exit(1)
    else:
        rprint("[bold green]OK — No drift — Keygen matches data/providers/keygen.yaml[/bold green]")


# ── markdown ──────────────────────────────────────────────────────────────────

@app.command()
def markdown(
    token: str = typer.Option(..., "--token", envvar="KEYGEN_TOKEN", help="Admin/product Bearer token"),
):
    """Print a markdown table of all policies for the product."""
    auth = _auth_bearer(token)
    r = httpx.get(f"{BASE}/policies", headers={**HEADERS_JSON, **auth},
                  params={"filter[product]": PRODUCT})
    data = r.json()
    rows = data.get("data", [])

    print("| Name | ID | Scheme | Duration | MaxMachines | Strict | Floating |")
    print("|------|----|--------|----------|-------------|--------|----------|")
    for p in rows:
        a = p.get("attributes", {})
        dur = str(a.get("duration") or "∞")
        print(f"| {a.get('name','')} | `{p.get('id','')}` | {a.get('scheme','')} | {dur} | {a.get('maxMachines','')} | {a.get('strict','')} | {a.get('floating','')} |")


# ── validate ──────────────────────────────────────────────────────────────────

@app.command()
def validate(
    key: str = typer.Argument(..., help="License key"),
    fp: Optional[str] = typer.Option(None, "--fp", help="Machine fingerprint (colon-hex)"),
    no_scope: bool = typer.Option(False, "--no-scope", help="Validate without fingerprint scope"),
):
    """Validate a license key, optionally scoped to a fingerprint."""
    scope: dict = {"product": PRODUCT, "policy": POLICY}
    if fp and not no_scope:
        scope["fingerprint"] = fp

    body = {"meta": {"key": key, "scope": scope}}
    rprint(f"[dim]POST {BASE}/licenses/actions/validate-key[/dim]")
    rprint(f"[dim]scope: {scope}[/dim]")

    r = httpx.post(f"{BASE}/licenses/actions/validate-key", headers=HEADERS_JSON, json=body)
    data = r.json()
    _dump(data, f"HTTP {r.status_code}")

    meta = data.get("meta", {})
    valid = meta.get("valid")
    code  = meta.get("code")
    color = "green" if valid else "red"
    rprint(f"\n[bold {color}]valid={valid}  code={code}[/bold {color}]")


# ── activate ──────────────────────────────────────────────────────────────────

@app.command()
def activate(
    key: str = typer.Argument(..., help="License key"),
    fp: str  = typer.Argument(..., help="Machine fingerprint (colon-hex)"),
    name: str = typer.Option("debug-machine", "--name", help="Machine name"),
):
    """Activate a machine fingerprint against a license (auth: License <key>)."""
    license_id = _resolve_license_id(key)
    if not license_id:
        rprint("[red]Could not resolve licenseId — run validate first[/red]")
        raise typer.Exit(1)

    body = {
        "data": {
            "type": "machines",
            "attributes": {"fingerprint": fp, "name": name},
            "relationships": {
                "license": {"data": {"type": "licenses", "id": license_id}}
            },
        }
    }
    headers = {**HEADERS_JSON, **_auth_license(key)}
    rprint(f"[dim]POST {BASE}/machines  licenseId={license_id[:8]}***[/dim]")

    r = httpx.post(f"{BASE}/machines", headers=headers, json=body)
    data = r.json()
    _dump(data, f"HTTP {r.status_code}")

    ok = r.status_code in (200, 201)
    color = "green" if ok else "red"
    machine_id = data.get("data", {}).get("id", "n/a")
    rprint(f"\n[bold {color}]ok={ok}  machineId={machine_id}[/bold {color}]")


# ── machines ──────────────────────────────────────────────────────────────────

@app.command()
def machines(
    key: str = typer.Argument(..., help="License key"),
    token: Optional[str] = typer.Option(None, "--token", envvar="KEYGEN_TOKEN", help="Admin/product Bearer token"),
):
    """List machines registered to a license (auth: License <key> or Bearer token)."""
    license_id = _resolve_license_id(key)
    if not license_id:
        rprint("[red]Could not resolve licenseId[/red]")
        raise typer.Exit(1)

    if token:
        auth = _auth_bearer(token)
        rprint("[dim]auth: Bearer token[/dim]")
    else:
        auth = _auth_license(key)
        rprint("[dim]auth: License key[/dim]")

    url = f"{BASE}/licenses/{license_id}/machines"
    rprint(f"[dim]GET {url}[/dim]")

    r = httpx.get(url, headers={**HEADERS_JSON, **auth})
    data = r.json()
    _dump(data, f"HTTP {r.status_code}")

    rows = data.get("data", [])
    if isinstance(rows, list):
        rprint(f"\n[bold]{len(rows)} machine(s)[/bold]")
        for m in rows:
            attrs = m.get("attributes", {})
            rprint(f"  id={m.get('id')}  fp={attrs.get('fingerprint')}  name={attrs.get('name')}")


# ── deactivate ────────────────────────────────────────────────────────────────

@app.command()
def deactivate(
    machine_id: str = typer.Argument(..., help="Keygen machine UUID (from 'machines' command)"),
    token: Optional[str] = typer.Option(None, "--token", envvar="KEYGEN_TOKEN", help="Admin/product Bearer token"),
    key: Optional[str] = typer.Option(None, "--key", help="License key (fallback auth)"),
):
    """Delete/deactivate a machine by its Keygen machine UUID."""
    if token:
        auth = _auth_bearer(token)
    elif key:
        auth = _auth_license(key)
    else:
        rprint("[red]Provide --token or --key for auth[/red]")
        raise typer.Exit(1)

    url = f"{BASE}/machines/{machine_id}"
    rprint(f"[dim]DELETE {url}[/dim]")

    r = httpx.delete(url, headers={**HEADERS_JSON, **auth})
    if r.status_code == 204:
        rprint("[bold green]Deactivated (204 No Content)[/bold green]")
    else:
        _dump(r.json(), f"HTTP {r.status_code}")


# ── helpers ───────────────────────────────────────────────────────────────────

def _resolve_license_id(key: str) -> Optional[str]:
    body = {"meta": {"key": key, "scope": {"product": PRODUCT, "policy": POLICY}}}
    try:
        r = httpx.post(f"{BASE}/licenses/actions/validate-key", headers=HEADERS_JSON, json=body, timeout=10)
        return r.json().get("data", {}).get("id")
    except Exception as e:
        rprint(f"[red]resolve licenseId failed: {e}[/red]")
        return None


if __name__ == "__main__":
    app()
