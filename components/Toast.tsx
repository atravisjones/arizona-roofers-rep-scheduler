import React, { useEffect } from 'react';
import { XIcon } from './icons';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastData {
    id: string;
    message: string;
    type: ToastType;
    duration?: number;
}

interface ToastProps {
    toast: ToastData;
    onDismiss: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
    useEffect(() => {
        if (toast.duration !== 0) {
            const timer = setTimeout(() => {
                onDismiss(toast.id);
            }, toast.duration || 4000);
            return () => clearTimeout(timer);
        }
    }, [toast, onDismiss]);

    const typeStyles: Record<ToastType, string> = {
        success: 'bg-green-500/10 border-green-500/50 text-green-400',
        error: 'bg-red-500/10 border-red-500/50 text-red-400',
        info: 'bg-blue-500/10 border-blue-500/50 text-blue-400',
        warning: 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400',
    };

    const iconStyles: Record<ToastType, string> = {
        success: 'text-green-400',
        error: 'text-red-400',
        info: 'text-blue-400',
        warning: 'text-yellow-400',
    };

    const icons: Record<ToastType, React.ReactNode> = {
        success: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
        ),
        error: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        ),
        info: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
        warning: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        ),
    };

    return (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm animate-slide-in ${typeStyles[toast.type]}`}>
            <span className={iconStyles[toast.type]}>{icons[toast.type]}</span>
            <span className="text-sm font-medium text-text-primary flex-1">{toast.message}</span>
            <button
                onClick={() => onDismiss(toast.id)}
                className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-bg-tertiary transition"
            >
                <XIcon className="h-4 w-4" />
            </button>
        </div>
    );
};

interface ToastContainerProps {
    toasts: ToastData[];
    onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
            {toasts.map(toast => (
                <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
            ))}
        </div>
    );
};

export default Toast;
