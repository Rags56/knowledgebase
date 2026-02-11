import { useState, useEffect, useRef } from "react";
import { userApi } from "../services/api";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Plus, MessageSquare, BookOpen, LogOut, Loader2, ThumbsUp, ThumbsDown, Check, X } from "lucide-react";

export default function User() {
    const navigate = useNavigate();
    const userId = localStorage.getItem("userId");

    // State
    const [lectures, setLectures] = useState([]);
    const [selectedLecture, setSelectedLecture] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState(null); // String (sessionId) or null (new)
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);

    // Feedback State
    const [feedbackModal, setFeedbackModal] = useState(null); // { auditId: number, type: 'down' }
    const [feedbackReason, setFeedbackReason] = useState("");

    // Refs
    const messagesEndRef = useRef(null);

    const fetchMetaData = async () => {
        try {
            const [lecRes, sessRes] = await Promise.all([
                userApi.getLectures(userId),
                userApi.getSessions(userId)
            ]);
            setLectures(lecRes.data || []);
            setSessions(sessRes.data.chat_sessions || []);
        } catch (e) {
            console.error(e);
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        if (!userId) {
            navigate("/");
            return;
        }
        fetchMetaData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    useEffect(() => {
        scrollToBottom();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, streaming]);

    // Filter sessions by selected subject
    // Filter sessions by selected subject
    // Filter sessions by selected subject
    const currentSubjectSessions = sessions.filter(s => {
        if (!selectedLecture) return false;

        const sessId = String(s.session_id);
        const prefix = String(selectedLecture.id) + "-";

        // 1. Exact match for current lecture
        if (sessId.startsWith(prefix)) return true;

        // 2. Legacy/General sessions (those that DON'T start with "number-")
        const isLectureSpecific = /^\d+-/.test(sessId);
        if (!isLectureSpecific) return true;

        return false;
    });

    const handleSelectLecture = (lecture) => {
        setSelectedLecture(lecture);
        setSelectedSession(null); // Reset session view
        setMessages([]);
    };

    const handleSelectSession = async (session) => {
        setSelectedSession(session.session_id);
        setMessages([]); // Clear previous
        // Fetch history
        try {
            const res = await userApi.getChatHistory(session.session_id);

            // Transform history: {role, message} -> {role, content}
            // Backend returns tuples: (id, user_id, session_id, turn, role, message, timestamp, audit_id, rating)
            const history = (res.data.chat_history || []).map(h => ({
                id: h[0],
                role: h[4] === "system" ? "assistant" : h[4],
                content: h[5],
                auditId: h[7] ?? null,
                rated: h[8] ?? null
            }));
            // Sort by ids (chronological)
            history.sort((a, b) => a.id - b.id);

            setMessages(history);
        } catch (e) {
            console.error("Failed to load history", e);
        }
    };

    const handleNewChat = () => {
        setSelectedSession("-1");
        setMessages([]);
    };


    // Feedback Logic
    const handleFeedback = async (msgId, auditId, type) => {
        if (type === 'up') {
            try {
                await userApi.submitFeedback(auditId, 'up', null);
                // Update local state to show it was rated
                setMessages(prev => prev.map(m => m.auditId === auditId ? { ...m, rated: 'up' } : m));
            } catch (e) {
                console.error("Failed to submit feedback", e);
            }
        } else {
            // Open Modal
            setFeedbackModal({ auditId, type: 'down' });
        }
    };

    const submitNegativeFeedback = async () => {
        if (!feedbackModal) return;
        try {
            await userApi.submitFeedback(feedbackModal.auditId, 'down', feedbackReason);
            setMessages(prev => prev.map(m => m.auditId === feedbackModal.auditId ? { ...m, rated: 'down' } : m));
            setFeedbackModal(null);
            setFeedbackReason("");
        } catch (e) {
            console.error("Failed to submit feedback", e);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || streaming || !selectedLecture) return;

        const userMsg = { role: "user", content: input };
        setMessages(prev => [...prev, userMsg]);
        const currentInput = input;
        setInput("");
        setStreaming(true);

        const currentSessionId = selectedSession || "-1";

        // Add a temporary "Thinking..." message
        const thinkingMsg = { role: "assistant", content: "", thinking: true };
        setMessages(prev => [...prev, thinkingMsg]);

        try {
            const res = await userApi.rag(
                currentInput,
                currentSessionId,
                userId,
                selectedLecture.id
            );

            const data = res.data;

            if (data.error) {
                setMessages(prev => [
                    ...prev.filter(m => !m.thinking),
                    { role: "assistant", content: "Error: " + data.error }
                ]);
                setStreaming(false);
            } else {
                if (currentSessionId === "-1" && data.session_id) {
                    setSelectedSession(data.session_id);
                    setSessions(prev => [{ session_id: data.session_id, timestamp: new Date().toISOString() }, ...prev]);
                }

                // Initialize streaming: remove thinking, add empty assistant message
                const fullResponse = data.response || "";

                setMessages(prev => [
                    ...prev.filter(m => !m.thinking),
                    { role: "assistant", content: "", auditId: data.audit_id }
                ]);

                // Simulate streaming character by character
                let charIndex = 0;
                // Faster typing (chunking) to prevents freezing on long messages
                const chunkSize = 2;

                const intervalId = setInterval(() => {
                    charIndex += chunkSize;
                    if (charIndex > fullResponse.length) charIndex = fullResponse.length;

                    setMessages(prev => {
                        const newMsgs = [...prev];
                        const lastMsgIndex = newMsgs.length - 1;
                        if (lastMsgIndex >= 0) {
                            const lastMsg = newMsgs[lastMsgIndex];
                            // Verify we are updating the correct message
                            if (lastMsg.role === "assistant" && lastMsg.auditId === data.audit_id) {
                                newMsgs[lastMsgIndex] = {
                                    ...lastMsg,
                                    content: fullResponse.substring(0, charIndex)
                                };
                            }
                        }
                        return newMsgs;
                    });

                    if (charIndex >= fullResponse.length) {
                        clearInterval(intervalId);
                        setStreaming(false);
                    }
                }, 20); // 20ms update rate
            }
        } catch (e) {
            console.error(e);
            setMessages(prev => [
                ...prev.filter(m => !m.thinking),
                { role: "assistant", content: "Failed to get response." }
            ]);
            setStreaming(false);
        }
    };

    return (
        <div className="app-layout">
            {/* Sidebar 1: Subjects */}
            <div className="sidebar" style={{ borderRight: "1px solid var(--border)" }}>
                <div className="sidebar-header">
                    <span style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <BookOpen size={20} className="text-accent" /> Subjects
                    </span>
                </div>
                <div className="sidebar-content">
                    {lectures.map(lec => (
                        <div
                            key={lec.id}
                            className={`nav-item ${selectedLecture?.id === lec.id ? "active" : ""}`}
                            onClick={() => handleSelectLecture(lec)}
                        >
                            {lec.name}
                        </div>
                    ))}
                </div>
                <div style={{ padding: "1rem", borderTop: "1px solid var(--border)" }}>
                    <button className="nav-item" onClick={() => { localStorage.clear(); navigate("/"); }}>
                        <LogOut size={16} /> Logout
                    </button>
                </div>
            </div>

            {/* Sidebar 2: Chats */}
            <div className="sidebar" style={{ background: "var(--bg-secondary)" }}>
                <div className="sidebar-header" style={{ justifyContent: "space-between", display: "flex", background: "transparent" }}>
                    <span>Chats</span>
                    <button title="New Chat" disabled={!selectedLecture} onClick={handleNewChat}>
                        <Plus size={18} />
                    </button>
                </div>
                <div className="sidebar-content">
                    {selectedLecture ? (
                        <>
                            <div
                                className={`nav-item ${selectedSession === "-1" ? "active" : ""}`}
                                onClick={handleNewChat}
                                style={{ color: "var(--accent)" }}
                            >
                                <Plus size={16} /> New Chat
                            </div>
                            {currentSubjectSessions.map(sess => (
                                <div
                                    key={sess.session_id}
                                    className={`nav-item ${selectedSession === sess.session_id ? "active" : ""}`}
                                    onClick={() => handleSelectSession(sess)}
                                    style={{ fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                >
                                    <MessageSquare size={14} style={{ flexShrink: 0 }} />
                                    {new Date(sess.timestamp).toLocaleString(undefined, {
                                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                    })}
                                </div>
                            ))}
                            {currentSubjectSessions.length === 0 && (
                                <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center" }}>
                                    No chats yet.
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                            Select a subject to view chats.
                        </div>
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="chat-area">
                {selectedLecture ? (
                    <>
                        <div className="messages">
                            {messages.length === 0 && selectedSession === "-1" && (
                                <div style={{ textAlign: "center", marginTop: "20%", color: "var(--text-secondary)" }}>
                                    <h2 style={{ marginBottom: "1rem" }}>{selectedLecture.name}</h2>
                                    <p>Ask anything about this subject.</p>
                                </div>
                            )}
                            {messages.map((msg, i) => (
                                <div key={i} className={`message ${msg.role}`}>
                                    {msg.role === "assistant" && <div className="avatar">AI</div>}
                                    <div className="message-content" style={{ overflowWrap: "anywhere", padding: "0.75rem 1rem", borderRadius: "1rem", maxWidth: "80%" }}>
                                        {msg.thinking ? (
                                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)" }}>
                                                <Loader2 className="animate-spin" size={16} /> Thinking...
                                            </div>
                                        ) : (
                                            <>
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {msg.content + (streaming && i === messages.length - 1 && msg.role === "assistant" ? " ▋" : "")}
                                                </ReactMarkdown>
                                                {msg.role === "assistant" && msg.auditId && (
                                                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", justifyContent: "flex-end" }}>
                                                        <button
                                                            onClick={() => handleFeedback(i, msg.auditId, 'up')}
                                                            style={{ color: msg.rated === 'up' ? "var(--success)" : "var(--text-muted)", padding: "0.25rem" }}
                                                            disabled={!!msg.rated}
                                                        >
                                                            <ThumbsUp size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleFeedback(i, msg.auditId, 'down')}
                                                            style={{ color: msg.rated === 'down' ? "var(--danger)" : "var(--text-muted)", padding: "0.25rem" }}
                                                            disabled={!!msg.rated}
                                                        >
                                                            <ThumbsDown size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    {msg.role === "user" && <div className="avatar role-user">U</div>}
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>

                        <div className="input-area">
                            <div style={{ position: "relative", maxWidth: "800px", margin: "0 auto" }}>
                                <textarea
                                    className="chat-input"
                                    rows={1}
                                    placeholder="Message..."
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                    style={{
                                        width: "100%",
                                        paddingRight: "3rem",
                                        resize: "none",
                                        background: "var(--bg-elevated)",
                                        border: "1px solid var(--border)",
                                        borderRadius: "1.5rem",
                                        minHeight: "3rem",
                                        padding: "0.85rem 1rem",
                                        lineHeight: "1.3"
                                    }}
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={streaming || !input.trim()}
                                    style={{
                                        position: "absolute",
                                        right: "0.5rem",
                                        bottom: "0.5rem",
                                        height: "2rem",
                                        width: "2rem",
                                        background: input.trim() ? "var(--accent)" : "transparent",
                                        color: input.trim() ? "white" : "var(--text-muted)",
                                        borderRadius: "50%",
                                        padding: 0
                                    }}
                                >
                                    {streaming ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
                        Select a subject to start chatting
                    </div>
                )}
            </div>

            {/* Feedback Modal */}
            {feedbackModal && (
                <div style={{
                    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
                }}>
                    <div style={{ background: "var(--bg-secondary)", padding: "2rem", borderRadius: "1rem", width: "100%", maxWidth: "400px", border: "1px solid var(--border)" }}>
                        <h3 style={{ marginBottom: "1rem" }}>Feedback</h3>
                        <p style={{ marginBottom: "1rem", color: "var(--text-secondary)" }}>Please explain the issue with this response:</p>
                        <textarea
                            value={feedbackReason}
                            onChange={(e) => setFeedbackReason(e.target.value)}
                            style={{ width: "100%", marginBottom: "1rem", minHeight: "100px" }}
                            placeholder="Optional explanation..."
                        />
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
                            <button
                                onClick={() => { setFeedbackModal(null); setFeedbackReason(""); }}
                                className="btn btn-secondary"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitNegativeFeedback}
                                className="btn btn-primary"
                            >
                                Submit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
