import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, Loader2 } from 'lucide-react';
import { authApi } from '../services/api';

export default function Login() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async (e) => {
        e.preventDefault();
        if (!username.trim() || !password.trim()) {
            setError('Please enter your username and password.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await authApi.login(username.trim(), password);
            const data = res.data;
            if (data.status === 'ok') {
                const session = {
                    userId: data.user_id,
                    username: data.username,
                    flags: data.flags,
                    role: data.role,
                };
                localStorage.setItem('rbac_session', JSON.stringify(session));
                navigate(data.role === 'admin' ? '/admin' : '/user');
            } else {
                setError('Login failed. Please check your credentials.');
            }
        } catch (err) {
            const detail = err?.response?.data?.detail;
            setError(detail || 'Invalid credentials. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                {/* Logo */}
                <div className="auth-logo">
                    <div className="auth-logo-icon">
                        <Shield size={22} color="#fff" />
                    </div>
                    <span className="auth-title">RBAC Knowledge Base</span>
                </div>
                <p className="auth-subtitle">
                    Sign in with your organisational credentials to access knowledge relevant to your role.
                </p>

                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label className="form-label">Username</label>
                        <input
                            id="rbac-username"
                            className="form-input"
                            type="text"
                            placeholder="your.username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="username"
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                id="rbac-password"
                                className="form-input"
                                type={showPassword ? 'text' : 'password'}
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                                style={{ paddingRight: '2.75rem' }}
                            />
                            <button
                                type="button"
                                className="btn-ghost"
                                title={showPassword ? 'Hide password' : 'Show password'}
                                onClick={() => setShowPassword((v) => !v)}
                                style={{
                                    position: 'absolute', right: '0.6rem', top: '50%',
                                    transform: 'translateY(-50%)', color: 'var(--text-muted)',
                                }}
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="form-error" style={{ marginBottom: '0.75rem' }}>
                            {error}
                        </div>
                    )}

                    <button
                        id="rbac-login-btn"
                        type="submit"
                        className="btn btn-primary"
                        disabled={loading}
                        style={{ width: '100%', justifyContent: 'center', padding: '0.7rem', marginTop: '0.5rem', borderRadius: 'var(--radius-lg)' }}
                    >
                        {loading ? <><Loader2 size={16} className="spinner" style={{ animation: 'spin 0.7s linear infinite' }} /> Signing in…</> : 'Sign In'}
                    </button>
                </form>

                <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Your access level is determined by your&nbsp;
                    <span style={{ color: 'var(--accent-light)' }}>organisational flags</span>&nbsp;
                    and&nbsp;<span style={{ color: 'var(--warning)' }}>role</span>.
                </p>
            </div>
        </div>
    );
}
