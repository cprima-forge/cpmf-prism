default:
    @just --list

bootstrap:
    pwsh scripts/bootstrap.ps1

azdo-run spike="helloworld":
    uv run python tools/trigger_pipeline.py --spike {{spike}}

azdo-status:
    uv run python tools/pipeline_status.py

vsce-package spike="helloworld":
    cd src/spike/{{spike}} && npx vsce package

lint: lint-py lint-js lint-md

lint-py:
    uv run ruff check .

lint-js:
    npx eslint src/

lint-md:
    npx markdownlint-cli2 "**/*.md" "#node_modules"
