"""Read recent Azure DevOps pipeline run results."""

import os
import shutil

_AZ_FALLBACK = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
if not shutil.which("az"):
    os.environ["PATH"] = _AZ_FALLBACK + os.pathsep + os.environ.get("PATH", "")

from azure.identity import AzureCliCredential
from azure.devops.connection import Connection
from msrest.authentication import BasicTokenAuthentication

ORG_URL = "https://dev.azure.com/cprima"
PROJECT = "cpmforge"
PIPELINE_NAME = "cprima-forge.cpmf-prism"
RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798"


def main():
    credential = AzureCliCredential()
    token = credential.get_token(f"{RESOURCE}/.default").token

    connection = Connection(
        base_url=ORG_URL,
        creds=BasicTokenAuthentication({"access_token": token}),
    )

    pipelines_client = connection.clients.get_pipelines_client()
    pipelines = pipelines_client.list_pipelines(PROJECT)

    pipeline = next((p for p in pipelines if p.name == PIPELINE_NAME), None)
    if not pipeline:
        print(f"Pipeline '{PIPELINE_NAME}' not found")
        return

    runs = pipelines_client.list_runs(PROJECT, pipeline.id)
    for run in list(runs)[:5]:
        result = getattr(run, "result", "-")
        print(f"  run {run.id}: state={run.state} result={result}")


if __name__ == "__main__":
    main()
