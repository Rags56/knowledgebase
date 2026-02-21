import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    Plus, MessageSquare, LogOut, Send, Loader2,
    ThumbsUp, ThumbsDown, Shield, X, ChevronDown, FileText, RefreshCw,
} from 'lucide-react';
import { userApi } from '../services/api';
import { Toast } from '../components/Toast';

// ── Helpers ────────────────────────────────────────────────────────────────
function sessionLabel(sess) {
    return new Date(sess.timestamp).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

// ── Thinking indicator ─────────────────────────────────────────────────────
function ThinkingDots() {
    return (
        <div className="thinking-dots" style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '0.25rem 0' }}>
            <span /><span /><span />
        </div>
    );
}

// ── Sources section (collapsible) ─────────────────────────────────────────
function SourcesSection({ files }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ marginTop: '0.6rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
            <button
                onClick={() => setOpen((o) => !o)}
                style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    fontSize: '0.75rem', color: 'var(--text-muted)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 0, transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
                <FileText size={12} />
                {files.length} source{files.length !== 1 ? 's' : ''} referenced
                <ChevronDown
                    size={12}
                    style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
            </button>
            {open && (
                <div style={{ marginTop: '0.4rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {files.map((f, idx) => (
                        <span
                            key={idx}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                fontSize: '0.72rem', padding: '0.2rem 0.55rem',
                                borderRadius: '99px',
                                background: 'rgba(56,189,248,0.1)',
                                border: '1px solid rgba(56,189,248,0.25)',
                                color: 'var(--info)',
                            }}
                        >
                            <FileText size={10} />{f}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function UserPage() {
    const navigate = useNavigate();
    const session = JSON.parse(localStorage.getItem('rbac_session') || 'null');

    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState(null); // null = show welcome
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [feedbackModal, setFeedbackModal] = useState(null); // { auditId }
    const [feedbackReason, setFeedbackReason] = useState('');
    const [toast, setToast] = useState(null);

    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    // ── Load chat sessions on mount ──────────────────────────────────────────
    useEffect(() => {
        if (!session) { navigate('/'); return; }
        fetchSessions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streaming]);

    const fetchSessions = async () => {
        setSessionsLoading(true);
        try {
            const res = await userApi.getSessions(session.userId);
            const list = res.data.chat_sessions || [];
            // Exclude the placeholder '-1' session_id that was used before UUID generation
            setSessions(list.filter((s) => s.session_id !== '-1'));
        } catch (e) {
            console.error('Failed to load sessions:', e);
        } finally {
            setSessionsLoading(false);
        }
    };

    // ── Select a previous session ────────────────────────────────────────────
    const handleSelectSession = async (sess) => {
        setSelectedSession(sess.session_id);
        setMessages([]);
        try {
            const res = await userApi.getHistory(sess.session_id);
            const history = (res.data.chat_history || []).map((h) => ({
                id: h.id,
                role: h.role === 'system' ? 'assistant' : h.role,
                content: h.message,
                auditId: h.audit_id ?? null,
                rated: h.rating ?? null,
            }));
            history.sort((a, b) => a.id - b.id);
            setMessages(history);
        } catch (e) {
            console.error('Failed to load history', e);
        }
    };

    const handleNewChat = () => {
        setSelectedSession('-1');
        setMessages([]);
    };

    // ── Feedback ─────────────────────────────────────────────────────────────
    const handleFeedback = async (auditId, type) => {
        if (type === 'up') {
            try {
                await userApi.submitFeedback(auditId, 'up', null);
                setMessages((prev) => prev.map((m) => m.auditId === auditId ? { ...m, rated: 'up' } : m));
                setToast({ message: 'Thanks for the feedback!', type: 'success' });
            } catch { setToast({ message: 'Failed to submit feedback', type: 'error' }); }
        } else {
            setFeedbackModal({ auditId });
        }
    };

    const submitNegativeFeedback = async () => {
        if (!feedbackModal) return;
        try {
            await userApi.submitFeedback(feedbackModal.auditId, 'down', feedbackReason);
            setMessages((prev) => prev.map((m) => m.auditId === feedbackModal.auditId ? { ...m, rated: 'down' } : m));
            setToast({ message: 'Feedback submitted', type: 'success' });
        } catch { setToast({ message: 'Failed to submit feedback', type: 'error' }); }
        setFeedbackModal(null);
        setFeedbackReason('');
    };

    // ── Send message ─────────────────────────────────────────────────────────
    const handleSend = async () => {
        if (!input.trim() || streaming) return;
        if (selectedSession === null) {
            // Auto-create new session
            setSelectedSession('-1');
        }
        const userMessage = { role: 'user', content: input };
        setMessages((prev) => [...prev, userMessage]);
        const currentInput = input;
        const currentSessionId = selectedSession === null ? '-1' : selectedSession;
        setInput('');
        setStreaming(true);

        setMessages((prev) => [...prev, { role: 'assistant', content: '', thinking: true }]);

        try {
            const res = await userApi.rag(currentInput, currentSessionId, session.userId);
            const data = res.data;

            if (data.error) {
                setMessages((prev) => [
                    ...prev.filter((m) => !m.thinking),
                    { role: 'assistant', content: 'Error: ' + data.error },
                ]);
                setStreaming(false);
                return;
            }

            // Update session list if new session was created
            if (currentSessionId === '-1' && data.session_id) {
                setSelectedSession(data.session_id);
                setSessions((prev) => [{ session_id: data.session_id, timestamp: new Date().toISOString() }, ...prev]);
            }

            const fullResponse = data.response || '';
            const filesUsed = data.files_used || [];

            setMessages((prev) => [
                ...prev.filter((m) => !m.thinking),
                { role: 'assistant', content: '', auditId: data.audit_id, filesUsed },
            ]);

            // Character-by-character typing effect
            let charIndex = 0;
            const chunkSize = 3;
            const intervalId = setInterval(() => {
                charIndex += chunkSize;
                if (charIndex > fullResponse.length) charIndex = fullResponse.length;

                setMessages((prev) => {
                    const msgs = [...prev];
                    const last = msgs.length - 1;
                    if (last >= 0 && msgs[last].role === 'assistant' && msgs[last].auditId === data.audit_id) {
                        msgs[last] = { ...msgs[last], content: fullResponse.substring(0, charIndex), filesUsed };
                    }
                    return msgs;
                });

                if (charIndex >= fullResponse.length) {
                    clearInterval(intervalId);
                    setStreaming(false);
                }
            }, 18);
        } catch (e) {
            console.error(e);
            setMessages((prev) => [
                ...prev.filter((m) => !m.thinking),
                { role: 'assistant', content: 'Failed to get a response. Please try again.' },
            ]);
            setStreaming(false);
        }
    };

    // ── Textarea auto-resize ─────────────────────────────────────────────────
    const handleInput = (e) => {
        setInput(e.target.value);
        const ta = textareaRef.current;
        if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const handleLogout = () => { localStorage.removeItem('rbac_session'); navigate('/'); };

    if (!session) return null;

    const userInitial = (session.username || 'U')[0].toUpperCase();

    return (
        <div className="chat-shell">
            {/* ── Sidebar ── */}
            <div className="chat-sidebar">
                {/* Brand */}
                <div className="brand">
                    <div className="brand-icon"><Shield size={16} color="#fff" /></div>
                    <span className="brand-name">Knowledge Base</span>
                </div>

                {/* User info */}
                <div style={{
                    padding: '0.75rem 1rem',
                    margin: '0.5rem',
                    background: 'var(--bg-elevated)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                        <div style={{
                            width: '2rem', height: '2rem', borderRadius: '50%',
                            background: 'var(--accent)', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem',
                        }}>
                            {userInitial}
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{session.username}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>User</div>
                        </div>
                    </div>
                    {session.flags?.length > 0 && (
                        <div className="tags-list" style={{ marginTop: '0.4rem' }}>
                            {session.flags.map((f) => (
                                <span key={f} className="badge badge-accent">{f}</span>
                            ))}
                        </div>
                    )}
                </div>

                {/* New chat button */}
                <div style={{ padding: '0.5rem' }}>
                    <button
                        id="rbac-new-chat"
                        className="btn btn-primary"
                        style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', padding: '0.5rem' }}
                        onClick={handleNewChat}
                    >
                        <Plus size={14} /> New Chat
                    </button>
                </div>

                {/* Sessions list */}
                <div className="sidebar-content">
                    {/* Header with refresh */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0.85rem 0.25rem' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>Recent Chats</span>
                        <button
                            id="rbac-refresh-sessions"
                            className="btn-ghost"
                            onClick={fetchSessions}
                            disabled={sessionsLoading}
                            title="Refresh sessions"
                            style={{ padding: '0.2rem' }}
                        >
                            <RefreshCw size={12} style={{ animation: sessionsLoading ? 'spin 0.7s linear infinite' : 'none' }} />
                        </button>
                    </div>

                    {sessionsLoading && sessions.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                            <Loader2 size={16} style={{ animation: 'spin 0.7s linear infinite', marginBottom: '0.4rem' }} />
                            <br />Loading…
                        </div>
                    )}
                    {!sessionsLoading && sessions.length === 0 && (
                        <div className="empty-state" style={{ padding: '1.5rem 0.5rem' }}>
                            <MessageSquare size={22} />
                            <p>No chats yet.<br />Start a conversation!</p>
                        </div>
                    )}
                    {sessions.map((sess) => (
                        <div
                            key={sess.session_id}
                            id={`session-${sess.session_id}`}
                            className={`nav-item ${selectedSession === sess.session_id ? 'active' : ''}`}
                            onClick={() => handleSelectSession(sess)}
                            title={sessionLabel(sess)}
                        >
                            <MessageSquare size={13} style={{ flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.83rem' }}>
                                {sessionLabel(sess)}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Logout */}
                <div className="sidebar-footer">
                    <button id="rbac-logout" className="nav-item" style={{ width: '100%' }} onClick={handleLogout}>
                        <LogOut size={15} /> Sign out
                    </button>
                </div>
            </div>

            {/* ── Chat Area ── */}
            <div className="chat-area">
                {/* Top bar */}
                <div className="chat-topbar">
                    <div>
                        <div style={{ fontWeight: 600 }}>AI Assistant</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Answers are filtered to your access level
                        </div>
                    </div>
                    {session.flags?.length > 0 && (
                        <div className="tags-list">
                            {session.flags.map((f) => (
                                <span key={f} className="badge badge-accent">{f}</span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Messages */}
                <div className="messages-list">
                    {messages.length === 0 && (
                        <div style={{ textAlign: 'center', marginTop: '15%', color: 'var(--text-secondary)' }}>
                            <Shield size={48} style={{ opacity: 0.15, marginBottom: '1rem' }} />
                            <h2 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                                Hello, {session.username}!
                            </h2>
                            <p style={{ color: 'var(--text-muted)', maxWidth: '400px', margin: '0 auto' }}>
                                Ask anything. Your answers will only reference documents you have access to based on your flags.
                            </p>
                        </div>
                    )}

                    {messages.map((msg, i) => (
                        <div key={i} className={`message-row ${msg.role}`}>
                            {msg.role === 'assistant' && (
                                <div className="avatar ai" style={{ fontSize: '0.6rem' }}>AI</div>
                            )}
                            <div className={`bubble ${msg.role}`} style={{ overflowWrap: 'anywhere' }}>
                                {msg.thinking ? (
                                    <ThinkingDots />
                                ) : (
                                    <>
                                        <div className="prose">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {msg.content + (streaming && i === messages.length - 1 && msg.role === 'assistant' ? ' ▋' : '')}
                                            </ReactMarkdown>
                                        </div>

                                        {/* ── Sources ── */}
                                        {msg.role === 'assistant' && msg.filesUsed?.length > 0 && (
                                            <SourcesSection files={msg.filesUsed} />
                                        )}

                                        {msg.role === 'assistant' && msg.auditId && (
                                            <div className="bubble-meta">
                                                <button
                                                    id={`feedback-up-${msg.auditId}`}
                                                    className={`feedback-btn ${msg.rated === 'up' ? 'rated-up' : ''}`}
                                                    disabled={!!msg.rated}
                                                    onClick={() => handleFeedback(msg.auditId, 'up')}
                                                    title="Good response"
                                                >
                                                    <ThumbsUp size={12} />
                                                </button>
                                                <button
                                                    id={`feedback-down-${msg.auditId}`}
                                                    className={`feedback-btn ${msg.rated === 'down' ? 'rated-down' : ''}`}
                                                    disabled={!!msg.rated}
                                                    onClick={() => handleFeedback(msg.auditId, 'down')}
                                                    title="Bad response"
                                                >
                                                    <ThumbsDown size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            {msg.role === 'user' && (
                                <div className="avatar user">{userInitial}</div>
                            )}
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input area */}
                <div className="chat-input-area">
                    <div className="chat-input-wrapper">
                        <textarea
                            id="rbac-chat-input"
                            ref={textareaRef}
                            rows={1}
                            placeholder="Message the AI assistant… (Enter to send, Shift+Enter for newline)"
                            value={input}
                            onChange={handleInput}
                            onKeyDown={handleKeyDown}
                        />
                        <button
                            id="rbac-send-btn"
                            className="send-btn"
                            onClick={handleSend}
                            disabled={streaming || !input.trim()}
                            title="Send message"
                        >
                            {streaming ? <Loader2 size={15} style={{ animation: 'spin 0.7s linear infinite' }} /> : <Send size={15} />}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Feedback Modal ── */}
            {feedbackModal && (
                <div className="modal-backdrop">
                    <div className="modal">
                        <div className="modal-header">
                            <h3 className="modal-title">What went wrong?</h3>
                            <button className="btn-ghost" onClick={() => { setFeedbackModal(null); setFeedbackReason(''); }}>
                                <X size={18} />
                            </button>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                            Please describe the issue with this response. Your feedback helps improve the system.
                        </p>
                        <textarea
                            id="rbac-feedback-text"
                            value={feedbackReason}
                            onChange={(e) => setFeedbackReason(e.target.value)}
                            placeholder="Optional: e.g. the answer was incorrect, missing context…"
                            style={{ width: '100%', minHeight: '100px', marginBottom: '0.5rem' }}
                        />
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setFeedbackModal(null); setFeedbackReason(''); }}>
                                Cancel
                            </button>
                            <button id="rbac-feedback-submit" className="btn btn-danger" onClick={submitNegativeFeedback}>
                                Submit feedback
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Toast ── */}
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        </div>
    );
}
