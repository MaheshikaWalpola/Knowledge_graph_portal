import { useEffect, useRef, useState } from "react";
import axios from "axios";
import "./AIAssistance.css";

const API = import.meta.env.VITE_API_URL;

// Quick reply suggestions based on context
const QUICK_REPLIES = {
  default: [
    "List available ontologies",
    "What classes are in [ontology name]?",
    "Show relationships in [ontology name]",
    "What process variables exist?",
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

const INITIAL_MESSAGE = {
  role: "assistant",
  content:
    "Hi! I'm your Knowledge Graph assistant.\n\nAsk me general questions, or mention an ontology name to explore its classes, properties, relationships, instances, and process variables using graph-grounded answers.\n\nTry:\n• List available ontologies\n• What classes are in [ontology name]?\n• Show relationships in [ontology name]",
};

export default function AIAssistance() {
  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem("kg_chats");
    return saved ? JSON.parse(saved) : [{ id: 1, title: "Chat 1", messages: [INITIAL_MESSAGE] }];
  });
  
  const [currentChatId, setCurrentChatId] = useState(() => {
    const saved = localStorage.getItem("kg_current_chat");
    return saved ? parseInt(saved) : 1;
  });
  
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [quickReplies, setQuickReplies] = useState(QUICK_REPLIES.default);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bottomRef = useRef(null);

  // light | dark
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("ai_theme") || "light";
  });

  const currentChat = chats.find((c) => c.id === currentChatId) || chats[0];
  const messages = currentChat?.messages || [];

  // Save chats to localStorage
  useEffect(() => {
    localStorage.setItem("kg_chats", JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem("ai_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("kg_current_chat", currentChatId.toString());
  }, [currentChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleQuickReply = (reply) => {
    setInput(reply);
    sendMessage(reply);
  };

  const sendMessage = async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;

    const nextMessages = [...messages, { role: "user", content: trimmed }];
    updateCurrentChat(nextMessages);
    setInput("");
    setLoading(true);
    setQuickReplies([]);

    try {
      const res = await axios.post(
        `${API}/assistant/chat`,
        { messages: nextMessages },
        { headers: { "Content-Type": "application/json" } },
      );

      const answer = res.data?.answer ?? "No answer returned.";
      const options = res.data?.options || [];

      updateCurrentChat((prev) => [
        ...prev,
        { role: "assistant", content: answer },
      ]);

      if (options.length > 0) {
        setQuickReplies(options);
      } else {
        setQuickReplies(QUICK_REPLIES.afterResponse);
      }
    } catch (e) {
      updateCurrentChat((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            e?.response?.data?.detail ||
            e?.message ||
            "Error calling the assistant API.",
        },
      ]);
      setQuickReplies(QUICK_REPLIES.afterError);
    } finally {
      setLoading(false);
    }
  };

  const updateCurrentChat = (newMessages) => {
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === currentChatId
          ? { ...chat, messages: typeof newMessages === "function" ? newMessages(chat.messages) : newMessages }
          : chat
      )
    );
  };

  const handleNewChat = () => {
    const newId = Math.max(...chats.map((c) => c.id), 0) + 1;
    const newChat = {
      id: newId,
      title: `Chat ${newId}`,
      messages: [INITIAL_MESSAGE],
    };
    setChats([...chats, newChat]);
    setCurrentChatId(newId);
    setQuickReplies(QUICK_REPLIES.default);
  };

  const handleDeleteChat = (chatId) => {
    if (chats.length === 1) {
      alert("You must keep at least one chat");
      return;
    }
    const remaining = chats.filter((c) => c.id !== chatId);
    setChats(remaining);
    if (currentChatId === chatId) {
      setCurrentChatId(remaining[0].id);
    }
  };

  const send = () => sendMessage(input);

  return (
    <div className={`ai-workspace theme-${theme}`}>
      {/* Sidebar */}
      <div className={`ai-sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <button
            type="button"
            className="new-chat-btn"
            onClick={handleNewChat}
            title="Start new chat"
          >
            <span className="plus-icon">+</span>
            <span className="btn-text">New Chat</span>
          </button>

          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {sidebarOpen ? "✕" : "☰"}
          </button>
        </div>

        <div className="chats-list">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`chat-item ${currentChatId === chat.id ? "active" : ""}`}
              onClick={() => setCurrentChatId(chat.id)}
            >
              <span className="chat-title">{chat.title}</span>
              <button
                type="button"
                className="delete-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteChat(chat.id);
                }}
                title="Delete chat"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className="settings-icon-btn"
            onClick={() => setSettingsOpen(true)}
            title="Open settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {settingsOpen && (
        <>
          <div className="settings-overlay" onClick={() => setSettingsOpen(false)} />
          <div className="settings-panel">
            <div className="settings-header">
              <h2>Settings</h2>
              <button
                type="button"
                className="settings-close-btn"
                onClick={() => setSettingsOpen(false)}
                title="Close settings"
              >
                ✕
              </button>
            </div>
            <div className="settings-content">
              <div className="settings-group">
                <label className="settings-label">Theme</label>
                <div className="settings-option">
                  <button
                    type="button"
                    className={`theme-option ${theme === "light" ? "active" : ""}`}
                    onClick={() => setTheme("light")}
                  >
                    ☀️ Light
                  </button>
                  <button
                    type="button"
                    className={`theme-option ${theme === "dark" ? "active" : ""}`}
                    onClick={() => setTheme("dark")}
                  >
                    🌙 Dark
                  </button>
                </div>
              </div>
              <div className="settings-group">
                <label className="settings-label">Quick Actions</label>
                <div className="settings-info">
                  <p>Clear chat history: <span className="info-text">Start fresh with new conversations</span></p>
                </div>
              </div>
              <div className="settings-group">
                <label className="settings-label">About</label>
                <p className="settings-about">Knowledge Graph Assistant v1.0</p>
              </div>
            </div>
          </div>
        </>
      )}
      </div>

      {/* Main Chat Area */}
      <div className="ai-main">
        <div className="ai-card">
          <div className="ai-header">
            <div className="header-content">
              <h1 className="ai-title">Knowledge Graph Assistant</h1>
              <p className="ai-subtitle">Ask questions about your ontology</p>
            </div>
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
                  {quickReplies.map((reply, idx) => {
                    const safeReply = typeof reply === "string" ? reply : reply?.option || reply?.name || JSON.stringify(reply);
                    return (
                      <button
                        key={idx}
                        className="quick-reply-btn"
                        onClick={() => handleQuickReply(safeReply)}
                      >
                        {safeReply}
                      </button>
                    );
                  })}
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

      {/* Mobile Sidebar Toggle */}
      {!sidebarOpen && (
        <button
          type="button"
          className="mobile-sidebar-toggle"
          onClick={() => setSidebarOpen(true)}
          title="Open sidebar"
        >
          ☰
        </button>
      )}
    </div>
  );
}
