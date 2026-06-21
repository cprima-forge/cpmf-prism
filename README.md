# cpmf-prism

VS Code extension for visualizing UiPath ObjectRepository.

Publisher: [cpmforge](https://marketplace.visualstudio.com/publishers/cpmforge)

## Status

Under development. The `archive/web-viewer` branch holds the legacy web-based viewer.

## Prerequisites

| Tool | Purpose |
|------|---------|
| Node.js ≥ 20 | extension runtime |
| uv | Python tooling |
| just | task runner |
| Azure CLI | pipeline authentication |

## Tasks

```
just azdo-run              # publish spike (default: helloworld)
just azdo-run <spike>      # publish a named spike
just azdo-status           # recent pipeline run results
```

## License

Source code: [Apache 2.0](LICENSE)  
Documentation: [CC BY 4.0](LICENSE-docs)
