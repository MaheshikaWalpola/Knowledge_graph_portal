import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import "./AIAssistance.css";

const API = import.meta.env.VITE_API_URL;

const INITIAL_MESSAGE = {
  role: "assistant",
  content:
    "Hi! I'm your Knowledge Graph assistant.\n\nAsk me general questions, or ask about any ontology you have uploaded. For graph-specific answers, mention the ontology or graph name so I can explore its classes, properties, relationships, instances, and process variables using graph-grounded data.",
};

// Generate a unique numeric-ish ID (float so it round-trips through the DB float path_id)
const genId = () => Date.now() + Math.random();

// ── Axios helper (adds auth header) 
const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

export default function AIAssistance({ onOpenAuth }) {
  // ── Auth gate 
  const token = localStorage.getItem("token");

  // ── State 
  const [chats, setChats]                   = useState([]);
  const [currentChatId, setCurrentChatId]   = useState(null);
  const [chatsLoading, setChatsLoading]     = useState(true);   // initial fetch
  const [input, setInput]                   = useState("");
  const [loading, setLoading]               = useState(false);
  const [sidebarOpen, setSidebarOpen]       = useState(false);
  const [renaming, setRenaming]             = useState(null);   // { id, value }
  const [deleteConfirmId, setDeleteConfirmId] = useState(null); // id of chat pending deletion

  const renameInputRef = useRef(null);
  const chatBodyRef    = useRef(null);
  const prevChatIdRef  = useRef(null);

  // ── Derived ──
  // Only saved conversations appear in the sidebar (unsaved = new empty chat)
  const savedChats  = chats.filter((c) => c.saved);
  const currentChat = chats.find((c) => c.id === currentChatId) ?? chats[0];
  const messages    = currentChat?.messages ?? [];

  // Scroll tracking — avoid auto-scroll on initial load
  const prevMsgCountRef = useRef(0);
  const prevLoadingRef  = useRef(false);

  // ── Load conversations from MongoDB on mount 
  const loadChats = useCallback(async () => {
    if (!token) return;
    setChatsLoading(true);
    try {
      const res  = await axios.get(`${API}/chats`, authHeaders(token));
      const from_db = (res.data?.conversations ?? []).map((c) => ({
        id:       c.chat_id,
        title:    c.title,
        messages: c.messages ?? [INITIAL_MESSAGE],
        saved:    true,
      }));

      if (from_db.length === 0) {
        // No conversations yet — start with one unsaved (blank) chat
        const fresh = { id: genId(), title: "Conversation 1", messages: [INITIAL_MESSAGE], saved: false };
        setChats([fresh]);
        setCurrentChatId(fresh.id);
      } else {
        setChats(from_db);
        // Restore last-active tab
        const savedId = parseFloat(localStorage.getItem("kg_current_chat") ?? "0");
        const valid   = from_db.find((c) => c.id === savedId) ? savedId : from_db[0].id;
        setCurrentChatId(valid);
      }

      prevMsgCountRef.current = 0; // reset scroll guard after load
    } catch (e) {
      console.error("Failed to load conversations", e);
      // Fallback: create a blank local chat so the UI isn't broken
      const fresh = { id: genId(), title: "Conversation 1", messages: [INITIAL_MESSAGE], saved: false };
      setChats([fresh]);
      setCurrentChatId(fresh.id);
    } finally {
      setChatsLoading(false);
    }
  }, [token]);

  useEffect(() => { loadChats(); }, [loadChats]);

  // ── Persist active tab locally 
  useEffect(() => {
    if (currentChatId !== null)
      localStorage.setItem("kg_current_chat", String(currentChatId));
  }, [currentChatId]);

  // ── Rename input focus 
  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  // ── Scroll — only on new content or chat changes
  useEffect(() => {
    const chatBody = chatBodyRef.current;
    if (!chatBody) return;

    const chatChanged   = currentChatId !== prevChatIdRef.current;
    const msgAdded      = messages.length > prevMsgCountRef.current;
    const typingStarted = loading && !prevLoadingRef.current;

    prevMsgCountRef.current = messages.length;
    prevLoadingRef.current  = loading;
    prevChatIdRef.current   = currentChatId;

    if (chatChanged) {
      // Instant scroll to bottom when switching conversations
      chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: "auto" });
    } else if (msgAdded || typingStarted) {
      // Smooth scroll for typing indicator or new messages
      chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length, loading, currentChatId]);

  // ── Auth gate useEffect ──
  useEffect(() => {
    if (!token) onOpenAuth?.();
  }, [token, onOpenAuth]);

  if (!token) return null;

  // ── Helpers ──
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

  // Save a conversation to MongoDB
  const persistChat = async (chatId, title, msgs) => {
    try {
      await axios.put(
        `${API}/chats/${chatId}`,
        { title, messages: msgs },
        authHeaders(token)
      );
    } catch (e) {
      console.error("Failed to save conversation", e);
    }
  };

  // ── Send message ─
  const sendMessage = async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;

    const nextMessages = [...messages, { role: "user", content: trimmed }];
    const chatTitle    = currentChat?.title ?? "Conversation 1";

    // Atomic state update: mark saved + add user message
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === currentChatId
          ? { ...chat, saved: true, messages: nextMessages }
          : chat
      )
    );
    setInput("");
    setLoading(true);

    try {
      const res = await axios.post(
        `${API}/assistant/chat`,
        { messages: nextMessages },
        authHeaders(token)
      );

      const answer    = res.data?.answer ?? "No answer returned.";
      const chartData = res.data?.chart_data;
      const finalMsgs = [...nextMessages, { role: "assistant", content: answer, chart_data: chartData }];
      updateCurrentChat(finalMsgs);

      // Persist to MongoDB after the full exchange
      await persistChat(currentChatId, chatTitle, finalMsgs);
    } catch (e) {
      const errMsg =
        e?.response?.data?.detail || e?.message || "Error calling the assistant API.";
      const finalMsgs = [...nextMessages, { role: "assistant", content: errMsg }];
      updateCurrentChat(finalMsgs);
      await persistChat(currentChatId, chatTitle, finalMsgs);
    } finally {
      setLoading(false);
    }
  };

  const send = () => sendMessage(input);

  // ── New chat ─
  const handleNewChat = () => {
    const newId    = genId();
    const newIndex = savedChats.length + 1;
    setChats((prev) => [
      ...prev,
      {
        id:       newId,
        title:    `Conversation ${newIndex}`,
        messages: [INITIAL_MESSAGE],
        saved:    false, // not in sidebar / DB until first message
      },
    ]);
    setCurrentChatId(newId);
    setSidebarOpen(false);
  };

  // ── Delete chat ──
  const triggerDeleteChat = (e, chatId) => {
    e.stopPropagation();
    setDeleteConfirmId(chatId);
  };

  const cancelDelete = (e) => {
    e.stopPropagation();
    setDeleteConfirmId(null);
  };

  const confirmDeleteChat = async (e, chatId) => {
    e.stopPropagation();
    setDeleteConfirmId(null);

    // Delete from MongoDB (fire-and-forget — don't block UI)
    const chatToDelete = chats.find((c) => c.id === chatId);
    if (chatToDelete?.saved) {
      try {
        await axios.delete(`${API}/chats/${chatId}`, authHeaders(token));
      } catch (err) {
        console.error("Failed to delete conversation from DB", err);
      }
    }

    const remaining = chats.filter((c) => c.id !== chatId);
    if (remaining.length === 0) {
      const fresh = { id: genId(), title: "Conversation 1", messages: [INITIAL_MESSAGE], saved: false };
      setChats([fresh]);
      setCurrentChatId(fresh.id);
    } else {
      setChats(remaining);
      if (currentChatId === chatId)
        setCurrentChatId(remaining[remaining.length - 1].id);
    }
  };

  // ── Rename 
  const startRename = (e, chatId, currentTitle) => {
    e.stopPropagation();
    setRenaming({ id: chatId, value: currentTitle });
  };

  const commitRename = async () => {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    if (trimmed) {
      setChats((prev) =>
        prev.map((c) => (c.id === renaming.id ? { ...c, title: trimmed } : c))
      );
      // Persist updated title to MongoDB
      const chat = chats.find((c) => c.id === renaming.id);
      if (chat?.saved) {
        await persistChat(renaming.id, trimmed, chat.messages);
      }
    }
    setRenaming(null);
  };

  const cancelRename = () => setRenaming(null);

  // ── Render 
  if (chatsLoading) {
    return (
      <div className="ai-workspace theme-light">
        <div className="ai-main">
          <div className="ai-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 340 }}>
            <div className="loading-spinner" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-workspace theme-light">

      {/* ── Conversations Sidebar  */}
      <div className={`ai-sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <button type="button" className="new-chat-btn" onClick={handleNewChat} title="Start new conversation">
            <span className="plus-icon">+</span>
            <span className="btn-text">New Conversation</span>
          </button>
          <button type="button" className="sidebar-toggle" onClick={() => setSidebarOpen(false)} title="Close panel" aria-label="Close conversations panel">
            ✕
          </button>
        </div>

        <div className="chats-list">
          {savedChats.length === 0 && (
            <p className="chats-empty">No conversations yet. Start chatting!</p>
          )}

          {savedChats.map((chat) =>
            renaming?.id === chat.id ? (
              <div key={chat.id} className="chat-item renaming">
                <input
                  ref={renameInputRef}
                  className="rename-input"
                  value={renaming.value}
                  onChange={(e) => setRenaming((r) => ({ ...r, value: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")  commitRename();
                    if (e.key === "Escape") cancelRename();
                  }}
                  onBlur={commitRename}
                  maxLength={60}
                />
              </div>
            ) : (
              <div
                key={chat.id}
                className={`chat-item ${currentChatId === chat.id ? "active" : ""}`}
                onClick={() => { setCurrentChatId(chat.id); setSidebarOpen(false); }}
              >
                <span className="chat-title">{chat.title}</span>
                <div className="chat-item-actions">
                  <button type="button" className="chat-action-btn rename-btn" onClick={(e) => startRename(e, chat.id, chat.title)} title="Rename" aria-label="Rename conversation">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button type="button" className="chat-action-btn delete-btn" onClick={(e) => triggerDeleteChat(e, chat.id)} title="Delete" aria-label="Delete conversation">
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

      {/* Overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* ── Main Chat Card ─ */}
      <div className="ai-main">
        <div className="ai-card">

          {/* Header */}
          <div className="ai-header">
            <div className="header-content">
              <h1 className="ai-title">Knowledge Graph Assistant</h1>
              <p className="ai-subtitle">Ask questions about your ontology</p>
            </div>
            <button type="button" className="header-settings-btn" onClick={() => setSidebarOpen(true)} title="Manage conversations" aria-label="Open conversations panel">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>

          {/* Chat shell */}
          <div className="chat-shell">
            <div ref={chatBodyRef} className="chat-body">
              {messages.map((m, i) => (
                <div key={i} className={`chat-row ${m.role}`}>
                  <div className="bubble">
                    <div className="bubble-content">{m.content}</div>
                    {m.chart_data && m.chart_data.length > 0 && (
                      <div className="chart-container" style={{ width: "100%", height: 300, marginTop: 16 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={m.chart_data}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis dataKey="name" tick={{fill: '#888', fontSize: 12}} />
                            <YAxis tick={{fill: '#888', fontSize: 12}} />
                            <Tooltip contentStyle={{backgroundColor: '#2a2a35', border: 'none', borderRadius: '8px', color: '#fff'}} itemStyle={{color: '#fff'}} />
                            <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
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
            </div>

            <div className="chat-footer">
              <input
                className="chat-input"
                placeholder="Ask a question about the knowledge graph…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
              />
              <button className="chat-send" onClick={send} disabled={loading} title="Send message">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
                </svg>
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ── Delete Confirmation Modal ───────────────────────────────── */}
      {deleteConfirmId && (
        <div className="ai-modal-overlay" onClick={cancelDelete}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="ai-modal-title">Delete Conversation</h3>
            <p className="ai-modal-desc">
              Are you sure you want to delete this conversation? This action cannot be undone.
            </p>
            <div className="ai-modal-actions">
              <button className="ai-modal-btn cancel" onClick={cancelDelete}>
                Cancel
              </button>
              <button className="ai-modal-btn confirm" onClick={(e) => confirmDeleteChat(e, deleteConfirmId)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
