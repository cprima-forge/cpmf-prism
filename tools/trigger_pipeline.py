"""Trigger the Azure DevOps publish pipeline using AzureCliCredential."""

import argparse
import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

_az_fallback = os.getenv("AZ_FALLBACK_PATH", r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin")
if not shutil.which("az"):
    os.environ["PATH"] = _az_fallback + os.pathsep + os.environ.get("PATH", "")

from azure.identity import AzureCliCredential
from azure.devops.connection import Connection
from msrest.authentication import BasicTokenAuthentication

ORG_URL = os.environ["AZDO_ORG_URL"]
PROJECT = os.environ["AZDO_PROJECT"]
PIPELINE_NAME = os.environ["AZDO_PIPELINE_NAME"]
BRANCH = os.environ["AZDO_BRANCH"]
RESOURCE = os.environ["AZDO_RESOURCE"]


def main(spike: str):
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

    run = pipelines_client.run_pipeline(
        run_parameters={
            "resources": {"repositories": {"self": {"ref_name": f"refs/heads/{BRANCH}"}}},
            "templateParameters": {"SPIKE": spike},
        },
        project=PROJECT,
        pipeline_id=pipeline.id,
    )
    print(f"Pipeline triggered: spike={spike} run ID={run.id} state={run.state}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--spike", default="helloworld")
    args = parser.parse_args()
    main(args.spike)
