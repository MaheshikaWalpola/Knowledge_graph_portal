import { useState, useEffect } from "react";
import "./UserGuidance.css";

const sections = [
  { id: "getting-started", label: "Getting Started", icon: "rocket" },
  { id: "workspace", label: "Workspace", icon: "grid" },
  { id: "schema-ontology", label: "Schema Ontology", icon: "layers" },
  { id: "search", label: "Search Connections", icon: "search" },
  { id: "main-canvas", label: "Main Canvas", icon: "pen-tool" },
  { id: "ai-assistant", label: "AI Assistant", icon: "cpu" },
  { id: "instance-generation", label: "Instance Generation", icon: "file-text" },
  { id: "data-validation", label: "Data Validation", icon: "shield" },
  { id: "my-ontologies", label: "My Ontologies", icon: "database" },
  { id: "account", label: "Profile & Account", icon: "user" },
];

const Icon = ({ name, size = 16, className = "" }) => {
  const icons = {
    rocket: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
    grid: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
    layers: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    cpu: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
      </svg>
    ),
    "pen-tool": (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
    search: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    ),
    database: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
    "file-text": (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    ),
    shield: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    user: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    clock: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    lightbulb: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
      </svg>
    ),
    info: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
    alert: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    ),
  };
  return <span className={className}>{icons[name]}</span>;
};

const Callout = ({ type = "info", children }) => (
  <div className={`guidance-callout ${type}`}>
    <Icon
      name={type === "tip" ? "lightbulb" : type === "warning" ? "alert" : "info"}
      size={20}
      className="guidance-callout-icon"
    />
    <div>{children}</div>
  </div>
);

const Steps = ({ items }) => (
  <ol className="guidance-steps">
    {items.map((item, i) => (
      <li key={i} className="guidance-step">{item}</li>
    ))}
  </ol>
);

const UserGuidance = () => {
  const [activeSection, setActiveSection] = useState("getting-started");

  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = sections.map(s => ({
        id: s.id,
        el: document.getElementById(s.id),
      }));

      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const { id, el } = sectionElements[i];
        if (el && el.getBoundingClientRect().top <= 150) {
          setActiveSection(id);
          break;
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(id);
    }
  };

  return (
    <div className="guidance-container">
      {/* Sidebar */}
      <aside className="guidance-sidebar">
        <div className="guidance-sidebar-title">Documentation</div>
        <ul className="guidance-nav">
          {sections.map((s) => (
            <li
              key={s.id}
              className={`guidance-nav-item ${activeSection === s.id ? "active" : ""}`}
              onClick={() => scrollTo(s.id)}
            >
              <Icon name={s.icon} size={18} className="guidance-nav-icon" />
              {s.label}
            </li>
          ))}
        </ul>
      </aside>

      {/* Mobile dropdown */}
      <div className="guidance-mobile-nav">
        <select
          className="guidance-mobile-select"
          value={activeSection}
          onChange={(e) => scrollTo(e.target.value)}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <main className="guidance-content">
        <div className="guidance-header">
          <h1 className="guidance-page-title">User Guidance</h1>
          <p className="guidance-page-desc">
            Welcome to the Knowledge Graph Portal documentation. This guide covers every
            feature of the platform to help you get started quickly and work efficiently.
          </p>
        </div>

        {/* Getting Started */}
        <section id="getting-started" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="rocket" /></span>
            Getting Started
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Overview</h3>
            <p className="guidance-text">
              The Knowledge Graph Portal is a web-based platform for exploring, building and
              managing semantic knowledge graphs. It provides tools for ontology visualization,
              graph modeling, AI-assisted query generation and collaborative workspace management.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Creating an Account</h3>
            <Steps items={[
              "Click the SIGNIN button in the top-right corner of the navigation bar.",
              "In the dialog, select \"Create Account\" or \"Register\" to switch to the registration form.",
              "Enter your first name, last name, email address and a secure password.",
              "Click Register. A verification email will be sent to your inbox.",
              "Open the verification email and click the link to activate your account.",
              "Return to the portal and sign in with your credentials."
            ]} />
            <Callout type="tip">
              If you don't receive the verification email, check your spam/junk folder. You can also request a new verification email from the sign-in dialog.
            </Callout>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Quick Navigation</h3>
            <p className="guidance-text">
              The navigation bar at the top provides direct access to all major sections
              of the portal:
            </p>
            <Steps items={[
              <><strong>Main Canvas</strong> - Visual graph editor for building and editing knowledge graphs.</>,
              <><strong>Ontology</strong> - Browse and explore schema-level entities and relationships.</>,
              <><strong>AI Assistant</strong> - Use natural language to query and generate graph data.</>,
              <><strong>Workspace</strong> - Manage ontologies, upload files and configure graph settings.</>
            ]} />
          </div>
        </section>

        {/* Workspace */}
        <section id="workspace" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="grid" /></span>
            Workspace
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">What is the Workspace?</h3>
            <p className="guidance-text">
              The Workspace is your central hub for managing ontologies and graph data.
              It allows you to upload ontology files, select active ontologies, manage
              schemas and configure settings for your knowledge graph projects.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Uploading an Ontology</h3>
            <Steps items={[
              "Navigate to Workspace from the navigation bar.",
              "Click the \"Upload Ontology\" or \"Import\" button.",
              "Select an RDF, OWL or Turtle (.ttl) file from your computer.",
              "The system will parse the file and display the extracted schema.",
              "Review the imported classes, properties and relationships.",
              "Click \"Save\" to add the ontology to your workspace."
            ]} />
            <Callout type="info">
              Supported file formats include RDF/XML (.rdf), OWL (.owl), Turtle (.ttl) and N-Triples (.nt).
            </Callout>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Managing Ontologies</h3>
            <p className="guidance-text">
              From the Workspace you can switch between multiple ontologies,
              view their statistics (class count, property count, instance count) and
              delete ontologies that are no longer needed.
            </p>
            <Callout type="warning">
              Deleting an ontology is permanent and will remove all associated schema data and instances. Make sure to export your data before deleting.
            </Callout>
          </div>
        </section>

        {/* Schema Ontology */}
        <section id="schema-ontology" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="layers" /></span>
            Schema Ontology
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Overview</h3>
            <p className="guidance-text">
              The Schema Ontology page provides an interactive graph visualization of your
              ontology's class hierarchy and relationships. You can explore how classes
              connect to each other through properties and inheritance.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Exploring the Graph</h3>
            <Steps items={[
              "Navigate to Ontology from the navigation bar.",
              "Select an ontology from the dropdown selector at the top.",
              "The graph will render showing classes as nodes and properties as edges.",
              "Click and drag nodes to rearrange the layout.",
              "Scroll to zoom in/out on the graph.",
              "Click on any node to view its details (properties, relationships and instances)."
            ]} />
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Filtering & Search</h3>
            <p className="guidance-text">
              Use the search bar above the graph to quickly find specific classes or entities.
              The filter panel lets you show/hide different types of relationships and
              focus on specific parts of the ontology.
            </p>
          </div>
        </section>

        {/* Search Connections */}
        <section id="search" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="search" /></span>
            Search Connections
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Overview</h3>
            <p className="guidance-text">
              The Search Connections feature lets you query instance-level data in your
              knowledge graph. Find specific entities, explore their properties and discover
              connections between different instances.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Running a Search</h3>
            <Steps items={[
              "Select an ontology and class from the dropdown menus.",
              "Enter a search term or filter criteria.",
              "Click Search to execute the query.",
              "Browse through the results showing matching instances.",
              "Click on any result to view its full details and connected entities."
            ]} />
          </div>
        </section>

        {/* Main Canvas */}
        <section id="main-canvas" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="pen-tool" /></span>
            Main Canvas
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Overview</h3>
            <p className="guidance-text">
              The Main Canvas is a visual modeling workspace where you can create, edit and
              arrange knowledge graph elements. It provides a drag-and-drop interface for
              building ontologies visually.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Adding Elements</h3>
            <Steps items={[
              "Open the Main Canvas from the navigation bar.",
              "Use the toolbar to select the type of element you want to add (Class, Property, Instance or Literal).",
              "Click on the canvas to place the new element.",
              "Edit the element's label and properties using the property panel on the right.",
              "To create relationships, drag from one element's connection point to another.",
              "Adjust positions by clicking and dragging elements on the canvas."
            ]} />
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Editing & Deleting</h3>
            <p className="guidance-text">
              Click any element on the canvas to select it. The property panel on the right
              will display its details. You can edit the label, type and other properties.
              To delete an element, select it and press the <span className="guidance-kbd">Delete</span> key
              or use the delete button in the property panel.
            </p>
          </div>
        </section>

        {/* AI Assistant */}
        <section id="ai-assistant" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="cpu" /></span>
            AI Assistant
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Overview</h3>
            <p className="guidance-text">
              The AI Assistant helps you query and explore your knowledge graphs using plain English. 
              It automatically translates your natural language questions into database queries to search 
              ontology schemas and instance data.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Using the Assistant</h3>
            <Steps items={[
              "Navigate to the AI Assistant from the top navigation bar.",
              "Type your question in the chat input. Mentioning the specific ontology name (e.g. \"wafer_ontology\") will help the assistant find information faster.",
              "Submit your question and view the response. If you ask for statistics or comparisons, the assistant can render an interactive bar chart directly inside the chat window.",
              "Click on any follow-up response buttons under the message to ask related questions automatically."
            ]} />
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">What You Can Ask</h3>
            <Steps items={[
              <><strong>General Definitions</strong> - Ask about concepts like RDF, SPARQL, OWL, or namespaces (e.g., <em>"What is a triple?"</em>).</>,
              <><strong>Schema Structures</strong> - Explore classes and relationships (e.g., <em>"What classes are connected to ProcessStep?"</em>).</>,
              <><strong>Data Statistics & Plots</strong> - Query averages, counts, or limits, and plot values (e.g., <em>"Plot wafer thickness values"</em> or <em>"What is the average run time?"</em>).</>,
              <><strong>Instance Search</strong> - Find specific records (e.g., <em>"Show me instances of WaferRun"</em>).</>
            ]} />
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Thinking Console & Chat Settings</h3>
            <p className="guidance-text">
              To inspect the compiled database query and search steps, click the header of the <strong>Thinking</strong> console while the assistant generates its response. 
              To manage your conversation history, click the settings gear icon in the chat header to open the sidebar. Here, you can rename or delete past threads.
            </p>
            <Callout type="tip">
              Be specific with entity names in your questions. If the assistant is unsure, it will suggest options to clarify which ontology you are referring to.
            </Callout>
          </div>
        </section>

        {/* Instance Generation */}
        <section id="instance-generation" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="file-text" /></span>
            Instance Generation
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Overview</h3>
            <p className="guidance-text">
              The Instance Generation workflow allows you to build rich RDF instance data files based on raw CSV data files aligned with an RDF/OWL/Turtle schema. By utilizing automated header mapping heuristics, custom override options, and batch folder uploads, you can efficiently construct structural triple configurations.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Step 1: Upload Files</h3>
            <p className="guidance-text">
              Begin by providing the structural schema and the corresponding data files:
            </p>
            <Steps items={[
              "Provide a Schema file - Choose an RDF, OWL, or Turtle (.ttl) schema definition file.",
              "Provide Data files - Choose one or more CSV files, or select a single .zip file. If a .zip file is uploaded, the system recursively scans and extracts all nested CSV files automatically.",
              "To remove any uploaded schema or data file, simply click the small cross (x) button on its display chip."
            ]} />
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Step 2: Analyze</h3>
            <p className="guidance-text">
              After selecting your files, click <strong>Analyze Files</strong>. The system reads the column headers of all uploaded CSV files, cross-references them against terms (classes and properties) in your schema, and automatically produces the best prefix and keyword match recommendations.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Step 3: Review & Custom Mappings</h3>
            <p className="guidance-text">
              The Matching Review screen lists matched and unmatched elements. You can modify these to fine-tune the resulting knowledge graph structure:
            </p>
            <Steps items={[
              "Edit Mappings - Click on any CSV header mapping card to open the custom mapping dialog.",
              "Dual-Mode Mapping - Toggle between mapping a CSV header to a schema term, or a schema term to a CSV header, using the intelligent search/autocomplete dropdown.",
              "Save Free-form Mappings - If a schema term isn't found in the autocomplete results, you can type your own namespace/URI term and press Enter to save it.",
              "Delete Mappings - Use the delete icon to remove any incorrect automatic mappings. Unmapped headers will be ignored during output construction.",
              "Map Missing Schema Terms - A dedicated list card displays all key terms in the schema that are not yet bound. You can easily map these to any available CSV header."
            ]} />
            <Callout type="tip">
              If you are confident in the system's automated suggestions, you can skip the manual review step entirely by clicking <strong>Skip Review</strong> to proceed straight to RDF compilation.
            </Callout>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Step 4: Generate & Download</h3>
            <p className="guidance-text">
              Once review is complete, click <strong>Generate Instance</strong>. The service constructs Turtle/RDF records conforming to the correct RDFLib naming conventions, mapping CSV attributes to instances (such as wafer runs and parameter details). You can view generating details (file size, triple count, rows processed) and download the completed .ttl file directly to your device.
            </p>
          </div>
        </section>

        {/* Data Validation */}
        <section id="data-validation" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="shield" /></span>
            Data Validation
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Overview</h3>
            <p className="guidance-text">
              The Data Validation interface allows you to compile human-readable business rules into SHACL (Shapes Constraint Language) shapes and validate RDF graphs against them. The generation is fully streamed and concurrent, ensuring fast processing times.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Step 1: Upload & Formulate Rules</h3>
            <Steps items={[
              "Upload Schema & Instances - Provide your schema (.ttl) and optional instance files to define the validation scope.",
              "Generate AI Questions - Click \"Generate Questions\" to let the AI suggest 10 data-validation rules in plain English.",
              "Manual Questions - Switch to the manual input mode to type your own validation rules directly.",
              "Choose Rules - Select the specific rules you want to turn into SHACL validation shapes."
            ]} />
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Step 2: Generate & Stream SHACL Shapes</h3>
            <p className="guidance-text">
              Click <strong>Generate SHACL</strong>. The portal immediately switches to Step 2, running concurrent LLM calls in the background:
            </p>
            <Steps items={[
              "Checklist Progress - A real-time checklist shows the generation status of each rule.",
              "Streaming Code Editor - Watch the SHACL Turtle shapes stream directly into the code editor.",
              "Consolidation - Upon completion, the system deduplicates prefixes and presents the final formatted Turtle code. You can copy the code to clipboard or edit it."
            ]} />
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Step 3: Validation Playground</h3>
            <p className="guidance-text">
              Click <strong>Proceed to Playground</strong> to execute validation on the data:
            </p>
            <Steps items={[
              "Validate Against Target - Choose whether to validate against your uploaded files or workspace schemas.",
              "Run Validation - Click \"Run Validation\" to start testing your instance graph against the generated SHACL shapes.",
              "Step-by-Step Status - Observe the parsing and validation progress steps as they resolve.",
              "Detailed Results Table - If violations are found, explore the details (Focus Node, Property, Message, Value) directly in the expandable table to locate data quality errors.",
              "Export PDF - Export the complete validation report as a professional PDF document."
            ]} />
          </div>
        </section>

        {/* My Ontologies */}
        <section id="my-ontologies" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="database" /></span>
            My Ontologies
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Overview</h3>
            <p className="guidance-text">
              The My Ontologies page gives you a personal view of all ontologies you have
              uploaded or have access to. From here, you can manage your ontology collection,
              view metadata and quickly navigate to any ontology's schema view.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Managing Your Collection</h3>
            <Steps items={[
              "Navigate to My Ontologies from the profile menu.",
              "View your list of uploaded ontologies with their details.",
              "Click on any ontology to open it in the Schema Ontology viewer.",
              "Use the action buttons to delete or export ontologies as needed."
            ]} />
          </div>
        </section>

        {/* Account */}
        <section id="account" className="guidance-section">
          <h2 className="guidance-section-title">
            <span className="guidance-section-icon"><Icon name="user" /></span>
            Profile & Account
          </h2>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Editing Your Profile</h3>
            <Steps items={[
              "Click your avatar icon in the top-right corner.",
              "Select \"Profile\" from the dropdown menu.",
              "Update your first name, last name or other details.",
              "Click Save to apply your changes."
            ]} />
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Changing Your Password</h3>
            <Steps items={[
              "Go to your Profile page.",
              "Click the \"Change Password\" or \"Reset Password\" option.",
              "Enter your current password and your new password.",
              "Confirm the new password and click Save."
            ]} />
            <Callout type="info">
              If you've forgotten your password, click "Forgot Password" on the sign-in dialog to receive a reset link via email.
            </Callout>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Signing Out</h3>
            <p className="guidance-text">
              To sign out, click your avatar icon in the top-right corner and select
              "Logout" from the dropdown menu. This will clear your session and redirect
              you to the home page.
            </p>
          </div>

          <div className="guidance-subsection">
            <h3 className="guidance-subsection-title">Schema Change History</h3>
            <p className="guidance-text">
              Your Profile page includes a <strong>Schema Change History</strong> section that
              automatically tracks every save you make in the Canvas Editor. Each entry records
              a version number, a summary of changes (nodes and edges added, removed, or modified),
              and a timestamp. You can filter logs by ontology, expand any entry to inspect the
              granular diff, and delete individual log entries when no longer needed.
            </p>
          </div>
        </section>

      </main>
    </div>
  );
};

export default UserGuidance;
