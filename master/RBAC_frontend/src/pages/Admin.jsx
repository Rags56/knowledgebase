import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Shield, Users, FileText, Tag, BarChart2, LogOut,
    Plus, Pencil, Trash2, Upload, X, Check, Loader2,
    AlertTriangle, ThumbsUp, ThumbsDown, Search, Eye,
    ChevronRight, RefreshCw, Book,
} from 'lucide-react';
import { adminUsersApi, adminFilesApi, adminFlagsApi, adminAuditApi } from '../services/api';
import { Toast } from '../components/Toast';

// ── Helpers ────────────────────────────────────────────────────────────────
const FMT = (ts) => ts ? new Date(ts).toLocaleString() : '—';
const noop = () => { };

// ── Reusable Modal ─────────────────────────────────────────────────────────
function Modal({ title, onClose, children, footer }) {
    return (
        <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: '520px' }}>
                <div className="modal-header">
                    <h3 className="modal-title">{title}</h3>
                    <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
                </div>
                {children}
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>
    );
}

// ── Confirm Modal ──────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel, danger = true }) {
    return (
        <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: '400px' }}>
                <div className="modal-header">
                    <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <AlertTriangle size={18} style={{ color: 'var(--warning)' }} /> Confirm Action
                    </h3>
                    <button className="btn-ghost" onClick={onCancel}><X size={18} /></button>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{message}</p>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
                    <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Flag Chip Selector ──────────────────────────────────────────────────────
function FlagChipSelector({ allFlags, selected, onChange }) {
    return (
        <div className="checkbox-group">
            {allFlags.length === 0 && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No flags defined yet.</span>
            )}
            {allFlags.map((f) => (
                <label key={f.id} className={`checkbox-chip ${selected.includes(f.name) ? 'selected' : ''}`}>
                    <input
                        type="checkbox"
                        style={{ display: 'none' }}
                        checked={selected.includes(f.name)}
                        onChange={() => {
                            onChange(selected.includes(f.name)
                                ? selected.filter((x) => x !== f.name)
                                : [...selected, f.name]);
                        }}
                    />
                    {f.name}
                </label>
            ))}
        </div>
    );
}

// ── SECTION: Dashboard ─────────────────────────────────────────────────────
function DashboardTab({ adminId }) {
    const [stats, setStats] = useState({ users: 0, files: 0, flags: 0, feedbacks: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            adminUsersApi.getAll(adminId),
            adminFilesApi.getAll(adminId),
            adminFlagsApi.getAll(adminId),
            adminAuditApi.getFeedbacks(adminId),
        ]).then(([u, f, fl, fb]) => {
            setStats({
                users: u.data.users?.length || 0,
                files: f.data.files?.length || 0,
                flags: fl.data.flags?.length || 0,
                feedbacks: fb.data.feedbacks?.length || 0,
            });
        }).catch(noop).finally(() => setLoading(false));
    }, [adminId]);

    const cards = [
        { label: 'Total Users', value: stats.users, icon: Users, color: 'rgba(99,102,241,0.15)', iconColor: 'var(--accent-light)' },
        { label: 'Knowledge Files', value: stats.files, icon: FileText, color: 'rgba(34,197,94,0.12)', iconColor: 'var(--success)' },
        { label: 'Org Flags', value: stats.flags, icon: Tag, color: 'rgba(245,158,11,0.12)', iconColor: 'var(--warning)' },
        { label: 'AI Feedbacks', value: stats.feedbacks, icon: BarChart2, color: 'rgba(56,189,248,0.12)', iconColor: 'var(--info)' },
    ];

    return (
        <div>
            <div className="stats-grid">
                {cards.map(({ label, value, icon: Icon, color, iconColor }) => (
                    <div key={label} className="stat-card">
                        <div className="stat-icon" style={{ background: color }}>
                            <Icon size={20} style={{ color: iconColor }} />
                        </div>
                        <div className="stat-label">{label}</div>
                        {loading ? <div className="spinner" /> : <div className="stat-value">{value}</div>}
                    </div>
                ))}
            </div>
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Quick Start</h3>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {[
                        ['Create org flags (departments/roles)', 'Flags tab'],
                        ['Add users and assign their flags', 'Users tab'],
                        ['Upload knowledge files with flag restrictions', 'Files tab'],
                        ['Monitor AI usage and feedback', 'Audit tab'],
                    ].map(([step, tab], i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                            <div style={{
                                width: '1.5rem', height: '1.5rem', borderRadius: '50%',
                                background: 'var(--accent)', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0, marginTop: '0.1rem',
                            }}>
                                {i + 1}
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-primary)', fontSize: '0.875rem' }}>{step}</span>
                                <span style={{ marginLeft: '0.5rem', color: 'var(--accent-light)', fontSize: '0.8rem' }}>→ {tab}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── SECTION: Flags ─────────────────────────────────────────────────────────
function FlagsTab({ adminId, flags, setFlags, toast }) {
    const [loading, setLoading] = useState(false);
    const [modal, setModal] = useState(null); // 'create' | { edit: flag }
    const [deleteFlag, setDeleteFlag] = useState(null);
    const [form, setForm] = useState({ name: '', description: '' });
    const [viewModal, setViewModal] = useState(null); // { flag, users, files }
    const [viewLoading, setViewLoading] = useState(false);

    const openCreate = () => { setForm({ name: '', description: '' }); setModal('create'); };
    const openEdit = (f) => { setForm({ name: f.name, description: f.description || '' }); setModal({ edit: f }); };

    const refresh = async () => {
        setLoading(true);
        try {
            const res = await adminFlagsApi.getAll(adminId);
            setFlags(res.data.flags || []);
        } catch { toast.error('Failed to load flags'); } finally { setLoading(false); }
    };

    const handleSave = async () => {
        if (!form.name.trim()) { toast.error('Flag name is required'); return; }
        setLoading(true);
        try {
            if (modal === 'create') {
                await adminFlagsApi.create(adminId, form);
                toast.success(`Flag "${form.name}" created`);
            } else {
                await adminFlagsApi.update(adminId, modal.edit.id, form);
                toast.success(`Flag renamed (cascade applied)`);
            }
            await refresh();
            setModal(null);
        } catch (e) {
            toast.error(e?.response?.data?.detail || 'Failed to save flag');
        } finally { setLoading(false); }
    };

    const handleDelete = async () => {
        setLoading(true);
        try {
            await adminFlagsApi.delete(adminId, deleteFlag.id);
            toast.success(`Flag "${deleteFlag.name}" deleted`);
            await refresh();
        } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to delete'); }
        finally { setLoading(false); setDeleteFlag(null); }
    };

    const handleViewFlag = async (f) => {
        setViewLoading(true);
        try {
            const [uRes, fRes] = await Promise.all([
                adminFlagsApi.getUsersWithFlag(adminId, f.id),
                adminFlagsApi.getFilesWithFlag(adminId, f.id),
            ]);
            setViewModal({ flag: f, users: uRes.data.users || [], files: fRes.data.files || [] });
        } catch { toast.error('Failed to load flag details'); }
        finally { setViewLoading(false); }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.25rem', gap: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={refresh} disabled={loading}><RefreshCw size={14} /> Refresh</button>
                <button id="flags-create-btn" className="btn btn-primary" onClick={openCreate}><Plus size={14} /> Create Flag</button>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {flags.length === 0 && !loading && (
                    <div className="empty-state"><Tag size={32} /><p>No flags yet. Create your first organisational flag.</p></div>
                )}
                {flags.length > 0 && (
                    <table className="data-table">
                        <thead><tr><th>Flag Name</th><th>Description</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                        <tbody>
                            {flags.map((f) => (
                                <tr key={f.id}>
                                    <td className="highlight">
                                        <span className="badge badge-accent">{f.name}</span>
                                    </td>
                                    <td>{f.description || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            <button className="btn-icon" title="View usage" onClick={() => handleViewFlag(f)} disabled={viewLoading}>
                                                {viewLoading ? <Loader2 size={14} /> : <Eye size={14} />}
                                            </button>
                                            <button id={`flag-edit-${f.id}`} className="btn-icon" title="Edit / rename" onClick={() => openEdit(f)}>
                                                <Pencil size={14} />
                                            </button>
                                            <button id={`flag-delete-${f.id}`} className="btn-icon" title="Delete" onClick={() => setDeleteFlag(f)}
                                                style={{ color: 'var(--danger)' }}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Create / Edit Modal */}
            {modal && (
                <Modal
                    title={modal === 'create' ? 'Create Organisation Flag' : `Edit Flag: ${modal.edit.name}`}
                    onClose={() => setModal(null)}
                    footer={<>
                        <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                        <button id="flag-save-btn" className="btn btn-primary" onClick={handleSave} disabled={loading}>
                            {loading ? <Loader2 size={14} /> : <Check size={14} />} Save
                        </button>
                    </>}
                >
                    <div className="form-group">
                        <label className="form-label">Flag Name</label>
                        <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="e.g. manager, programmer, hr" autoFocus />
                        {modal !== 'create' && (
                            <p style={{ fontSize: '0.78rem', color: 'var(--warning)', marginTop: '0.35rem' }}>
                                ⚠ Renaming will cascade to all users and files with this flag.
                            </p>
                        )}
                    </div>
                    <div className="form-group">
                        <label className="form-label">Description (optional)</label>
                        <input className="form-input" value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            placeholder="Brief description of this flag's purpose" />
                    </div>
                </Modal>
            )}

            {/* Delete Confirm */}
            {deleteFlag && (
                <ConfirmModal
                    message={`Delete flag "${deleteFlag.name}"? This removes it from the registry but does NOT strip it from existing users or files.`}
                    onConfirm={handleDelete}
                    onCancel={() => setDeleteFlag(null)}
                />
            )}

            {/* View Flag Usage Modal */}
            {viewModal && (
                <Modal title={`Usage: "${viewModal.flag.name}"`} onClose={() => setViewModal(null)}
                    footer={<button className="btn btn-secondary" onClick={() => setViewModal(null)}>Close</button>}>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Users with this flag ({viewModal.users.length})
                        </div>
                        {viewModal.users.length === 0
                            ? <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No users.</p>
                            : viewModal.users.map((u) => (
                                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                                    <span className="badge badge-user">{u.role}</span>
                                    <span style={{ fontSize: '0.875rem' }}>{u.username}</span>
                                </div>
                            ))}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Files with this flag ({viewModal.files.length})
                        </div>
                        {viewModal.files.length === 0
                            ? <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No files.</p>
                            : viewModal.files.map((f) => (
                                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                                    <FileText size={14} style={{ color: 'var(--text-muted)' }} />
                                    <span style={{ fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
                                </div>
                            ))}
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ── SECTION: Users ─────────────────────────────────────────────────────────
function UsersTab({ adminId, flags, toast }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState(null); // 'create' | { edit: user }
    const [deleteUser, setDeleteUser] = useState(null);
    const [search, setSearch] = useState('');
    const [form, setForm] = useState({ username: '', password: '', flags: [], role: 'user' });
    const [saving, setSaving] = useState(false);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await adminUsersApi.getAll(adminId);
            setUsers(res.data.users || []);
        } catch { toast.error('Failed to load users'); } finally { setLoading(false); }
    };

    useEffect(() => { fetchUsers(); }, [adminId]);

    const openCreate = () => {
        setForm({ username: '', password: '', flags: [], role: 'user' });
        setModal('create');
    };
    const openEdit = (u) => {
        setForm({ username: u.username, password: '', flags: u.flags || [], role: u.role });
        setModal({ edit: u });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            if (modal === 'create') {
                if (!form.username || !form.password) { toast.error('Username and password are required'); setSaving(false); return; }
                await adminUsersApi.create(adminId, form);
                toast.success(`User "${form.username}" created`);
            } else {
                const payload = { flags: form.flags, role: form.role };
                if (form.password) payload.password = form.password;
                if (form.username !== modal.edit.username) payload.username = form.username;
                await adminUsersApi.update(adminId, modal.edit.id, payload);
                toast.success('User updated');
            }
            await fetchUsers();
            setModal(null);
        } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to save'); }
        finally { setSaving(false); }
    };

    const handleDelete = async () => {
        try {
            await adminUsersApi.delete(adminId, deleteUser.id);
            toast.success(`User "${deleteUser.username}" deleted`);
            await fetchUsers();
        } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to delete'); }
        finally { setDeleteUser(null); }
    };

    const filtered = users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase()));

    return (
        <div>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search users…" style={{ paddingLeft: '2rem', width: '100%' }} />
                </div>
                <button className="btn btn-secondary" onClick={fetchUsers}><RefreshCw size={14} /></button>
                <button id="users-create-btn" className="btn btn-primary" onClick={openCreate}><Plus size={14} /> Add User</button>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading && <div style={{ padding: '2rem', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}
                {!loading && filtered.length === 0 && (
                    <div className="empty-state"><Users size={32} /><p>No users found.</p></div>
                )}
                {!loading && filtered.length > 0 && (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Username</th><th>Role</th><th>Org Flags</th><th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((u) => (
                                <tr key={u.id}>
                                    <td className="highlight">{u.username}</td>
                                    <td>
                                        <span className={`badge ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>{u.role}</span>
                                    </td>
                                    <td>
                                        <div className="tags-list">
                                            {(u.flags || []).length === 0
                                                ? <span className="badge badge-public">no flags</span>
                                                : u.flags.map((f) => <span key={f} className="badge badge-accent">{f}</span>)
                                            }
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            <button id={`user-edit-${u.id}`} className="btn-icon" title="Edit" onClick={() => openEdit(u)}>
                                                <Pencil size={14} />
                                            </button>
                                            <button id={`user-delete-${u.id}`} className="btn-icon" title="Delete"
                                                onClick={() => setDeleteUser(u)} style={{ color: 'var(--danger)' }}
                                                disabled={u.id === adminId}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Create / Edit Modal */}
            {modal && (
                <Modal
                    title={modal === 'create' ? 'Create User' : `Edit User: ${modal.edit.username}`}
                    onClose={() => setModal(null)}
                    footer={<>
                        <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                        <button id="user-save-btn" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                            {saving ? <Loader2 size={14} /> : <Check size={14} />} Save
                        </button>
                    </>}
                >
                    <div className="form-group">
                        <label className="form-label">Username</label>
                        <input className="form-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                            placeholder="username" autoFocus />
                    </div>
                    <div className="form-group">
                        <label className="form-label">{modal === 'create' ? 'Password' : 'New Password (leave blank to keep)'}</label>
                        <input className="form-input" type="password" value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                            placeholder={modal === 'create' ? '••••••••' : 'Unchanged'} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">System Role</label>
                        <select className="form-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Org Flags</label>
                        <FlagChipSelector allFlags={flags} selected={form.flags} onChange={(fl) => setForm({ ...form, flags: fl })} />
                    </div>
                </Modal>
            )}

            {/* Delete Confirm */}
            {deleteUser && (
                <ConfirmModal
                    message={`Permanently delete user "${deleteUser.username}"? This cannot be undone.`}
                    onConfirm={handleDelete}
                    onCancel={() => setDeleteUser(null)}
                />
            )}
        </div>
    );
}

// ── SECTION: Files ─────────────────────────────────────────────────────────
function FilesTab({ adminId, flags, toast }) {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadModal, setUploadModal] = useState(false);
    const [editModal, setEditModal] = useState(null); // { file }
    const [deleteFile, setDeleteFile] = useState(null);
    const [deleteAll, setDeleteAll] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [uploadFlags, setUploadFlags] = useState([]);
    const [editFlags, setEditFlags] = useState([]);
    const [search, setSearch] = useState('');
    const fileInputRef = useRef(null);

    const fetchFiles = async () => {
        setLoading(true);
        try {
            const res = await adminFilesApi.getAll(adminId);
            setFiles(res.data.files || []);
        } catch { toast.error('Failed to load files'); } finally { setLoading(false); }
    };

    useEffect(() => { fetchFiles(); }, [adminId]);

    const handleUpload = async () => {
        if (!selectedFiles.length) { toast.error('Select at least one file'); return; }
        setUploading(true);
        try {
            if (selectedFiles.length === 1) {
                await adminFilesApi.upload(adminId, selectedFiles[0], uploadFlags);
            } else {
                await adminFilesApi.bulkUpload(adminId, selectedFiles, uploadFlags);
            }
            toast.success(`${selectedFiles.length} file(s) uploaded`);
            await fetchFiles();
            setUploadModal(false);
            setSelectedFiles([]);
            setUploadFlags([]);
        } catch (e) { toast.error(e?.response?.data?.detail || 'Upload failed'); }
        finally { setUploading(false); }
    };

    const handleUpdateFlags = async () => {
        if (!editModal) return;
        try {
            await adminFilesApi.setFlags(adminId, editModal.file.id, editFlags);
            toast.success('File flags updated');
            await fetchFiles();
            setEditModal(null);
        } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to update'); }
    };

    const handleDelete = async () => {
        try {
            await adminFilesApi.delete(adminId, deleteFile.id);
            toast.success(`File "${deleteFile.filename}" deleted`);
            await fetchFiles();
        } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to delete'); }
        finally { setDeleteFile(null); }
    };

    const handleDeleteAll = async () => {
        try {
            await adminFilesApi.deleteAll(adminId);
            toast.success('All files deleted');
            await fetchFiles();
        } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to delete all'); }
        finally { setDeleteAll(false); }
    };

    const filtered = files.filter((f) => f.filename.toLowerCase().includes(search.toLowerCase()));

    return (
        <div>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                    <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search files…" style={{ paddingLeft: '2rem', width: '100%' }} />
                </div>
                <button className="btn btn-secondary" onClick={fetchFiles}><RefreshCw size={14} /></button>
                <button className="btn btn-danger" onClick={() => setDeleteAll(true)}>
                    <Trash2 size={14} /> Delete All
                </button>
                <button id="files-upload-btn" className="btn btn-primary" onClick={() => setUploadModal(true)}>
                    <Upload size={14} /> Upload Files
                </button>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading && <div style={{ padding: '2rem', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}
                {!loading && filtered.length === 0 && (
                    <div className="empty-state"><FileText size={32} /><p>No files uploaded yet.</p></div>
                )}
                {!loading && filtered.length > 0 && (
                    <table className="data-table">
                        <thead>
                            <tr><th>Filename</th><th>Access Flags</th><th>Hash</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                        </thead>
                        <tbody>
                            {filtered.map((f) => (
                                <tr key={f.id}>
                                    <td className="highlight" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {f.filename}
                                    </td>
                                    <td>
                                        <div className="tags-list">
                                            {(f.flags || []).length === 0
                                                ? <span className="badge badge-public">Public</span>
                                                : f.flags.map((fl) => <span key={fl} className="badge badge-accent">{fl}</span>)
                                            }
                                        </div>
                                    </td>
                                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        {f.hash ? f.hash.slice(0, 10) + '…' : '—'}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            <button id={`file-edit-${f.id}`} className="btn-icon" title="Edit flags"
                                                onClick={() => { setEditFlags(f.flags || []); setEditModal({ file: f }); }}>
                                                <Pencil size={14} />
                                            </button>
                                            <button id={`file-delete-${f.id}`} className="btn-icon" title="Delete"
                                                onClick={() => setDeleteFile(f)} style={{ color: 'var(--danger)' }}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Upload Modal */}
            {uploadModal && (
                <Modal
                    title="Upload Knowledge Files"
                    onClose={() => { setUploadModal(false); setSelectedFiles([]); setUploadFlags([]); }}
                    footer={<>
                        <button className="btn btn-secondary" onClick={() => { setUploadModal(false); setSelectedFiles([]); setUploadFlags([]); }}>Cancel</button>
                        <button id="upload-submit-btn" className="btn btn-primary" onClick={handleUpload} disabled={uploading || !selectedFiles.length}>
                            {uploading ? <><Loader2 size={14} style={{ animation: 'spin 0.7s linear infinite' }} /> Uploading…</> : <><Upload size={14} /> Upload</>}
                        </button>
                    </>}
                >
                    <div
                        className={`drop-zone ${selectedFiles.length ? 'over' : ''}`}
                        style={{ marginBottom: '1.25rem', cursor: 'pointer' }}
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.preventDefault();
                            setSelectedFiles(Array.from(e.dataTransfer.files));
                        }}
                    >
                        <div className="drop-zone-icon"><Upload size={32} /></div>
                        {selectedFiles.length
                            ? <><strong style={{ color: 'var(--text-primary)' }}>{selectedFiles.length} file(s) selected</strong>
                                <p style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>{selectedFiles.map((f) => f.name).join(', ')}</p></>
                            : <><p style={{ fontWeight: 500 }}>Click or drag files here</p>
                                <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>PDF, DOCX, TXT and more</p></>
                        }
                        <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
                            onChange={(e) => setSelectedFiles(Array.from(e.target.files))} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Access Flags (leave empty for public access)</label>
                        <FlagChipSelector allFlags={flags} selected={uploadFlags} onChange={setUploadFlags} />
                        {uploadFlags.length === 0 && (
                            <p style={{ fontSize: '0.78rem', color: 'var(--info)', marginTop: '0.35rem' }}>
                                ℹ No flags = public file, visible to all users.
                            </p>
                        )}
                    </div>
                </Modal>
            )}

            {/* Edit flags modal */}
            {editModal && (
                <Modal
                    title={`Edit Flags: ${editModal.file.filename}`}
                    onClose={() => setEditModal(null)}
                    footer={<>
                        <button className="btn btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
                        <button id="file-flags-save-btn" className="btn btn-primary" onClick={handleUpdateFlags}>
                            <Check size={14} /> Save Flags
                        </button>
                    </>}
                >
                    <div className="form-group">
                        <label className="form-label">Access Flags</label>
                        <FlagChipSelector allFlags={flags} selected={editFlags} onChange={setEditFlags} />
                        {editFlags.length === 0 && (
                            <p style={{ fontSize: '0.78rem', color: 'var(--info)', marginTop: '0.35rem' }}>
                                ℹ No flags = public file, visible to all users.
                            </p>
                        )}
                    </div>
                </Modal>
            )}

            {deleteFile && (
                <ConfirmModal message={`Delete "${deleteFile.filename}"? This removes it from the knowledge base.`}
                    onConfirm={handleDelete} onCancel={() => setDeleteFile(null)} />
            )}
            {deleteAll && (
                <ConfirmModal message="Delete ALL files from the knowledge base? This cannot be undone."
                    onConfirm={handleDeleteAll} onCancel={() => setDeleteAll(false)} />
            )}
        </div>
    );
}

// ── SECTION: Audit ─────────────────────────────────────────────────────────
function AuditTab({ adminId, toast }) {
    const [activeAudit, setActiveAudit] = useState('feedbacks'); // 'feedbacks' | 'logs'
    const [feedbacks, setFeedbacks] = useState([]);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');

    const fetchFeedbacks = async () => {
        setLoading(true);
        try {
            const res = await adminAuditApi.getFeedbacks(adminId);
            setFeedbacks(res.data.feedbacks || []);
        } catch { toast.error('Failed to load feedbacks'); } finally { setLoading(false); }
    };

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const res = await adminAuditApi.getLogs(adminId);
            setLogs(res.data.logs || []);
        } catch { toast.error('Failed to load logs'); } finally { setLoading(false); }
    };

    useEffect(() => {
        if (activeAudit === 'feedbacks') fetchFeedbacks();
        else fetchLogs();
    }, [activeAudit, adminId]);

    const filteredFeedbacks = feedbacks.filter((f) =>
        (f.query || '').toLowerCase().includes(search.toLowerCase()) ||
        (f.output || '').toLowerCase().includes(search.toLowerCase())
    );
    const filteredLogs = logs.filter((l) =>
        (l.action || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div>
            <div style={{ display: 'flex', gap: '0', marginBottom: '1.25rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: '0.4rem', width: 'fit-content', border: '1px solid var(--border)' }}>
                {[{ id: 'feedbacks', label: 'AI Feedback', icon: BarChart2 }, { id: 'logs', label: 'Audit Log', icon: Book }].map(({ id, label, icon: Icon }) => (
                    <button key={id} onClick={() => { setActiveAudit(id); setSearch(''); }}
                        style={{
                            padding: '0.45rem 1rem', borderRadius: 'var(--radius)', fontSize: '0.875rem', fontWeight: 500,
                            background: activeAudit === id ? 'var(--bg-elevated)' : 'transparent',
                            color: activeAudit === id ? 'var(--text-primary)' : 'var(--text-secondary)',
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                        }}>
                        <Icon size={14} />{label}
                    </button>
                ))}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder={activeAudit === 'feedbacks' ? 'Search queries…' : 'Search log actions…'}
                        style={{ paddingLeft: '2rem', width: '100%' }} />
                </div>
                <button className="btn btn-secondary" onClick={activeAudit === 'feedbacks' ? fetchFeedbacks : fetchLogs}>
                    <RefreshCw size={14} />
                </button>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading && <div style={{ padding: '2rem', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}

                {/* Feedbacks */}
                {!loading && activeAudit === 'feedbacks' && (
                    <>
                        {filteredFeedbacks.length === 0 && <div className="empty-state"><BarChart2 size={32} /><p>No AI feedback yet.</p></div>}
                        {filteredFeedbacks.length > 0 && (
                            <table className="data-table">
                                <thead>
                                    <tr><th>Timestamp</th><th>User</th><th>Query</th><th>Rating</th><th>Feedback</th></tr>
                                </thead>
                                <tbody>
                                    {filteredFeedbacks.map((f) => (
                                        <tr key={f.id}>
                                            <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{FMT(f.timestamp)}</td>
                                            <td>{f.user_id}</td>
                                            <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {f.query}
                                            </td>
                                            <td>
                                                {f.rating === 'up'
                                                    ? <span className="badge badge-user" style={{ display: 'inline-flex', gap: '0.25rem' }}><ThumbsUp size={11} /> Good</span>
                                                    : f.rating === 'down'
                                                        ? <span className="badge badge-danger" style={{ display: 'inline-flex', gap: '0.25rem' }}><ThumbsDown size={11} /> Poor</span>
                                                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                                                }
                                            </td>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {f.feedback || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </>
                )}

                {/* Logs */}
                {!loading && activeAudit === 'logs' && (
                    <>
                        {filteredLogs.length === 0 && <div className="empty-state"><Book size={32} /><p>No audit logs yet.</p></div>}
                        {filteredLogs.length > 0 && (
                            <table className="data-table">
                                <thead><tr><th>Timestamp</th><th>Action</th></tr></thead>
                                <tbody>
                                    {filteredLogs.map((l) => (
                                        <tr key={l.id}>
                                            <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{FMT(l.timestamp)}</td>
                                            <td style={{ fontSize: '0.85rem' }}>{l.action}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

// ── MAIN Admin Page ─────────────────────────────────────────────────────────
const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart2 },
    { id: 'flags', label: 'Org Flags', icon: Tag },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'files', label: 'Files', icon: FileText },
    { id: 'audit', label: 'Audit', icon: Eye },
];

export default function AdminPage() {
    const navigate = useNavigate();
    const session = JSON.parse(localStorage.getItem('rbac_session') || 'null');
    const adminId = session?.userId;

    const [activeTab, setActiveTab] = useState('dashboard');
    const [flags, setFlags] = useState([]);
    const [toastMsg, setToastMsg] = useState(null);

    const notify = {
        success: (msg) => setToastMsg({ message: msg, type: 'success' }),
        error: (msg) => setToastMsg({ message: msg, type: 'error' }),
    };

    // Load flags globally (needed by users & files tabs)
    const loadFlags = async () => {
        try {
            const res = await adminFlagsApi.getAll(adminId);
            setFlags(res.data.flags || []);
        } catch { /* ignore */ }
    };
    useEffect(() => { if (adminId) loadFlags(); }, [adminId]);

    const handleLogout = () => { localStorage.removeItem('rbac_session'); navigate('/'); };

    if (!session) return null;

    return (
        <div className="app-layout">
            {/* ── Sidebar ── */}
            <div className="sidebar">
                <div className="brand">
                    <div className="brand-icon"><Shield size={16} color="#fff" /></div>
                    <span className="brand-name">RBAC Admin</span>
                </div>

                {/* Admin badge */}
                <div style={{ padding: '0.75rem', margin: '0.5rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '2rem', height: '2rem', borderRadius: '50%', background: 'linear-gradient(135deg, var(--warning), #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem' }}>
                            {(session.username || 'A')[0].toUpperCase()}
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{session.username}</div>
                            <div><span className="badge badge-admin" style={{ fontSize: '0.68rem' }}>Administrator</span></div>
                        </div>
                    </div>
                </div>

                <div className="sidebar-content" style={{ padding: '0.5rem 0.5rem 0' }}>
                    <div className="nav-section-label">Management</div>
                    {TABS.map(({ id, label, icon: Icon }) => (
                        <div
                            key={id}
                            id={`admin-tab-${id}`}
                            className={`nav-item ${activeTab === id ? 'active' : ''}`}
                            onClick={() => setActiveTab(id)}
                        >
                            <Icon size={16} />{label}
                        </div>
                    ))}
                </div>

                <div className="sidebar-footer">
                    <button id="admin-logout" className="nav-item" style={{ width: '100%' }} onClick={handleLogout}>
                        <LogOut size={15} /> Sign out
                    </button>
                </div>
            </div>

            {/* ── Main Content ── */}
            <div className="main-content">
                <div className="page-header">
                    <h1 className="page-title">
                        {TABS.find((t) => t.id === activeTab)?.label}
                    </h1>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        RBAC Management Console
                    </div>
                </div>

                <div className="page-body">
                    {activeTab === 'dashboard' && <DashboardTab adminId={adminId} />}
                    {activeTab === 'flags' && <FlagsTab adminId={adminId} flags={flags} setFlags={setFlags} toast={notify} />}
                    {activeTab === 'users' && <UsersTab adminId={adminId} flags={flags} toast={notify} />}
                    {activeTab === 'files' && <FilesTab adminId={adminId} flags={flags} toast={notify} />}
                    {activeTab === 'audit' && <AuditTab adminId={adminId} toast={notify} />}
                </div>
            </div>

            {toastMsg && (
                <Toast message={toastMsg.message} type={toastMsg.type} onClose={() => setToastMsg(null)} />
            )}
        </div>
    );
}
