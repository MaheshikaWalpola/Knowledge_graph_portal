import { useEffect, useRef, useState } from "react";
import axios from "axios";
import "./AIAssistance.css";

const API = import.meta.env.VITE_API_URL;

// Quick reply suggestions based on context
const QUICK_REPLIES = {
  default: [
    "What classes are in the ontology?",
    "Show me all process variables",
    "What are the main relationships?",
    "Explain the schema structure",
  ],
  afterResponse: [
    "Tell me more",
    "Show related classes",
    "Give me an example",
    "What are its properties?",
  ],
  afterError: [
    "Try a simpler query",
    "What can you help with?",
    "List available entities",
  ],
};

export default function AIAssistance() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I'm your Knowledge Graph assistant. Ask me about the ontology, classes, relationships, or instances.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [quickReplies, setQuickReplies] = useState(QUICK_REPLIES.default);
  const bottomRef = useRef(null);

  // light | dark
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("ai_theme") || "light";
  });

  useEffect(() => {
    localStorage.setItem("ai_theme", theme);
  }, [theme]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleQuickReply = (reply) => {
    setInput(reply);
    // Auto-send the quick reply
    sendMessage(reply);
  };

  const sendMessage = async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;

    const nextMessages = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setQuickReplies([]); // Hide quick replies while loading

    try {
      const res = await axios.post(
        `${API}/assistant/chat`,
        { messages: nextMessages },
        { headers: { "Content-Type": "application/json" } },
      );

      const answer = res.data?.answer ?? "No answer returned.";

      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);

      // Show contextual quick replies after successful response
      setQuickReplies(QUICK_REPLIES.afterResponse);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            e?.response?.data?.detail ||
            e?.message ||
            "Error calling the assistant API.",
        },
      ]);

      // Show error-related quick replies
      setQuickReplies(QUICK_REPLIES.afterError);
    } finally {
      setLoading(false);
    }
  };

  const send = () => sendMessage(input);

  return (
    <div className={`ai-container theme-${theme}`}>
      <div className="ai-card">
        <div className="ai-header ai-header-row">
          <div>
            <h2 className="ai-title">AI Assistant</h2>
            <p className="ai-subtitle">
              Ask questions about your knowledge graph
            </p>
          </div>

          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title="Toggle theme"
          >
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>

        <div className="chat-shell">
          <div className="chat-body">
            {messages.map((m, i) => (
              <div key={i} className={`chat-row ${m.role}`}>
                <div className="bubble">
                  <div className="bubble-content">{m.content}</div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-row assistant">
                <div className="bubble">
                  <span className="typing">
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                  </span>
                </div>
              </div>
            )}

            {/* Quick Replies */}
            {!loading && quickReplies.length > 0 && (
              <div className="quick-replies">
                {quickReplies.map((reply, idx) => (
                  <button
                    key={idx}
                    className="quick-reply-btn"
                    onClick={() => handleQuickReply(reply)}
                  >
                    {reply}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="chat-footer">
            <input
              className="chat-input"
              placeholder="Ask a question about the knowledge graph…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />

            <button className="chat-send" onClick={send} disabled={loading}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
