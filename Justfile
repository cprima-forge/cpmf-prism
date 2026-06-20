default:
    @just --list

trigger:
    uv run python tools/trigger_pipeline.py
