default:
    @just --list

azdo-run spike="helloworld":
    uv run python tools/trigger_pipeline.py --spike {{spike}}

azdo-status:
    uv run python tools/pipeline_status.py
