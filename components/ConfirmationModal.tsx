import React from 'react';
import { XIcon } from './icons';

interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
    isDangerous?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
    confirmLabel = "Yes",
    cancelLabel = "No",
    isDangerous = false
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={onCancel}>
            <div className="popup-surface w-full max-w-md flex flex-col animate-fade-in shadow-2xl rounded-xl overflow-hidden ring-1 ring-border-primary" onClick={e => e.stopPropagation()}>
                <header className="px-6 py-4 border-b border-border-primary flex justify-between items-center bg-bg-secondary/50">
                    <h2 className="text-lg font-bold text-text-primary">{title}</h2>
                    <button onClick={onCancel} className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-tertiary transition">
                        <XIcon className="h-5 w-5" />
                    </button>
                </header>

                <div className="p-6">
                    <p className="text-sm text-text-secondary leading-relaxed">
                        {message}
                    </p>
                </div>

                <footer className="px-6 py-4 bg-bg-secondary/30 border-t border-border-primary flex justify-end gap-3 rounded-b-xl">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-primary hover:bg-bg-tertiary rounded-lg transition-colors border border-transparent hover:border-border-secondary"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-6 py-2 text-sm font-bold text-white rounded-lg shadow-md transition-all active:scale-95 ${isDangerous
                            ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                            : 'bg-brand-primary hover:bg-brand-secondary shadow-brand-primary/20'
                            }`}
                    >
                        {confirmLabel}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default ConfirmationModal;
