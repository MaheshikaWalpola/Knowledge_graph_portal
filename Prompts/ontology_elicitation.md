# Stage 1 - Ontology Elicitation Prompts

These are the prompts used with an LLM (GPT-4) to draft and iteratively refine
the CMP Process Ontology (CMPO). The goal was to generate an initial ontology
skeleton covering the domain of Chemical Mechanical Planarization, aligned with
the Basic Formal Ontology (BFO).

---

## Prompt 1 - Initial Domain Overview

```
You are an ontology engineer. I want to model the domain of Chemical Mechanical
Planarization (CMP) as used in semiconductor manufacturing.

CMP is a process where a wafer is polished using a rotating polishing pad and a
chemical slurry to remove material layers and achieve surface planarity.

Please list the major concepts (classes) in this domain, including:
- Equipment and its components
- Consumables (polishing pads, slurry)
- Process parameters (pressure, speed, temperature)
- Wafer properties (material, thickness, uniformity)
- Roles (operators, engineers)
- Process steps

Give a flat list first, then suggest a possible class hierarchy.
```

---

## Prompt 2 - Aligning with BFO

```
We want to align the CMP ontology with the Basic Formal Ontology (BFO 2.0).

Here are the top-level BFO categories:
- BFO:Object (material entities)
- BFO:Process (occurrents, things that happen over time)
- BFO:Quality (properties that inhere in entities)
- BFO:Role (functions that entities play)
- BFO:InformationContentEntity (IAO, for data and documents)

Please classify each of the following CMP concepts under the most appropriate BFO category
and briefly justify your choice:

- CMPTool
- Wafer
- Slurry
- PolishingPad
- Recipe
- HeadPressure
- PlatenSpeed
- CMPProcess
- ToolBreakIn
- LotOwner
- ProcessCard
- RemovalRate
```

---

## Prompt 3 - Generating Object Properties

```
For the CMP ontology, suggest a set of OWL object properties (relations between classes).

For each property, specify:
1. The property name (use camelCase)
2. The domain class
3. The range class
4. A short description

Focus on these relationships:
- Equipment to components (e.g., CMPTool has Platen, WaferHead, Conditioner)
- Consumables used by equipment (e.g., Platen has PolishingPad)
- Process to steps (e.g., CMPProcess has Step)
- Wafer to lot membership
- Recipe to parameters it specifies
- Agent roles to processes they run

Return the result as a turtle snippet using the cmpo: prefix.
```

---

## Prompt 4 - Iterative Refinement and Comments

```
Here is a draft of the CMP ontology in Turtle format:

[paste of VSR_CMP_schema.ttl draft here]

Please review it and suggest:
1. Missing classes or properties
2. Incorrect BFO alignments
3. Redundant or duplicated definitions
4. Better naming conventions

Also add rdfs:comment annotations where the meaning of a class or property
is not obvious from the name alone.
```

---

## Prompt 5 - Generating a Minimal ABox (Instance Example)

```
Using the CMP ontology schema below, generate a small but realistic ABox
(instance data) in Turtle format.

Include:
- 1 CMPTool instance (e.g., an IPEC tool) with its components
- 1 PolishingPad with a lifetime value
- 1 Slurry instance with a type and charge number
- 1 OxideCMPRecipe with two parameters (HeadPressure and PlatenSpeed)
- 1 Wafer (StructuredWafer) with an ID and a lot
- 1 CMPProcess with two steps: ToolBreakIn and a polishing step

Use the prefix: cmpo: <https://tucid/cpmo/>

Return valid Turtle that can be imported directly into GraphDB.
```

---

## Notes

- All prompts were submitted to GPT-4 (OpenAI API, gpt-4-turbo) in March 2024.
- Responses were reviewed and corrected manually before adding to the ontology files.
- The final ontology file is `ontology/VSR_CMP_schema.ttl`.
