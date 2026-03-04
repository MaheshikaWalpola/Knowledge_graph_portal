import { Link } from "react-router-dom";
import "./Home.css";

// Use the hero image from public folder
const heroImage = "/hero-kg.png";

const Home = () => {
  return (
    <div className="home-container">
      {/* Hero Section */}
      <div className="home-card">
        <div className="home-content">
          <div className="home-badge">🚀 Semantic Web Technology</div>
          <h1 className="home-title">Knowledge Graph Portal</h1>
          <p className="home-text">
            Explore, visualize, and interact with your semantic knowledge graph.
            Navigate schema entities, relationships, and instance connections in
            a clean and intuitive interface.
          </p>
          <div className="home-cta">
            <Link to="/workspace" className="home-btn-primary">
              <span>Get Started</span>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link to="/graph" className="home-btn-secondary">
              View Ontology
            </Link>
          </div>
        </div>

        <div className="home-image-wrapper">
          <div className="home-image-glow"></div>
          <img
            src={heroImage}
            alt="Knowledge Graph Visualization"
            className="home-image floating"
          />
        </div>
      </div>

      {/* Features Section */}
      <div className="features-section">
        <h2 className="features-title">Powerful Features</h2>
        <p className="features-subtitle">
          Everything you need to manage and explore your knowledge graph
        </p>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </div>
            <h3 className="feature-title">Smart Search</h3>
            <p className="feature-desc">
              Quickly find entities, relationships, and connections across your
              entire knowledge graph.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon feature-icon-blue">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h3 className="feature-title">Schema Ontology</h3>
            <p className="feature-desc">
              Visualize and navigate your ontology structure with an interactive
              graph interface.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon feature-icon-cyan">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <path d="M12 2a10 10 0 1 0 10 10" />
                <path d="M12 12l8-8" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </div>
            <h3 className="feature-title">AI Assistant</h3>
            <p className="feature-desc">
              Get intelligent help with natural language queries and automated
              graph generation.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon feature-icon-green">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
            </div>
            <h3 className="feature-title">Workspace</h3>
            <p className="feature-desc">
              Create, edit, and manage your knowledge graph with a powerful
              visual workspace.
            </p>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="stats-section">
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-number">∞</div>
            <div className="stat-label">Entities</div>
          </div>
          <div className="stat-item">
            <div className="stat-number">RDF</div>
            <div className="stat-label">Compatible</div>
          </div>
          <div className="stat-item">
            <div className="stat-number">AI</div>
            <div className="stat-label">Powered</div>
          </div>
          <div className="stat-item">
            <div className="stat-number">24/7</div>
            <div className="stat-label">Available</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
