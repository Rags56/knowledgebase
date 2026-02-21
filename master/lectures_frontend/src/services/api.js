import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const API_KEY = import.meta.env.VITE_API_KEY || 'blockexe123';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    paramsSerializer: {
        indexes: null // Result: flags=1&flags=2 instead of flags[]=1
    }
});


api.interceptors.request.use((config) => {
    config.headers['X-API-Key'] = API_KEY;
    return config;
});

export const authApi = {
    login: (userId) => api.post(`/login`, null, { params: { user_id: userId } }),
    createLecture: (id, name) => api.post('/create-lecture', {
        lecture_id: id,
        name: name,
        files: []
    }),
    createUser: (userId, flags = []) => api.post('/create-user', {
        user_id: userId,
        flags: flags
    }),
};

export const adminApi = {
    getAllLectures: () => api.get('/get-all-lectures'),
    getAllUsers: () => api.get('/get-all-users'),

    // Lecture management
    createLecture: (id, name, files = []) => api.post('/create-lecture', { lecture_id: id, name, files }),
    editLecture: (id, name, files = []) => api.post('/edit-lecture', null, { params: { lecture_id: id, name, files } }),
    deleteLecture: (id) => api.post('/delete-lecture', null, { params: { lecture_id: id } }),

    // File management
    uploadFile: (lectureId, file) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post(`/upload-file/${lectureId}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },
    deleteFile: (lectureId, filename) => api.post(`/delete-file/${lectureId}`, null, { params: { filename } }),
    deleteAllFiles: (lectureId) => api.post('/delete-all-files', null, { params: { lecture_id: lectureId } }),

    // Student management
    addStudentFlags: (userId, flags) => api.post('/add-student-flags', null, { params: { user_id: userId, flags } }),
    deleteStudent: (userId) => api.post('/delete-student', null, { params: { user_id: userId } }),

    getAllFeedbacks: () => api.get('/get-all-feedbacks'),
};

export const userApi = {
    getLectures: (userId) => api.get('/get-lectures', { params: { user_id: userId } }),
    getSessions: (userId) => api.get('/get-user-chat-sessions', { params: { user_id: userId } }),
    getChatHistory: (sessionId) => api.get('/get-chat-history', { params: { session_id: sessionId } }),

    submitFeedback: (auditId, rating, feedback) => {
        return api.post('/submit-feedback', {
            audit_id: auditId,
            rating: rating,
            feedback: feedback
        });
    },

    rag: async (query, sessionId, userId, lectureId) => {
        return api.post('/rag', null, {
            params: {
                query,
                session_id: sessionId,
                user_id: userId,
                lecture_id: lectureId
            }
        });
    }
};

export default api;
