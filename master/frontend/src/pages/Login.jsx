import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { authApi } from "../services/api";

export default function Login() {
    const navigate = useNavigate();
    const [studentId, setStudentId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleStudentLogin = async () => {
        if (!studentId) return;
        setLoading(true);
        setError(null);
        try {
            // Basic login check
            const res = await authApi.login(studentId);
            if (res.data.status === 'ok') {
                localStorage.setItem("userId", studentId);
                navigate("/user");
            } else {
                setError("Invalid Student ID");
            }
        } catch {
            setError("Login failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="card">
                <h1 className="heading">Knowledge Base Portal</h1>

                <div className="form-group" style={{ marginBottom: "2rem" }}>
                    <button
                        className="btn btn-secondary"
                        style={{ width: "100%", justifyContent: "center" }}
                        onClick={() => navigate("/admin")}
                    >
                        Admin Access
                    </button>
                </div>

                <div className="form-group">
                    <label className="label">Student Login</label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                        <input
                            type="text"
                            placeholder="Enter Student ID"
                            value={studentId}
                            onChange={(e) => setStudentId(e.target.value)}
                            style={{ flex: 1 }}
                        />
                        <button
                            className="btn btn-primary"
                            onClick={handleStudentLogin}
                            disabled={loading}
                        >
                            {loading ? <div className="spinner" style={{ width: "1rem", height: "1rem" }} /> : "Login"}
                        </button>
                    </div>
                    {error && <p style={{ color: "var(--danger)", marginTop: "0.5rem", fontSize: "0.875rem" }}>{error}</p>}
                </div>
            </div>
        </div>
    );
}
