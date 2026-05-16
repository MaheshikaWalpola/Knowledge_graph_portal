import { useEffect, useRef, useState } from "react";
import axios from "axios";
import "./AIAssistance.css";

const API = import.meta.env.VITE_API_URL;

const INITIAL_MESSAGE = {
  role: "assistant",
  content:
    "Hi! I'm your Knowledge Graph assistant.\n\nAsk me general questions, or ask about any ontology you have uploaded. For graph-specific answers, mention the ontology or graph name so I can explore its classes, properties, relationships, instances, and process variables using graph-grounded data.",
};

// Version key — bump to clear stale localStorage
const CHAT_VERSION = "v4";

// Generate a unique ID
const genId = () => Date.now() + Math.random();

export default function AIAssistance({ onOpenAuth }) {
  // ── Auth gate (same pattern as Workspace) ─────────────────────────
  const token = localStorage.getItem("token");

  // ── State ──
  const [chats, setChats] = useState(() => {
    try {
      const ver = localStorage.getItem("kg_chats_version");
      const raw = localStorage.getItem("kg_chats");
      if (ver !== CHAT_VERSION || !raw) {
        localStorage.setItem("kg_chats_version", CHAT_VERSION);
        return [{ id: 1, title: "Conversation 1", messages: [INITIAL_MESSAGE], saved: true }];
      }
      const parsed = JSON.parse(raw);
      return parsed.map((c) => ({
        ...c,
        saved: c.saved !== false,
        messages: c.messages?.length ? c.messages : [INITIAL_MESSAGE],
      }));
    } catch {
      return [{ id: 1, title: "Conversation 1", messages: [INITIAL_MESSAGE], saved: true }];
    }
  });

  const [currentChatId, setCurrentChatId] = useState(() => {
    const raw = localStorage.getItem("kg_current_chat");
    return raw ? parseInt(raw) : 1;
  });

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Rename state: { id, value }
  const [renaming, setRenaming] = useState(null);
  const renameInputRef = useRef(null);
  const bottomRef = useRef(null);

  // ── Derived 
  // Only show saved conversations in the sidebar list
  const savedChats = chats.filter((c) => c.saved);
  const currentChat = chats.find((c) => c.id === currentChatId) || chats[0];
  const messages = currentChat?.messages || [];

  // Track message count & loading to detect NEW arrivals (not initial load).
  // Refs survive React Strict-Mode’s double-invoke so this is reliable in dev too.
  const prevMsgCountRef = useRef(messages.length);
  const prevLoadingRef  = useRef(false);

  // ── Persistence 
  useEffect(() => {
    localStorage.setItem("kg_chats", JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem("kg_current_chat", currentChatId.toString());
  }, [currentChatId]);

  // Only scroll when a new message is added or the typing indicator appears.
  // Using message count (not the array reference) avoids false triggers.
  useEffect(() => {
    const msgAdded     = messages.length > prevMsgCountRef.current;
    const typingStarted = loading && !prevLoadingRef.current;
    prevMsgCountRef.current = messages.length;
    prevLoadingRef.current  = loading;
    if (msgAdded || typingStarted) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, loading]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  // ── Helpers 
  const updateCurrentChat = (newMessages) => {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === currentChatId
          ? {
              ...chat,
              messages:
                typeof newMessages === "function"
                  ? newMessages(chat.messages)
                  : newMessages,
            }
          : chat
      )
    );
  };

  // ── Send message 
  const sendMessage = async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;

    // If this is an unsaved (new/empty) chat, mark it as saved now
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === currentChatId ? { ...chat, saved: true } : chat
      )
    );

    const nextMessages = [...messages, { role: "user", content: trimmed }];
    updateCurrentChat(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await axios.post(
        `${API}/assistant/chat`,
        { messages: nextMessages },
        { headers: { "Content-Type": "application/json" } }
      );

      const answer = res.data?.answer ?? "No answer returned.";
      updateCurrentChat((prev) => [
        ...prev,
        { role: "assistant", content: answer },
      ]);
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
    } finally {
      setLoading(false);
    }
  };

  const send = () => sendMessage(input);

  // ── New chat ───
  const handleNewChat = () => {
    const newId = genId();
    const newIndex = chats.length + 1;
    setChats((prev) => [
      ...prev,
      {
        id: newId,
        title: `Conversation ${newIndex}`,
        messages: [INITIAL_MESSAGE],
        saved: false, // not shown in sidebar until first message
      },
    ]);
    setCurrentChatId(newId);
    setSidebarOpen(false);
  };

  // ── Delete chat 
  const handleDeleteChat = (e, chatId) => {
    e.stopPropagation();
    const remaining = chats.filter((c) => c.id !== chatId);

    if (remaining.length === 0) {
      // All deleted → create a brand-new unsaved chat
      const freshId = genId();
      const freshChat = {
        id: freshId,
        title: "Conversation 1",
        messages: [INITIAL_MESSAGE],
        saved: false,
      };
      setChats([freshChat]);
      setCurrentChatId(freshId);
    } else {
      setChats(remaining);
      if (currentChatId === chatId) {
        setCurrentChatId(remaining[remaining.length - 1].id);
      }
    }
  };

  // ── Rename ─
  const startRename = (e, chatId, currentTitle) => {
    e.stopPropagation();
    setRenaming({ id: chatId, value: currentTitle });
  };

  const commitRename = () => {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    if (trimmed) {
      setChats((prev) =>
        prev.map((c) => (c.id === renaming.id ? { ...c, title: trimmed } : c))
      );
    }
    setRenaming(null);
  };

  const cancelRename = () => setRenaming(null);

  // ── Auth gate — pop the login dialog for guests, same as CanvasEditor ──
  useEffect(() => {
    if (!token) onOpenAuth?.();
  }, [token, onOpenAuth]);

  if (!token) return null; // AuthDialog is already open; nothing else to render

  // ── Render ──
  return (
    <div className="ai-workspace theme-light">

      {/* ── Conversations Sidebar ─────────────────────────────── */}
      <div className={`ai-sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <button
            type="button"
            className="new-chat-btn"
            onClick={handleNewChat}
            title="Start new conversation"
          >
            <span className="plus-icon">+</span>
            <span className="btn-text">New Conversation</span>
          </button>

          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(false)}
            title="Close panel"
            aria-label="Close conversations panel"
          >
            ✕
          </button>
        </div>

        <div className="chats-list">
          {savedChats.length === 0 && (
            <p className="chats-empty">No conversations yet. Start chatting!</p>
          )}

          {savedChats.map((chat) =>
            renaming?.id === chat.id ? (
              /* ── Inline rename input ── */
              <div key={chat.id} className="chat-item renaming">
                <input
                  ref={renameInputRef}
                  className="rename-input"
                  value={renaming.value}
                  onChange={(e) =>
                    setRenaming((r) => ({ ...r, value: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") cancelRename();
                  }}
                  onBlur={commitRename}
                  maxLength={60}
                />
              </div>
            ) : (
              /* ── Normal chat row ── */
              <div
                key={chat.id}
                className={`chat-item ${currentChatId === chat.id ? "active" : ""}`}
                onClick={() => {
                  setCurrentChatId(chat.id);
                  setSidebarOpen(false);
                }}
              >
                <span className="chat-title">{chat.title}</span>

                <div className="chat-item-actions">
                  {/* Rename button */}
                  <button
                    type="button"
                    className="chat-action-btn rename-btn"
                    onClick={(e) => startRename(e, chat.id, chat.title)}
                    title="Rename conversation"
                    aria-label="Rename conversation"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>

                  {/* Delete button */}
                  <button
                    type="button"
                    className="chat-action-btn delete-btn"
                    onClick={(e) => handleDeleteChat(e, chat.id)}
                    title="Delete conversation"
                    aria-label="Delete conversation"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Overlay — close sidebar on outside click */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main Chat Card  */}
      <div className="ai-main">
        <div className="ai-card">

          {/* Header */}
          <div className="ai-header">
            <div className="header-content">
              <h1 className="ai-title">Knowledge Graph Assistant</h1>
              <p className="ai-subtitle">Ask questions about your ontology</p>
            </div>

            <button
              type="button"
              className="header-settings-btn"
              onClick={() => setSidebarOpen(true)}
              title="Manage conversations"
              aria-label="Open conversations panel"
            >
              {/* Settings icon — opens the conversations sidebar */}
              <svg
                width="20" height="20" viewBox="0 0 24 24"
                fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>

          {/* Chat shell */}
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
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input footer */}
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

              <button
                className="chat-send"
                onClick={send}
                disabled={loading}
                title="Send message"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
                </svg>
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
