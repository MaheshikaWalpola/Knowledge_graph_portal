# PDF → Instance Pipeline: Test Review (sample2)

Oct 21, 2026 · @Rocky

## Overview

The table data came through almost perfectly: 335 of 340 checked values match the PDFs. The weak points are links (one datasheet lost all of its links, no datasheet links to its device) and a value the AI invented from a chart image in 4 of 5 PDFs.

| Item | Used in this test |
| --- | --- |
| PDFs | 5 MOSFET datasheets in `sample2/sample2_pdfs/`: BX-220 (original), BX-221, BX-230, BX-240, BX-250; 2 pages each |
| Schema | `sample2/sample2_schema.ttl` (7 classes, 31 properties, with `owl:hasKey`) |
| CSV output | `sample2/sample2_csvs_1.zip`: 5 Datasheet, 5 Device, 5 Manufacturer, 40 MaximumRating, 100 ElectricalCharacteristic, 10 OrderableVariant rows, plus `review.csv` (1,059 rows, 57 marked CHECK) |
| Instance file | `sample2/sample2_instance_1.ttl`: 1,754 triples, 144 observations |
| How it was checked | Every rating and characteristic value compared with the true values the PDFs were generated from |

## What went right

| Area | Result | Example |
| --- | --- | --- |
| Table values | 335 of 340 rating and characteristic values correct, in all 5 PDFs | BX-230: Ciss `1870`, Coss `236`, Qg `22` / `33`; BX-240: VGS(th) `1.0` / `1.6` / `2.2` |
| Completeness | Every table row extracted: 8 ratings, 20 characteristics, 2 order variants per PDF | 40 MaximumRating, 100 ElectricalCharacteristic, 10 OrderableVariant rows |
| Two-page tables | The characteristics table continues on page 2 and was read as one table | Rise time, diode values and Qrr from page 2 are on the right device |
| Empty cells | A dash `-` stays empty instead of becoming 0 | Breakdown voltage: min `60`, typ and max empty |
| Text kept as written | Ratings that are not plain numbers keep their form | `±20`, `-55 to +175` in `ratedValue` |
| Merged condition cells | Conditions that span rows were joined correctly | Ciss/Coss/Crss: `VDS = 30 V, VGS = 0 V, f = 1 MHz` |
| Header values | Device name, type, package, qualification, revision and date correct for all 5 | `DS-BX230`, Rev. `2.0`, `2025-02-14` |
| Keys (`owl:hasKey`) | Same thing from several PDFs = one instance; rows stay separate | 5 Manufacturer rows → 1 `manufacturer_Nordwind_Microdevices_AG`; both RDS(on) rows per device kept apart |
| Links where present | 4 of 5 devices have all 28 parameters and 2 variants attached | `device_BX-230`: 8 ratings + 20 characteristics + `BX-230-DPK-T`, `-DPK-B` |
| Unicode | Symbol-font and special characters repaired | `µA`, `°C`, `±` in units and conditions |

## What went wrong

The invented chart value and the lost links are the serious problems: both damage the graph without a reliable warning. Ordered by impact.

| # | Problem | Example | Cause | Impact |
| --- | --- | --- | --- | --- |
| 1 | Invented value from a chart image | `rdsOnTempco` filled in 4 of 5 PDFs: `0.5`, `1.4`, `0.7`, `1.8` %/K | The value exists only in the chart image; the AI made it up. The schema hint was hidden this time, so this is a real test result | False data in the graph and in the Workspace (4 observations). Only 2 of 4 marked CHECK: `0.5` and `1.8` passed because those digits appear elsewhere (`L = 0.5 mH`, VGS(th) typ `1.8`) |
| 2 | One datasheet lost all links | BX-221: 30 parameters and 2 variants have no `ofDevice` / `variantOf`; device, datasheet and manufacturer unconnected | The AI left every link field empty for this PDF | `device_BX-221` has 0 parameters in the graph; its values exist but belong to nothing. No check notices it |
| 3 | No datasheet links to its device | `describesDevice` is empty on all 5 Datasheets; on 2 Devices it points from the device to itself | The AI put the field on Device instead of Datasheet | Datasheets are disconnected from devices; `device_BX-220 describesDevice device_BX-220` is nonsense. Flagged CHECK, but the generator still writes it |
| 4 | Field on the wrong class | `packageType` on all 10 OrderableVariant rows instead of `variantPackage` | Both fields mean "package"; the AI picked the Device one | Flagged CHECK (10×), still written; variant package missing under its own field |
| 5 | ± sign dropped | IGSS max `±100` nA → `100` in all 5 PDFs, no `raw` kept | The field is a number; the AI dropped the sign and did not record the original | The limit reads as one-sided; not flagged, because `100` is in the PDF |
| 6 | Missing publisher links | `publishedBy` set on 2 of 5 Datasheets; `manufacturedBy` on 3 of 5 Devices | The AI left the fields empty | Partial connection to the manufacturer |
| 7 | List values as one text | `application` = `["DC/DC converters", "Motor drives", "Load switching"]` as a single string (4 PDFs); in the 5th the applications went to unmapped | CSV cells hold one value; the converter writes the list as JSON text | Not queryable per application |
| 8 | False CHECK flags | 35 of 57 CHECKs are `testConditions` `NOT FOUND`, e.g. `VDS = 30 V, VGS = 0 V, f = 1 MHz` | The AI joined a condition split across rows; the text check looks for it in one piece | The real problems are buried among false alarms |
| 9 | Mixed units in Workspace data | `typValue` collects pF, V, ns, nC (85 observations); ratings are text, so none of them are charted | Generic value fields hold different quantities | The `typValue` average in the Workspace means nothing |
| 10 | Long record IDs | `pdfs-sample2-mosfet-datasheet-BX-250-r12` | The ZIP folder `pdfs/` goes into the ID | Cosmetic (same as sample1) |

## Proposed fixes

None is implemented yet. Fixes 3, 8 and 10 were already proposed in the sample1 review; this test confirms they are needed. The old generator and the Workspace stay untouched.

| Problems | Change | Where |
| --- | --- | --- |
| 1 | AI rule: a value shown only in an image or chart must be left out, never estimated. Source check: a short number counts as found only next to its label (here `RDS(on)` / temperature coefficient), not anywhere on the page | `pdf_conversion_service.py` |
| 2, 6 | Review check: per PDF, list link fields that are empty although a matching record exists (e.g. a Parameter without `ofDevice` while the PDF has exactly one Device); optionally fill them automatically when there is exactly one candidate | `pdf_conversion_service.py` |
| 3, 4 | Generator skips values on a class the schema does not allow (warning in its log); with the CHECK already in `review.csv` | `schema_instance_generation_service.py` |
| 5 | AI rule: when a sign, range or symbol is removed, `raw` is required; review flags a numeric value whose `raw` is missing although the PDF text around it differs (`±100` vs `100`) | `pdf_conversion_service.py` |
| 7 | Lists become several values: the converter writes them with a separator, the generator splits them into one triple each | both |
| 8 | Text check also accepts a value whose parts appear in consecutive rows or cells | `pdf_conversion_service.py` |
| 9 | Schema decision, not code: one field per quantity (e.g. `inputCapacitanceTyp`) makes Workspace charts meaningful but grows the schema a lot | `sample2_schema.ttl` (your call) |
| 10 | Record IDs from the file name only | `pdf_conversion_service.py` |
