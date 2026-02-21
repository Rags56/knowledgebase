import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AdminPage from './pages/Admin';
import UserPage from './pages/User';

function ProtectedAdmin({ children }) {
  const sess = JSON.parse(localStorage.getItem('rbac_session') || 'null');
  if (!sess || sess.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function ProtectedUser({ children }) {
  const sess = JSON.parse(localStorage.getItem('rbac_session') || 'null');
  if (!sess) return <Navigate to="/" replace />;
  if (sess.role === 'admin') return <Navigate to="/admin" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/admin" element={<ProtectedAdmin><AdminPage /></ProtectedAdmin>} />
        <Route path="/user" element={<ProtectedUser><UserPage /></ProtectedUser>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
