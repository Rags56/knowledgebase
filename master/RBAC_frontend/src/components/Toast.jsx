import { useEffect } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

export function Toast({ message, type = 'success', onClose }) {
    useEffect(() => {
        const t = setTimeout(onClose, 3500);
        return () => clearTimeout(t);
    }, [onClose]);

    return (
        <div className={`toast ${type}`}>
            {type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
            <span>{message}</span>
            <button className="btn-ghost" style={{ marginLeft: '0.5rem', padding: '0.1rem' }} onClick={onClose}>
                <X size={14} />
            </button>
        </div>
    );
}

export function useToast(setToast) {
    return {
        success: (msg) => setToast({ message: msg, type: 'success' }),
        error: (msg) => setToast({ message: msg, type: 'error' }),
    };
}
