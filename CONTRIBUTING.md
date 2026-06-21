# Contributing

## Prerequisites

| Tool | Purpose |
|------|---------|
| git | source control |
| Node.js ≥ 20 | VS Code extension runtime |
| npm | extension dependencies |
| uv | Python tooling |
| just | task runner (`Justfile`) |
| Azure CLI (`az`) | pipeline authentication |
| `@vscode/vsce` | extension packaging (produces `.vsix`) |
| `ovsx` | publishing `.vsix` to Open VSX registry |
| VS Code | extension development host (F5 debugging) |

## Licenses

- **Source code**: Apache License 2.0 — see `LICENSE`
- **Documentation**: Creative Commons Attribution 4.0 International — see `LICENSE-docs`

## Extension packaging and publishing

UiPath Studio 26.x runs VS Code extensions. The target registry is [Open VSX](https://open-vsx.org) (not Microsoft's marketplace).

```bash
# Package — produces .vsix artifact (no registry involved)
vsce package --no-dependencies

# Publish to Open VSX
ovsx publish *.vsix -p $OVSX_TOKEN
```

Use `vsce` for build, `ovsx` for publish. Never `vsce publish` (Microsoft marketplace only).

In CI (Azure DevOps):
```yaml
- script: npx vsce package --no-dependencies
- script: npx ovsx publish *.vsix -p $(OVSX_TOKEN)
```

## Common tasks

```
just azdo-run              # trigger publish pipeline (default spike: helloworld)
just azdo-run myspike      # trigger publish pipeline for a different spike
just azdo-status           # show recent pipeline run results
```
