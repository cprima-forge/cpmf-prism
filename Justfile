default:
    @just --list

bootstrap:
    pwsh scripts/bootstrap.ps1

azdo-run spike="helloworld":
    uv run python tools/trigger_pipeline.py --spike {{spike}}

azdo-status:
    uv run python tools/pipeline_status.py

vsce-package spike="helloworld":
    cd src/spike/{{spike}} && npm install && npx vsce package --no-dependencies

vsce-install spike="helloworld":
    cd src/spike/{{spike}} && npm install && npx vsce package --no-dependencies && code --install-extension {{spike}}-*.vsix

ovsx-publish spike="helloworld":
    cd src/spike/{{spike}} && npm install && npx vsce package --no-dependencies && npx ovsx publish *.vsix -p $OVSX_TOKEN

uipath-spike-deploy:
    cp -r src/spike/uipath-spike/. "$LOCALAPPDATA/UiPath/Studio/Extensions/cpmforge.cpmf-uipath-spike-0.1.0/"

entitlement-table:
    uv run --script tools/generate_entitlement_table.py > docs/entitlements.md

keygen-environments:
    uv run --script tools/keygen_client.py environments

keygen-check:
    uv run python tools/keygen_client.py check

keygen-create:
    uv run python tools/keygen_client.py create --dry-run

keygen-create-apply:
    uv run python tools/keygen_client.py create

keygen-markdown:
    uv run python tools/keygen_client.py markdown

test:
    cd packages/license && node node_modules/vitest/vitest.mjs run

test-watch:
    cd packages/license && node node_modules/vitest/vitest.mjs

lint: lint-py lint-js lint-md

lint-py:
    uv run ruff check .

lint-js:
    npx eslint src/

lint-md:
    npx markdownlint-cli2 "**/*.md" "#node_modules"
