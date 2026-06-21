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
| `@vscode/vsce` | extension packaging and publishing |
| VS Code | extension development host (F5 debugging) |

## Licenses

- **Source code**: Apache License 2.0 — see `LICENSE`
- **Documentation**: Creative Commons Attribution 4.0 International — see `LICENSE-docs`

## Common tasks

```
just azdo-run              # trigger publish pipeline (default spike: helloworld)
just azdo-run myspike      # trigger publish pipeline for a different spike
just azdo-status           # show recent pipeline run results
```
