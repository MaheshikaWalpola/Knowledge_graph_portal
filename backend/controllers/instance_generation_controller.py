"""
Instance Generation Workflow Controllers
"""

from typing import Dict, List, Any
from fastapi import HTTPException, UploadFile
from io import BytesIO

from services.instance_generation_analysis_service import analyze_schema_and_data
from services.instance_generation_service import build_instances_from_csvs


async def ctrl_analyze_schema_and_data(
    schema_file: UploadFile,
    data_files: List[UploadFile],
    user_email: str,
) -> Dict[str, Any]:
    """
    Analyze schema file and data files to match headers to schema terms.
    Returns a report with matching information.
    """

    try:
        # Read schema file
        schema_content = await schema_file.read()
        if not schema_content:
            raise ValueError("Schema file is empty")

        # Read data files
        csv_contents = []
        csv_filenames = []
        for data_file in data_files:
            content = await data_file.read()
            if not content:
                raise ValueError(f"Data file {data_file.filename} is empty")
            csv_contents.append(content)
            csv_filenames.append(data_file.filename or "data.csv")

        # Perform analysis
        report = analyze_schema_and_data(schema_content, csv_contents, csv_filenames)

        return {
            "status": "success",
            "message": "Schema and data analysis complete",
            **report,
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


async def ctrl_generate_instance(
    schema_file: UploadFile,
    data_files: List[UploadFile],
    mappings: str,  # JSON string of header -> term mappings
    user_email: str,
    schema_id: str = "main",
) -> Dict[str, Any]:
    """
    Generate RDF instance file from schema and data files using provided mappings.
    Returns the generated Turtle content and metadata.
    """

    try:
        import json

        # Read schema file
        schema_content = await schema_file.read()
        if not schema_content:
            raise ValueError("Schema file is empty")

        # Read data files
        csv_contents = []
        csv_filenames = []
        for data_file in data_files:
            content = await data_file.read()
            if not content:
                raise ValueError(f"Data file {data_file.filename} is empty")
            csv_contents.append(content)
            csv_filenames.append(data_file.filename or "data.csv")

        # Parse mappings
        try:
            header_mappings = json.loads(mappings) if mappings else {}
        except json.JSONDecodeError:
            raise ValueError("Invalid mappings JSON format")

        # Generate instances
        result = build_instances_from_csvs(
            files=csv_contents,
            filenames=csv_filenames,
            user_key=user_email,
            schema_id=schema_id,
        )

        # Prepare response
        return {
            "status": "success",
            "message": "Instance file generated successfully",
            "filename": "instance.ttl",
            "content": result.turtle,
            "triples": result.triples,
            "rows_processed": len(csv_contents),
            "preview": _get_preview(result.turtle, lines=10),
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")


def _get_preview(turtle_content: str, lines: int = 10) -> str:
    """Get first N lines of turtle content as preview."""
    content_lines = turtle_content.split("\n")
    return "\n".join(content_lines[:lines])
