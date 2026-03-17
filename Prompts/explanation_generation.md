# Stage 3 - Explanation Generation Prompts

These prompts were used in Stage 3 of the pipeline to convert structured SPARQL
query results (returned from GraphDB) into natural language explanations for
domain experts. The target audience is CMP process engineers who may not be
familiar with ontology or SPARQL terminology.

## Prompt 1 - SPARQL Result to Natural Language

```
I queried a knowledge graph about a CMP (Chemical Mechanical Planarization) process
and received the following SPARQL result in JSON format:

[SPARQL JSON result here]

Please convert this into a clear, concise paragraph that a process engineer
can understand. Avoid technical ontology terms.
Use simple language and focus on what the data means for the process.
```

## Prompt 2 - Explaining Graph Paths

```
The following is a path retrieved from a CMP knowledge graph:

CMPTool_IPEC_01
  -> hasCMPToolComponent -> Platen_01
  -> hasPolishingPad     -> PolishingPad_42
  -> hasPadLifetime      -> 340 (polishing cycles)

Explain what this means in plain English for a CMP process engineer.
Mention whether the pad lifetime looks reasonable based on typical industry norms
(typical pads last 200-500 polishing cycles).
```

## Prompt 3 - Anomaly Explanation

```
A SPARQL query returned the following anomalous data from a CMP process log:

- Lot: LOT_2023_007
- Wafer: W_042
- Expected RemovalRate: 2200 A/min (angstroms per minute)
- Actual RemovalRate: 1450 A/min
- HeadPressure: 4.5 psi (within normal range)
- PlatenSpeed: 93 rpm (within normal range)
- SlurryType: Klebosol_SW30
- PolishingPadLifetime: 387 cycles (past recommended threshold of 350)

Based on this data, what is the most likely cause of the lower-than-expected
removal rate? Explain your reasoning step by step.
```

## Prompt 4 - Generating a Text Summary for a Full Process Run

```
Below is a structured summary of a complete CMP process run extracted from the
knowledge graph. Please write a short technical report paragraph (3-5 sentences)
summarizing the key process conditions, outcomes, and anything noteworthy.

Process run data:
- Tool: IPEC Avanti 472
- Date: 2023-09-14
- Wafer lot: LOT_2023_014 (24 wafers)
- Recipe: OxideCMP_Recipe_v3
  - HeadPressure: 5.0 psi
  - PlatenSpeed: 100 rpm
  - SlurryFlow: 200 ml/min (Klebosol)
  - PolishingTime: 60 seconds
- Average RemovalRate: 2280 A/min
- Average Uniformity: 3.2%
- Defects reported: 0
- PolishingPad used: Pad_55 (lifetime: 210 cycles)
```

## Prompt 5 - SHACL Validation Result Explanation

```
The following SHACL validation result was returned when validating a CMP
knowledge graph instance:

Violation:
  Shape: cmpo:CMPToolShape
  Node: cmpo:CMPTool_MIRRA_03
  Path: cmpo:machineID
  Message: "A CMPTool must have a machineID."
  Severity: sh:Violation

Please explain this validation error in plain language for a data engineer
who is not familiar with SHACL or ontologies. Also suggest what data needs
to be added to fix the problem.
```

## Notes

These prompts are conceptual examples written to illustrate the idea behind
Stage 3 of the pipeline. In practice, the explanation step is conversational
and depends on what the user queries from the graph.

The AI-assisted explanation feature is currently in the implementation stage.
The backend endpoint for calling the language model is planned, and these
prompts represent the intended direction for how query results will be
translated into plain language for domain experts.
