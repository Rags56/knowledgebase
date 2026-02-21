import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const API_KEY = import.meta.env.VITE_API_KEY || 'blockexe123';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: { 'Content-Type': 'application/json' },
    paramsSerializer: { indexes: null }, // flags=a&flags=b (not flags[0]=a)
});

api.interceptors.request.use((config) => {
    config.headers['X-API-Key'] = API_KEY;
    return config;
});

// ── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
    login: (username, password) =>
        api.post('/login', null, { params: { username, password } }),
};

// ── Admin – Users ─────────────────────────────────────────────────────────────
export const adminUsersApi = {
    getAll: (adminId) =>
        api.get('/admin/get-all-users', { params: { admin_id: adminId } }),

    create: (adminId, { username, password, flags, role }) =>
        api.post('/admin/create-user', { username, password, flags, role }, {
            params: { admin_id: adminId },
        }),

    update: (adminId, userId, payload) =>
        api.put(`/admin/update-user/${userId}`, payload, {
            params: { admin_id: adminId },
        }),

    delete: (adminId, userId) =>
        api.delete(`/admin/delete-user/${userId}`, {
            params: { admin_id: adminId },
        }),

    setFlags: (adminId, userId, flags) =>
        api.put(`/admin/set-user-flags/${userId}`, null, {
            params: { admin_id: adminId, flags },
        }),

    setRole: (adminId, userId, role) =>
        api.put(`/admin/set-user-role/${userId}`, null, {
            params: { admin_id: adminId, role },
        }),
};

// ── Admin – Files ─────────────────────────────────────────────────────────────
export const adminFilesApi = {
    getAll: (adminId) =>
        api.get('/admin/get-all-files', { params: { admin_id: adminId } }),

    upload: (adminId, file, flags = []) => {
        const form = new FormData();
        form.append('file', file);
        return api.post('/admin/upload-file', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            params: { admin_id: adminId, flags },
        });
    },

    bulkUpload: (adminId, files, flags = []) => {
        const form = new FormData();
        files.forEach((f) => form.append('files', f));
        return api.post('/admin/bulk-upload', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            params: { admin_id: adminId, flags },
        });
    },

    setFlags: (adminId, fileId, flags) =>
        api.put(`/admin/set-file-flags/${fileId}`, null, {
            params: { admin_id: adminId, flags },
        }),

    delete: (adminId, fileId) =>
        api.delete(`/admin/delete-file/${fileId}`, {
            params: { admin_id: adminId },
        }),

    deleteAll: (adminId) =>
        api.delete('/admin/delete-all-files', {
            params: { admin_id: adminId },
        }),
};

// ── Admin – Flags ─────────────────────────────────────────────────────────────
export const adminFlagsApi = {
    getAll: (adminId) =>
        api.get('/admin/flags', { params: { admin_id: adminId } }),

    create: (adminId, { name, description }) =>
        api.post('/admin/flags', { name, description }, {
            params: { admin_id: adminId },
        }),

    update: (adminId, flagId, { name, description }) =>
        api.put(`/admin/flags/${flagId}`, { name, description }, {
            params: { admin_id: adminId },
        }),

    delete: (adminId, flagId) =>
        api.delete(`/admin/flags/${flagId}`, {
            params: { admin_id: adminId },
        }),

    getUsersWithFlag: (adminId, flagId) =>
        api.get(`/admin/flags/${flagId}/users`, { params: { admin_id: adminId } }),

    getFilesWithFlag: (adminId, flagId) =>
        api.get(`/admin/flags/${flagId}/files`, { params: { admin_id: adminId } }),
};

// ── Admin – Audit ─────────────────────────────────────────────────────────────
export const adminAuditApi = {
    getLogs: (adminId) => api.get('/admin/get-logs', { params: { admin_id: adminId } }),
    getFeedbacks: (adminId) => api.get('/admin/get-all-feedbacks', { params: { admin_id: adminId } }),
};

// ── User ──────────────────────────────────────────────────────────────────────
export const userApi = {
    me: (userId) => api.get('/user/me', { params: { user_id: userId } }),
    getFiles: (userId) => api.get('/files', { params: { user_id: userId } }),
    getSessions: (userId) => api.get('/get-user-chat-sessions', { params: { user_id: userId } }),
    getHistory: (sessionId) => api.get('/get-chat-history', { params: { session_id: sessionId } }),

    rag: (query, sessionId, userId) =>
        api.post('/rag', null, {
            params: { query, session_id: sessionId, user_id: userId },
        }),

    submitFeedback: (auditId, rating, feedback) =>
        api.post('/submit-feedback', { audit_id: auditId, rating, feedback }),
};

export default api;
