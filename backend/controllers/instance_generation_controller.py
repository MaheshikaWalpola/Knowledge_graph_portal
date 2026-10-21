"""Instance generation workflow controllers."""

from typing import Dict, List, Any
from fastapi import HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from io import BytesIO
import base64
import zipfile
import json

from services.instance_analysis_service import analyze_schema_and_data, analyze_schema_and_data_stream
from services.instance_generation_service import build_instances_from_csvs
from services.schema_instance_generation_service import build_instances_from_schema_csvs, is_schema_structured
from services.pdf_conversion_service import ConversionResult, build_schema_context, convert_pdf, render_schema



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

        # Process and extract data files (handles raw CSVs and ZIP files)
        csv_contents, csv_filenames = await _process_data_files(data_files)

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


async def ctrl_analyze_schema_and_data_stream(
    schema_file: UploadFile,
    data_files: List[UploadFile],
    user_email: str,
    model: str = None,
) -> StreamingResponse:
    """
    Reads files in the request context and returns a StreamingResponse.
    """
    try:
        # Read schema file immediately while the file is open
        schema_content = await schema_file.read()
        if not schema_content:
            raise ValueError("Schema file is empty")

        # Process and extract data files immediately while files are open
        csv_contents, csv_filenames = await _process_data_files(data_files)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read upload files: {str(e)}")

    def generator():
        try:
            for chunk in analyze_schema_and_data_stream(schema_content, csv_contents, csv_filenames, model=model):
                yield json.dumps(chunk) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(generator(), media_type="text/event-stream")




async def ctrl_generate_instance(
    schema_file: UploadFile,
    data_files: List[UploadFile],
    mappings: str,  # JSON string of header -> term mappings
    user_email: str,
    schema_id: str = "main",
    model: str = None,
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

        # Process and extract data files (handles raw CSVs and ZIP files)
        csv_contents, csv_filenames = await _process_data_files(data_files)

        # Parse mappings
        try:
            header_mappings = json.loads(mappings) if mappings else {}
        except json.JSONDecodeError:
            raise ValueError("Invalid mappings JSON format")

        # Generate instances. CSVs that follow the schema (one file per class, schema
        # properties as headers, e.g. from the PDF conversion) use the schema-driven generator.
        if is_schema_structured(schema_content, csv_filenames, csv_contents):
            result = build_instances_from_schema_csvs(
                files=csv_contents,
                filenames=csv_filenames,
                schema_bytes=schema_content,
            )
        else:
            result = build_instances_from_csvs(
                files=csv_contents,
                filenames=csv_filenames,
                user_key=user_email,
                schema_id=schema_id,
                mappings=header_mappings,
                schema_bytes=schema_content,
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


async def _process_data_files(data_files: List[UploadFile]) -> tuple[List[bytes], List[str]]:
    csv_contents = []
    csv_filenames = []

    for data_file in data_files:
        content = await data_file.read()
        if not content:
            continue

        fname = data_file.filename or "data.csv"
        if fname.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(BytesIO(content)) as z:
                    for filepath in z.namelist():
                        # Extract only CSVs, ignore macOS metadata folders/files
                        if filepath.endswith(".csv") and not "__MACOSX" in filepath and not filepath.split("/")[-1].startswith("._"):
                            csv_contents.append(z.read(filepath))
                            csv_filenames.append(filepath.split("/")[-1])
            except Exception as e:
                raise ValueError(f"Failed to extract ZIP file {fname}: {str(e)}")
        else:
            csv_contents.append(content)
            csv_filenames.append(fname)

    if not csv_contents:
        raise ValueError("No valid CSV files were uploaded or found in the ZIP archive")

    return csv_contents, csv_filenames


async def ctrl_convert_pdfs_to_csv_stream(
    schema_file: UploadFile,
    pdf_files: List[UploadFile],
    model: str = None,
) -> StreamingResponse:
    """
    Convert PDFs (or ZIPs of PDFs) into schema-aligned CSVs with the AI.
    Streams NDJSON progress events; the final "done" event carries the CSV files.
    """
    try:
        schema_content = await schema_file.read()
        if not schema_content:
            raise ValueError("Schema file is empty")
        schema_ctx = build_schema_context(schema_content)
        pdfs = await _collect_pdfs(pdf_files)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read upload files: {str(e)}")

    def generator():
        schema_text = render_schema(schema_ctx)
        result = ConversionResult(schema_ctx)
        failed = 0
        yield json.dumps({"type": "init", "files": [name for name, _ in pdfs]}) + "\n"

        for index, (name, content) in enumerate(pdfs, start=1):
            yield json.dumps({"type": "file_start", "file": name, "index": index, "total": len(pdfs)}) + "\n"
            try:
                stats = convert_pdf(content, name, schema_text, model, result)
                yield json.dumps({"type": "file_done", "file": name, "index": index, **stats}) + "\n"
            except Exception as e:
                failed += 1
                result.add_error(name, str(e))
                yield json.dumps({"type": "file_error", "file": name, "index": index, "message": str(e)}) + "\n"

        files = result.render()
        zip_buf = BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in files:
                z.writestr(f["name"], f["content"])
        yield json.dumps({
            "type": "done",
            "summary": {**result.summary(), "files_total": len(pdfs), "files_failed": failed},
            "files": files,
            "zip_base64": base64.b64encode(zip_buf.getvalue()).decode("ascii"),
        }) + "\n"

    return StreamingResponse(generator(), media_type="application/x-ndjson")


def _is_pdf_entry(filepath: str) -> bool:
    """PDF inside a ZIP, ignoring macOS metadata folders/files."""
    return (filepath.lower().endswith(".pdf") and "__MACOSX" not in filepath
            and not filepath.split("/")[-1].startswith("._"))


async def _collect_pdfs(pdf_files: List[UploadFile]) -> List[tuple[str, bytes]]:
    """Read uploaded PDFs and PDFs inside uploaded ZIPs as (name, bytes)."""
    pdfs = []
    for upload in pdf_files:
        content = await upload.read()
        if not content:
            continue
        fname = upload.filename or "document.pdf"
        if fname.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(BytesIO(content)) as z:
                    # Keep the path inside the ZIP so equal file names in different folders stay distinct
                    pdfs += [(path, z.read(path)) for path in z.namelist() if _is_pdf_entry(path)]
            except zipfile.BadZipFile as e:
                raise ValueError(f"Failed to extract ZIP file {fname}: {str(e)}")
        elif fname.lower().endswith(".pdf"):
            pdfs.append((fname, content))

    if not pdfs:
        raise ValueError("No PDF files were uploaded or found in the ZIP archive")
    return pdfs
