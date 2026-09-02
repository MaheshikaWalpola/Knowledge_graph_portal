import React from "react";
import { Link } from "react-router-dom";
import "./Terms.css";

const SECTIONS = [
  {
    id: "preamble",
    number: "1",
    title: "Definitions and Interpretation",
    subsections: [
      {
        num: "1.1",
        heading: "Definitions",
        text: (
          <>
            <p>In these Terms and Conditions (&quot;Terms&quot;), the following capitalized terms shall have the meanings ascribed below:</p>
            <ul className="legal-def-list">
              <li><strong>&quot;Platform&quot; or &quot;Service&quot;</strong> refers to the Knowledge Graph Portal web application, including its graphical canvas editor, ontology manager, instance generation workflow, validation engine, AI assistant services, APIs, and documentation hosted by the Professorship of Distributed and Self-Organizing Systems (VSR) at Chemnitz University of Technology (TU Chemnitz).</li>
              <li><strong>&quot;User&quot;, &quot;you&quot;, or &quot;your&quot;</strong> refers to any individual, researcher, academic student, institutional representative, or entity that accesses, registers for, or interacts with the Platform.</li>
              <li><strong>&quot;User Content&quot;</strong> encompasses all data files, schemas, ontologies (in OWL, RDFS, or custom formats), semantic graphs, RDF triples, SHACL constraints, SPARQL queries, tabular datasets (CSV, JSON, XML), entity mappings, and textual prompts uploaded, created, or managed by you on the Platform.</li>
              <li><strong>&quot;AI Assistant Services&quot;</strong> refers to integrated machine learning and Large Language Model (LLM) interfaces utilized for ontology concept generation, property suggestion, natural language SPARQL query synthesis, and automated semantic mapping.</li>
              <li><strong>&quot;Instance Generation Services&quot;</strong> designates automated and semi-automated pipeline tools for ingesting tabular, structured, or unstructured data and transforming it into RDF instances and knowledge graph structures.</li>
              <li><strong>&quot;Validation Services&quot;</strong> refers to the automated rule validation, syntax checking, and SHACL constraint evaluation engines executed within the Platform.</li>
            </ul>
          </>
        ),
      },
      {
        num: "1.2",
        heading: "Interpretation",
        text: (
          <p>
            Headings and clause titles are inserted for convenience only and do not affect the interpretation or legal validity of any provision. Singular terms include the plural and vice versa where context requires.
          </p>
        ),
      },
    ],
  },
  {
    id: "acceptance-scope",
    number: "2",
    title: "Acceptance of Terms and Scope of Service",
    subsections: [
      {
        num: "2.1",
        heading: "Binding Agreement",
        text: (
          <p>
            By creating an account, browsing the portal, uploading datasets, manipulating graph canvases, or invoking automated services, you acknowledge that you have read, understood, and agree to be legally bound by these Terms. If you do not accept all provisions without limitation, you are expressly prohibited from using the Platform.
          </p>
        ),
      },
      {
        num: "2.2",
        heading: "Institutional and Corporate Authority",
        text: (
          <p>
            If you access or use the Platform on behalf of a university, research institute, company, or other legal entity, you represent and warrant that you possess full legal authority to bind such entity to these Terms. In such case, &quot;User&quot; and &quot;you&quot; shall refer collectively to you individually and to that entity.
          </p>
        ),
      },
      {
        num: "2.3",
        heading: "Academic and Educational Context",
        text: (
          <p>
            The Platform is provided as an academic research and educational portal developed to advance state-of-the-art research in semantic web technologies, knowledge graphs, and ontology engineering. The Service is provided free of charge for non-commercial research, academic exploration, and higher education purposes.
          </p>
        ),
      },
    ],
  },
  {
    id: "account-registration",
    number: "3",
    title: "User Accounts, Authentication, and Security",
    subsections: [
      {
        num: "3.1",
        heading: "Registration and Verification",
        text: (
          <p>
            Access to persistent features (including saving ontologies, viewing personal workspace graphs, executing background instance generation, and accessing AI assistance) requires the registration of a verified user account. You agree to provide true, accurate, current, and complete registration information and to verify your email address via our activation procedure.
          </p>
        ),
      },
      {
        num: "3.2",
        heading: "Credential Security",
        text: (
          <p>
            You are solely responsible for maintaining the confidentiality of your account credentials, password, and session access tokens. You accept full responsibility for all activities that occur under your account credentials. You must notify platform administrators immediately at <code>vsr-support@tu-chemnitz.de</code> upon discovering any unauthorized use or security compromise.
          </p>
        ),
      },
      {
        num: "3.3",
        heading: "Single-User Policy",
        text: (
          <p>
            Each registered account is strictly non-transferable and designated for individual use. Account credentials and API access tokens must not be shared, pooled, or assigned to third parties without prior authorization.
          </p>
        ),
      },
    ],
  },
  {
    id: "intellectual-property",
    number: "4",
    title: "Intellectual Property Rights and Licensing",
    subsections: [
      {
        num: "4.1",
        heading: "Ownership of User Content",
        text: (
          <p>
            You retain full, unencumbered ownership of all intellectual property rights, copyrights, and database rights in and to your original User Content, including custom ontology schemas, custom taxonomy hierarchies, uploaded tabular datasets, and generated RDF graphs. Nothing in these Terms transfers ownership of your proprietary datasets or research work to us.
          </p>
        ),
      },
      {
        num: "4.2",
        heading: "Limited Operational License Granted by User",
        text: (
          <p>
            By uploading, creating, or processing User Content on the Platform, you grant us a worldwide, non-exclusive, royalty-free, limited license solely to store, host, parse, transmit, render, compute, validate, and display such content for the technical purpose of providing and operating the Platform services to you.
          </p>
        ),
      },
      {
        num: "4.3",
        heading: "Platform Intellectual Property",
        text: (
          <p>
            All intellectual property rights in the Platform—including but not limited to the user interface, design systems, algorithms, source code, visual canvas layout engines, validation scripts, logos, and documentation—remain the exclusive property of the Professorship VSR at Chemnitz University of Technology and its respective licensors.
          </p>
        ),
      },
      {
        num: "4.4",
        heading: "Open Standard Vocabularies",
        text: (
          <p>
            Publicly referenced or imported semantic vocabularies (e.g., Schema.org, FOAF, Dublin Core, SKOS, W3C standards) remain subject to their respective open-access and open-source licenses.
          </p>
        ),
      },
    ],
  },
  {
    id: "ai-services",
    number: "5",
    title: "AI-Assisted Services and Automated Operations",
    subsections: [
      {
        num: "5.1",
        heading: "Advisory Nature of AI Outputs",
        text: (
          <p>
            The Platform incorporates artificial intelligence and Large Language Models to assist in ontology modeling, class/property recommendations, natural language SPARQL query synthesis, and entity extraction. You expressly acknowledge that all AI-generated outputs are probabilistic, advisory recommendations provided on an &quot;as-is&quot; basis.
          </p>
        ),
      },
      {
        num: "5.2",
        heading: "Human Verification Requirement",
        text: (
          <p>
            You are solely responsible for reviewing, testing, verifying, and confirming the logical consistency, domain accuracy, and factual validity of any AI-assisted suggestions or generated SPARQL queries prior to deploying them in research publications, production databases, or critical decision-making systems.
          </p>
        ),
      },
      {
        num: "5.3",
        heading: "Prompt Input Restrictions",
        text: (
          <p>
            You agree not to input into AI assistant features any sensitive personally identifiable data (PII), confidential proprietary trade secrets, classified military information, or data subject to export control regulations.
          </p>
        ),
      },
    ],
  },
  {
    id: "instance-generation",
    number: "6",
    title: "Instance Generation and Data Ingestion",
    subsections: [
      {
        num: "6.1",
        heading: "Data Provenance and Lawfulness",
        text: (
          <p>
            When utilizing the Instance Generation Workflow to convert tabular files (CSV, JSON, XML, TSV) or unstructured text into RDF triples, you warrant that you hold all necessary rights, licenses, and authorizations to upload and process such data.
          </p>
        ),
      },
      {
        num: "6.2",
        heading: "Prohibition of Sensitive Personal Data",
        text: (
          <p>
            You must not upload data containing protected health information, financial account numbers, passwords, biometric records, or special categories of personal data as defined under Article 9 of the EU General Data Protection Regulation (GDPR) without explicit lawful authorization and appropriate anonymization.
          </p>
        ),
      },
      {
        num: "6.3",
        heading: "Transient Processing and Export",
        text: (
          <p>
            Raw uploaded data files are processed transiently to produce ontology-aligned triples. You may export generated RDF datasets in standardized semantic formats (Turtle/TTL, JSON-LD, RDF/XML, N-Triples) at any time through the export utilities provided in the user interface.
          </p>
        ),
      },
    ],
  },
  {
    id: "validation-reasoning",
    number: "7",
    title: "Graph Validation and Reasoning Services",
    subsections: [
      {
        num: "7.1",
        heading: "Scope of Validation Engines",
        text: (
          <p>
            The Platform provides automated structural, syntax, and SHACL constraint validation engines. Validation outputs, violation diagnostics, and repair suggestions represent computational heuristics based on W3C specifications and designated shape constraints.
          </p>
        ),
      },
      {
        num: "7.2",
        heading: "No Guarantee of Domain Completeness",
        text: (
          <p>
            While validation engines verify structural schema compliance, we do not warrant that a passing validation result guarantees absolute semantic soundness, completeness, or ontological fitness for specific empirical applications.
          </p>
        ),
      },
      {
        num: "7.3",
        heading: "Computational Quotas and Limits",
        text: (
          <p>
            To maintain shared server availability, the Platform enforces reasonable computational limits, timeouts, and graph triple thresholds on validation runs and reasoning tasks. Excessive execution cycles may be throttled or automatically terminated.
          </p>
        ),
      },
    ],
  },
  {
    id: "acceptable-use",
    number: "8",
    title: "Acceptable Use Policy and Prohibited Conduct",
    subsections: [
      {
        num: "8.1",
        heading: "Prohibited Actions",
        text: (
          <>
            <p>You agree not to use the Platform to:</p>
            <ul className="legal-clause-list">
              <li>Engage in, facilitate, or promote illegal, unlawful, fraudulent, or defamatory activities.</li>
              <li>Perform denial-of-service (DoS) attacks, automated rapid-fire querying, SPARQL Cartesian product attacks, or deliberate resource exhaustion on backend endpoints.</li>
              <li>Upload files containing malicious code, viruses, corrupted schemas, XSS payloads, or automated exploits designed to compromise server infrastructure.</li>
              <li>Probe, scan, reverse-engineer, decompile, or attempt to circumvent security, authentication, or rate-limiting protocols of the application.</li>
              <li>Execute unauthorized bulk web scraping, crawling, or automated data extraction of private user repositories.</li>
              <li>Infringe upon the patents, trademarks, copyrights, or other intellectual property rights of any party.</li>
            </ul>
          </>
        ),
      },
      {
        num: "8.2",
        heading: "Remedial Action",
        text: (
          <p>
            Failure to adhere to this Acceptable Use Policy constitutes a material breach of these Terms, entitling the Platform administrators to immediately terminate account access, remove non-compliant content, and notify institutional or law enforcement authorities where warranted.
          </p>
        ),
      },
    ],
  },
  {
    id: "third-party-links",
    number: "9",
    title: "Third-Party Services and Linked Open Data",
    subsections: [
      {
        num: "9.1",
        heading: "External Repositories",
        text: (
          <p>
            The Platform provides lookup connectors and SPARQL federation capabilities with external semantic web databases (including Wikidata, DBpedia, and Linked Open Vocabularies). We do not control, endorse, or assume liability for the availability, content, accuracy, or uptime of third-party endpoints.
          </p>
        ),
      },
      {
        num: "9.2",
        heading: "External License Compliance",
        text: (
          <p>
            Users are solely responsible for reviewing and adhering to the specific licensing, query restrictions, and attribution requirements imposed by external third-party data providers.
          </p>
        ),
      },
    ],
  },
  {
    id: "service-availability",
    number: "10",
    title: "Service Availability, Maintenance, and Backups",
    subsections: [
      {
        num: "10.1",
        heading: "Availability and Maintenance",
        text: (
          <p>
            The Platform is provided on a best-effort academic basis. While we strive to maintain uninterrupted availability, we do not guarantee continuous, error-free, or permanent service. The Platform may be temporarily unavailable for scheduled maintenance, database upgrades, or hardware maintenance.
          </p>
        ),
      },
      {
        num: "10.2",
        heading: "User Backup Responsibility",
        text: (
          <p>
            Although standard system snapshots are performed, you are strongly advised to regularly export and maintain independent local backups of your critical ontologies, graph schemas, and datasets. The Platform is not liable for data loss resulting from server failures, corruption, or unforeseen system outages.
          </p>
        ),
      },
    ],
  },
  {
    id: "disclaimer-warranties",
    number: "11",
    title: "Disclaimer of Warranties",
    subsections: [
      {
        num: "11.1",
        heading: "AS-IS PROVISION",
        text: (
          <div className="legal-emphasis-box">
            <p>
              TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE PLATFORM, ITS SOFTWARE, CANVASES, GRAPH ENGINES, AI ASSISTANTS, VALIDATION TOOLS, APIS, AND ALL CONTENT ARE PROVIDED STRICTLY ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE.
            </p>
            <p>
              THE PROFESSORSHIP VSR AND CHEMNITZ UNIVERSITY OF TECHNOLOGY SPECIFICALLY DISCLAIM ALL IMPLIED WARRANTIES, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, ACCURACY, NON-INFRINGEMENT, AND FREEDOM FROM PROGRAM ERRORS OR INTERRUPTION.
            </p>
          </div>
        ),
      },
    ],
  },
  {
    id: "limitation-liability",
    number: "12",
    title: "Limitation of Liability",
    subsections: [
      {
        num: "12.1",
        heading: "EXCLUSION OF CONSEQUENTIAL DAMAGES",
        text: (
          <div className="legal-emphasis-box">
            <p>
              IN NO EVENT SHALL CHEMNITZ UNIVERSITY OF TECHNOLOGY, THE PROFESSORSHIP OF DISTRIBUTED AND SELF-ORGANIZING SYSTEMS (VSR), ITS PROFESSORS, RESEARCHERS, EMPLOYEES, AGENTS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF DATA, LOSS OF RESEARCH RESULTS, BUSINESS INTERRUPTION, REPUTATIONAL DAMAGE, OR COMPUTATIONAL COSTS, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OR INABILITY TO USE THE PLATFORM.
            </p>
            <p>
              TO THE EXTENT PERMITTED UNDER GERMAN LAW, OUR TOTAL AGGREGATE LIABILITY ARISING FROM OR RELATED TO THESE TERMS SHALL BE LIMITED TO THE AMOUNT OF ZERO EUROS (€0.00), GIVEN THAT THE SERVICE IS OFFERED WITHOUT REMUNERATION AS AN ACADEMIC RESEARCH SERVICE.
            </p>
          </div>
        ),
      },
    ],
  },
  {
    id: "indemnification",
    number: "13",
    title: "Indemnification",
    subsections: [
      {
        num: "13.1",
        heading: "Indemnification Obligation",
        text: (
          <p>
            You agree to defend, indemnify, and hold harmless Chemnitz University of Technology, the Professorship VSR, and their respective faculty, researchers, and developers from and against any claims, liabilities, damages, losses, costs, or expenses (including reasonable legal fees) arising out of: (a) your violation of these Terms; (b) your User Content or datasets uploaded to the Platform; or (c) your infringement of third-party intellectual property or privacy rights.
          </p>
        ),
      },
    ],
  },
  {
    id: "termination",
    number: "14",
    title: "Suspension, Termination, and Account Deactivation",
    subsections: [
      {
        num: "14.1",
        heading: "Termination by User",
        text: (
          <p>
            You may deactivate your account and terminate your relationship with the Platform at any time through your Profile settings or by contacting administrator support. Upon deactivation, your personal identifiers and private ontology records will be removed in accordance with our data retention schedule.
          </p>
        ),
      },
      {
        num: "14.2",
        heading: "Suspension and Termination by Platform",
        text: (
          <p>
            We reserve the right to suspend, restrict, or terminate your access to the Platform at any time, with or without prior notice, if we reasonably determine that you have breached these Terms, engaged in abusive system behavior, or if required to do so by legal or academic obligations.
          </p>
        ),
      },
    ],
  },
  {
    id: "data-privacy-gdpr",
    number: "15",
    title: "Data Protection and GDPR Compliance",
    subsections: [
      {
        num: "15.1",
        heading: "European Data Protection Framework",
        text: (
          <p>
            The Platform adheres strictly to the <strong>General Data Protection Regulation (EU) 2016/679 (GDPR / DSGVO)</strong> and the <strong>German Federal Data Protection Act (BDSG)</strong>.
          </p>
        ),
      },
      {
        num: "15.2",
        heading: "Data Minimization and Processing",
        text: (
          <p>
            We collect and process only minimal necessary personal data (name, email address, cryptographic password hash) strictly for account authentication, access security, and workspace association. We never sell, lease, or monetize user personal data.
          </p>
        ),
      },
      {
        num: "15.3",
        heading: "Data Subject Rights",
        text: (
          <p>
            Under GDPR, you retain the right to request access to, rectification of, portability of, and erasure of your personal data stored within the Platform. Requests can be submitted directly to our institutional contact.
          </p>
        ),
      },
    ],
  },
  {
    id: "governing-law",
    number: "16",
    title: "Governing Law and Dispute Resolution",
    subsections: [
      {
        num: "16.1",
        heading: "Jurisdiction",
        text: (
          <p>
            These Terms, their subject matter, and their formation shall be governed by and construed exclusively in accordance with the substantive laws of the <strong>Federal Republic of Germany</strong>, without giving effect to any principles of conflicts of law.
          </p>
        ),
      },
      {
        num: "16.2",
        heading: "Place of Jurisdiction",
        text: (
          <p>
            To the extent permitted by law, the courts of <strong>Chemnitz, Saxony, Germany</strong> shall have exclusive jurisdiction over any disputes, controversies, or claims arising out of or relating to these Terms or your use of the Platform.
          </p>
        ),
      },
    ],
  },
  {
    id: "amendments-misc",
    number: "17",
    title: "Amendments and Miscellaneous Provisions",
    subsections: [
      {
        num: "17.1",
        heading: "Amendments to Terms",
        text: (
          <p>
            We reserve the right to revise or update these Terms periodically to reflect evolving research standards, technical modifications, or legislative amendments. The date of the latest revision will always be displayed at the top of this document. Your continued use of the Platform after the effective date of revised Terms constitutes your full acceptance thereof.
          </p>
        ),
      },
      {
        num: "17.2",
        heading: "Severability",
        text: (
          <p>
            If any provision of these Terms is held to be invalid, unlawful, or unenforceable by a court of competent jurisdiction, such provision shall be severed or modified to the minimum extent necessary, and the remaining provisions shall continue in full force and effect.
          </p>
        ),
      },
      {
        num: "17.3",
        heading: "Entire Agreement",
        text: (
          <p>
            These Terms, along with any referenced user guidance and privacy notifications, constitute the entire agreement between you and the Platform regarding the subject matter herein.
          </p>
        ),
      },
    ],
  },
  {
    id: "contact-information",
    number: "18",
    title: "Institutional Contact and Inquiries",
    subsections: [
      {
        num: "18.1",
        heading: "Official Contact Coordinates",
        text: (
          <div className="legal-contact-block">
            <p><strong>Professorship of Distributed and Self-Organizing Systems (VSR)</strong></p>
            <p>Faculty of Computer Science</p>
            <p>Chemnitz University of Technology (Technische Universität Chemnitz)</p>
            <p>Straße der Nationen 62, 09111 Chemnitz, Germany</p>
            <p>
              <strong>Electronic Mail:</strong>{" "}
              <a href="mailto:vsr-support@tu-chemnitz.de" className="legal-link">
                vsr-support@tu-chemnitz.de
              </a>
            </p>
            <p>
              <strong>Institutional Website:</strong>{" "}
              <a href="https://www.tu-chemnitz.de/informatik/DVS/" target="_blank" rel="noopener noreferrer" className="legal-link">
                https://www.tu-chemnitz.de/informatik/DVS/
              </a>
            </p>
          </div>
        ),
      },
    ],
  },
];

const Terms = () => {
  return (
    <div className="terms-container">
      <div className="terms-card">
        {/* Component Header matching portal style */}
        <div className="terms-header">
          <div className="terms-header-left">
            <h1 className="terms-title">Terms and Conditions</h1>
            <p className="terms-subtitle">
              Legal agreement and service conditions governing access to the Knowledge Graph Portal (VSR - Chemnitz University of Technology).
            </p>
          </div>
        </div>

        {/* Meta Strip */}
        <div className="terms-meta-strip">
          <div className="terms-meta-col">
            <span className="meta-term">Effective Date</span>
            <span className="meta-val">January 1, 2026</span>
          </div>
          <div className="terms-meta-col">
            <span className="meta-term">Last Revised</span>
            <span className="meta-val">September 2026</span>
          </div>
          <div className="terms-meta-col">
            <span className="meta-term">Version</span>
            <span className="meta-val">2.4 (Academic Release)</span>
          </div>
          <div className="terms-meta-col">
            <span className="meta-term">Applicable Law</span>
            <span className="meta-val">Federal Republic of Germany / EU</span>
          </div>
        </div>

        {/* Notice Box */}
        <div className="terms-preamble-box">
          <p>
            <strong>IMPORTANT NOTICE:</strong> Please review these Terms thoroughly before using the Platform. Your access to and continued use of the Knowledge Graph Portal constitutes binding acceptance of all provisions, covenants, disclaimers, and guidelines set forth below.
          </p>
        </div>

        {/* Legal Text Document Content */}
        <div className="terms-content">
          {SECTIONS.map((sec) => (
            <section key={sec.id} id={sec.id} className="terms-section">
              <h2 className="terms-section-title">
                <span className="terms-section-num">{sec.number}.</span> {sec.title}
              </h2>

              <div className="terms-section-subsections">
                {sec.subsections.map((sub, idx) => (
                  <div key={idx} className="terms-subsection">
                    <h3 className="terms-subsection-heading">
                      <span className="terms-sub-num">{sub.num}</span> {sub.heading}
                    </h3>
                    <div className="terms-subsection-body">{sub.text}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Closing Signature Block */}
        <div className="terms-footer-block">
          <div className="terms-footer-text">
            <p>
              <strong>Knowledge Graph Portal</strong> &bull; Developed by the Professorship of Distributed and Self-Organizing Systems (VSR), Chemnitz University of Technology.
            </p>
            <p>
              For official inquiries regarding these Terms or institutional academic agreements, please reach out to <a href="mailto:vsr-support@tu-chemnitz.de" className="terms-link">vsr-support@tu-chemnitz.de</a>.
            </p>
          </div>
          <div className="terms-footer-nav">
            <Link to="/" className="terms-footer-btn">Return to Home</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Terms;