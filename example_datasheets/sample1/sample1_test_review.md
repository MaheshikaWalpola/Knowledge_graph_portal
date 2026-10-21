# PDF → Instance Pipeline: Test Review (sample1)

Oct 21, 2026 · @Rocky

## Overview

All extracted values were correct in all 5 PDFs, and every run is linked to its own Device Data, Identification and wafer. The remaining problems are records the AI invented, inconsistent lot values, one missing link and false CHECK flags.

| Item | Used in this test |
| --- | --- |
| PDFs | 5 data sheets in `sample1/pdfs/`: wafers W-07, W-08, W-09 (lot L-4412) and W-15, W-16 (lot L-4519) |
| Schema | `sample1/sample1_schema.ttl` (7 classes, 32 properties) |
| AI model | Qwen3.6-35B-A3B (default in the instance generation step) |
| CSV output | `sample1/sample1_csvs_1.zip`: one CSV per class with 5 rows each, plus `review.csv` |
| Instance file | `sample1/sample1_instance_1.ttl`: 267 triples, made by the new schema-driven generator |

Pipeline steps: PDF to CSV conversion (AI) → Analyze (header matching) → instance generation → Workspace upload.

## What went right

| Area | Result | Example |
| --- | --- | --- |
| Extracted values | All values match the PDFs, in all 5 files | W-15: supply voltage 3.35 V → `3.35`, max. junction temp. 155 °C → `155`, yield `0.91`, film thickness 44.6 nm → `44.6` |
| Formatting | Units removed, dates in ISO format, original text kept in `raw` | Start `2025-03-17 07:48:03` → `2025-03-17T07:48:03`; `42.7 nm` → `42.7` |
| Images | Not guessed; each image is listed in `review.csv` for a manual check | The test temperature (25 °C) appears only in the image and was correctly left out |
| Record IDs | The AI gave every record an ID and used it for links | `"hasDeviceData": "r4"` became `sample1-sample1-datasheet-ids-W-09-r4` |
| Links per run | Each run points to its own blocks, nothing mixed up across PDFs | `measurementrun_ID-000123` → `devicedata_…-r4` (3.30 V, 0.85), `identification_…-r5`, `wafer_W-07` |
| Data sheet links | 4 of 5 data sheets link to their run | `datasheet_DS-2025-0042` → `measurementrun_ID-000123` |
| Duplicates merged | Same thing from several PDFs = one instance | 5 Organization rows → 1 `organization_Example_Semiconductor_GmbH`, linked from all 5 data sheets |
| Schema check | A field on the wrong class is flagged CHECK | `lotId` on DeviceData: "domain: lotId belongs to Wafer, not DeviceData" |
| Instance generation | Takes 0.04 s; no invented classes like ProcessStep or Tool | 267 triples: 5 each of DataSheet, MeasurementRun, Identification, DeviceData, Wafer |
| Workspace | Numbers show as data nodes with chart and statistics | `supplyVoltage`: count 5, min 3.27, max 3.35, avg 3.304 |

## What went wrong

The invented devices are the most serious problem: they look plausible and pass every check. The rest is ordered by impact.

| # | Problem | Example | Cause | Impact |
| --- | --- | --- | --- | --- |
| 1 | Invented Device records | 5 Devices named `Value A-01` … `Value B-02`, the **Sample** value; linked by `measuredDevice` and `fromWafer` | The device name appears only in the image; the AI filled the Device class with the sample value | False instances and links in the graph; not flagged, because `Value A-01` does appear in the PDF |
| 2 | Lot written inconsistently | `wafer_W-07`: `Lot L-4412` vs. `wafer_W-09`: `L-4412` | The cell reads `Lot L-4412`; the AI sometimes kept the label word, sometimes not | A query for lot `L-4412` misses W-07 and W-08 |
| 3 | Lot on the wrong class | `lotId` on DeviceData in 3 of 5 PDFs (W-07, W-08, W-09) | The Lot column sits in the Device Data table | Flagged CHECK, but the generator still writes it on DeviceData |
| 4 | Missing link | `datasheet_DS-2025-0052` (W-16) has no `describesRun` | The AI left the field empty | Data sheet not connected to its run; no check notices it |
| 5 | False CHECK flags | W-16 start and end time: `NOT FOUND` although correct | The AI put the label into `raw` (`Start \| 2025-04-03 08:02:37`), and the text check looks for it literally | Correct values look suspicious in `review.csv` |
| 6 | Long record IDs | `sample1-sample1-datasheet-ids-W-09-r4` | The ZIP path includes the folder `sample1/` | Only cosmetic |

Side note from this run: generation hung twice because the uploaded file was moved between Analyze and Generate. The browser reads the file again for each step and cannot find it.

## Proposed fixes

None of these is implemented yet. All changes are in the PDF conversion and the new generator; the old generator and the Workspace stay untouched.

| Fixes | Change | Where |
| --- | --- | --- |
| 1 | AI rule: only create a record for something the document labels. Review check: flag a value that one record uses as a different field of another record (Device name = Sample of the run) | `pdf_conversion_service.py` |
| 2 | Remove the field's own label from the start of a value (`Lot L-4412` → `L-4412` for `lotId`, label "Lot"); the original stays in `raw` | `pdf_conversion_service.py` |
| 3 | Skip values the schema does not allow on that class, with a warning | `schema_instance_generation_service.py` |
| 4 | No general fix yet; a check for empty link fields between records of the same PDF is possible | open question |
| 5 | The text check ignores labels like `Start \|` and treats `T` and a space between date and time as equal | `pdf_conversion_service.py` |
| 6 | Build record IDs from the file name only, not the folder | `pdf_conversion_service.py` |
| Side note | Read selected files into memory when chosen, so moving them mid-run no longer matters | `InstanceGenerationWorkflow.jsx` |
