# Screenshots

These screenshots show the main views of the Knowledge Graph Portal.

## Home Page

The landing page of the portal. It shows the portal name and a short description.
Navigation links at the top give access to Search, Ontology, AI Assistant, and Workspace.

![Home page](Screenshot%202026-03-17%20121909.png)

## AI Assistant

The AI Assistant page lets you ask natural language questions about the knowledge graph.
Example questions are shown as quick-start buttons, such as "What classes are in the ontology?"
or "Explain the schema structure".

![AI assistant](Screenshot%202026-03-17%20121824.png)

## Search - List View

The Search page lets you look up any concept in the ontology.
Searching for "Pressure" in schema-only mode returns all related classes and their relationships
listed as triples (subject, predicate, object).

![Search list view](Screenshot%202026-03-17%20122501.png)

## Ontology - Graph View

The Ontology page shows the ontology as an interactive node-link graph.
Here a search for "Pressure" shows the class and its subclasses (HeadPressure,
RetainingRingPressure, InnerTubePressure, DownForcePressure) connected by subClassOf edges.

![Ontology graph view](Screenshot%202026-03-17%20122645.png)

## Workspace - Search Tab

The Workspace is a personal working area where you can search the schema,
edit triples directly, or upload CSV files. The Search tab is shown here.

![Workspace search tab](Screenshot%202026-03-17%20122700.png)

## Workspace - Graph Search Result

Searching for "Pressure" in the Workspace graph view shows the concept and its
related classes with labelled edges (is subclass of, input). Results show 6 nodes and 5 edges.

![Workspace graph result](Screenshot%202026-03-17%20122810.png)

## Workspace - Edit Triples

The Edit Triples tab allows you to manually add, delete, or update RDF triples
in the knowledge graph. You enter the Subject, Predicate, and Object for each triple.

![Workspace edit triples](Screenshot%202026-03-17%20122823.png)

## Workspace - Upload CSV

The Upload CSV tab lets you upload a CSV file and automatically generate
RDF instance data from it based on the current workspace schema.

![Workspace upload CSV](Screenshot%202026-03-17%20122840.png)

## Workspace - Export

The Export button (top right of the Workspace) lets you download the current
schema data from the workspace in RDF format.

![Workspace export](Screenshot%202026-03-17%20122709.png)
