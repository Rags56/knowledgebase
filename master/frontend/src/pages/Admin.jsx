import { useState, useEffect } from "react";
import { adminApi, authApi } from "../services/api";
import { Trash2, Upload, Plus, Users, Book, FileText, CheckCircle } from "lucide-react";

export default function Admin() {

    const [activeTab, setActiveTab] = useState("lectures");
    const [lectures, setLectures] = useState([]);
    const [users, setUsers] = useState([]);
    const [feedbacks, setFeedbacks] = useState([]); // New state
    const [loading, setLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [uploading, setUploading] = useState(null); // lectureId

    // Forms
    const [newLecture, setNewLecture] = useState({ id: "", name: "" });
    const [newUser, setNewUser] = useState({ id: "", flags: "" });

    const fetchData = async () => {
        setLoading(true);
        try {
            if (activeTab === "lectures") {
                const res = await adminApi.getAllLectures();
                setLectures(res.data.lectures || []);
            } else if (activeTab === "users") {
                const res = await adminApi.getAllUsers();
                setUsers(res.data.users || []);
            } else if (activeTab === "stats") {
                const res = await adminApi.getAllFeedbacks();
                setFeedbacks(res.data.feedbacks || []);
            }
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    const handleCreateLecture = async () => {
        if (!newLecture.id || !newLecture.name) return;
        try {
            await adminApi.createLecture(newLecture.id, newLecture.name);
            setNewLecture({ id: "", name: "" });
            fetchData();
        } catch {
            alert("Failed to create lecture");
        }
    };

    const handleCreateUser = async () => {
        if (!newUser.id) return;
        try {
            const flags = newUser.flags.split(",").map(f => f.trim()).filter(f => f);
            await authApi.createUser(newUser.id, flags);
            setNewUser({ id: "", flags: "" });
            fetchData();
        } catch {
            alert("Failed to create user");
        }
    };

    const handleUpload = async (lectureId) => {
        if (!selectedFile) return;
        setUploading(lectureId);
        try {
            await adminApi.uploadFile(lectureId, selectedFile);
            alert("Uploaded!");
            setSelectedFile(null);
        } catch {
            alert("Upload failed");
        } finally {
            setUploading(null);
        }
    };

    const handleDeleteFiles = async (lectureId) => {
        if (!confirm("Are you sure you want to delete all files for this lecture?")) return;
        try {
            await adminApi.deleteAllFiles(lectureId);
            alert("Files deleted");
            fetchData(); // Refresh to show empty
        } catch {
            alert("Failed to delete files");
        }
    };

    const handleDeleteFile = async (lectureId, filename) => {
        if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
        try {
            await adminApi.deleteFile(lectureId, filename);
            alert("File deleted");
            fetchData();
        } catch {
            alert("Failed to delete file");
        }
    };

    const handleManageUser = (user) => {
        const flags = prompt("Enter new flags (comma separated):", user[2] || "");
        if (flags === null) return;

        const flagList = flags.split(",").map(f => f.trim()).filter(f => f);
        try {
            adminApi.addStudentFlags(user[0], flagList).then(() => {
                fetchData();
            });
        } catch {
            alert("Failed to update flags");
        }
    };

    return (
        <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
            <header style={{ display: "flex", justifyContent: "space-between", marginBottom: "2rem" }}>
                <h1 className="heading" style={{ margin: 0 }}>Admin Dashboard</h1>
                <div style={{ display: "flex", gap: "1rem" }}>
                    <button
                        className={`btn ${activeTab === "lectures" ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => setActiveTab("lectures")}
                    >
                        <Book size={18} /> Lectures
                    </button>
                    <button
                        className={`btn ${activeTab === "users" ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => setActiveTab("users")}
                    >
                        <Users size={18} /> Users
                    </button>
                    <button
                        className={`btn ${activeTab === "stats" ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => setActiveTab("stats")}
                    >
                        <CheckCircle size={18} /> Feedback
                    </button>
                </div>
            </header>

            {activeTab === "lectures" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                    {/* Create Lecture */}
                    <div className="card" style={{ maxWidth: "100%" }}>
                        <h3>Create New Lecture</h3>
                        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                            <input
                                placeholder="Lecture ID (e.g., 101)"
                                value={newLecture.id}
                                onChange={(e) => setNewLecture({ ...newLecture, id: e.target.value })}
                            />
                            <input
                                placeholder="Lecture Name"
                                value={newLecture.name}
                                onChange={(e) => setNewLecture({ ...newLecture, name: e.target.value })}
                                style={{ flex: 1 }}
                            />
                            <button className="btn btn-primary" onClick={handleCreateLecture}>
                                <Plus size={18} /> Create
                            </button>
                        </div>
                    </div>

                    {/* List Lectures */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem" }}>
                        {lectures.map((lecture) => (
                            <div key={lecture[0]} className="card">
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
                                    <h4 style={{ fontSize: "1.1rem" }}>{lecture[1]} <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>#{lecture[0]}</span></h4>
                                    <button className="btn btn-danger" style={{ padding: "0.25rem" }} onClick={() => handleDeleteFiles(lecture[0])}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>

                                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                    <input
                                        type="file"
                                        onChange={(e) => setSelectedFile(e.target.files[0])}
                                        style={{ fontSize: "0.8rem", padding: "0.25rem" }}
                                    />
                                    <button
                                        className="btn btn-secondary"
                                        disabled={uploading === lecture[0]}
                                        onClick={() => handleUpload(lecture[0])}
                                    >
                                        {uploading === lecture[0] ? <div className="spinner" /> : <Upload size={16} />}
                                    </button>
                                </div>
                                <div style={{ marginTop: "1rem" }}>
                                    <h5 style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>Files:</h5>
                                    {(() => {
                                        try {
                                            const files = JSON.parse(lecture[2] || "[]");
                                            if (files.length === 0) return <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No files uploaded.</p>;
                                            return (
                                                <ul style={{ listStyle: "none", padding: 0 }}>
                                                    {files.map((f, i) => (
                                                        <li key={i} style={{
                                                            display: "flex",
                                                            justifyContent: "space-between",
                                                            alignItems: "center",
                                                            padding: "0.25rem 0",
                                                            fontSize: "0.85rem",
                                                            borderBottom: "1px solid var(--border)"
                                                        }}>
                                                            <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                                <FileText size={14} /> {f.filename}
                                                            </span>
                                                            <button
                                                                className="btn btn-danger"
                                                                style={{ padding: "0.1rem", height: "auto" }}
                                                                onClick={() => handleDeleteFile(lecture[0], f.filename)}
                                                            >
                                                                <Trash2 size={12} />
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            );
                                        } catch (e) {
                                            return <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>Error parsing files</p>;
                                        }
                                    })()}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === "users" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                    {/* Create User */}
                    <div className="card" style={{ maxWidth: "100%" }}>
                        <h3>Create User</h3>
                        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                            <input
                                placeholder="User ID"
                                value={newUser.id}
                                onChange={(e) => setNewUser({ ...newUser, id: e.target.value })}
                            />
                            <input
                                placeholder="Flags (comma separated)"
                                value={newUser.flags}
                                onChange={(e) => setNewUser({ ...newUser, flags: e.target.value })}
                                style={{ flex: 1 }}
                            />
                            <button className="btn btn-primary" onClick={handleCreateUser}>
                                <Plus size={18} /> Create
                            </button>
                        </div>
                    </div>

                    {/* List Users */}
                    <div className="card" style={{ maxWidth: "100%" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                                    <th style={{ padding: "1rem" }}>ID</th>
                                    <th style={{ padding: "1rem" }}>Flags</th>
                                    <th style={{ padding: "1rem" }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((user) => (
                                    <tr key={user[0]} style={{ borderBottom: "1px solid var(--border)" }}>
                                        <td style={{ padding: "1rem" }}>{user[0]}</td>
                                        <td style={{ padding: "1rem" }}>
                                            <span style={{
                                                background: "var(--bg-elevated)",
                                                padding: "0.25rem 0.5rem",
                                                borderRadius: "4px",
                                                fontSize: "0.875rem"
                                            }}>
                                                {user[2] || "None"}
                                            </span>
                                        </td>
                                        <td style={{ padding: "1rem" }}>
                                            <button className="btn btn-secondary" style={{ fontSize: "0.8rem" }} onClick={() => handleManageUser(user)}>Manage</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === "stats" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                    <div className="card" style={{ maxWidth: "100%" }}>
                        <h3 style={{ marginBottom: "1rem" }}>User Feedback</h3>
                        {feedbacks.length === 0 ? (
                            <p style={{ color: "var(--text-muted)" }}>No feedback yet.</p>
                        ) : (
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                    <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                                        <th style={{ padding: "1rem" }}>Time</th>
                                        <th style={{ padding: "1rem" }}>User</th>
                                        <th style={{ padding: "1rem" }}>Query</th>
                                        <th style={{ padding: "1rem" }}>Response</th>
                                        <th style={{ padding: "1rem" }}>Rating</th>
                                        <th style={{ padding: "1rem" }}>Feedback</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {feedbacks.map((fb) => (
                                        <tr key={fb.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                            <td style={{ padding: "1rem", whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                                                {new Date(fb.timestamp).toLocaleString()}
                                            </td>
                                            <td style={{ padding: "1rem" }}>{fb.user_id}</td>
                                            <td style={{ padding: "1rem", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fb.query}>
                                                {fb.query}
                                            </td>
                                            <td style={{ padding: "1rem", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fb.output}>
                                                {fb.output}
                                            </td>
                                            <td style={{ padding: "1rem" }}>
                                                {fb.rating === 'up' ?
                                                    <span style={{ color: "var(--success)" }}><CheckCircle size={16} /> Up</span> :
                                                    (fb.rating === 'down' ? <span style={{ color: "var(--danger)" }}><Trash2 size={16} /> Down</span> : "None")
                                                }
                                            </td>
                                            <td style={{ padding: "1rem" }}>{fb.feedback || "-"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
