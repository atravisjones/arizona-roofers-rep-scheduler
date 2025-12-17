import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardIcon, TrashIcon, XIcon, HistoryIcon } from './icons';

interface DebugLogModalProps {
    isOpen: boolean;
    onClose: () => void;
    logs: string[];
    onClear: () => void;
}

const DebugLogModal: React.FC<DebugLogModalProps> = ({ isOpen, onClose, logs, onClear }) => {
    const [copySuccess, setCopySuccess] = useState(false);
    const logContainerRef = useRef<HTMLPreElement>(null);

    useEffect(() => {
        if (isOpen && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, isOpen]);

    const handleCopy = () => {
        if (logs.length > 0) {
            navigator.clipboard.writeText(logs.join('\n')).then(() => {
                setCopySuccess(true);
                setTimeout(() => setCopySuccess(false), 2000);
            });
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 bg-bg-secondary/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
            <div className="popup-surface w-full max-w-lg max-h-[60vh] flex flex-col overflow-hidden animate-fade-in shadow-2xl rounded-lg border border-border-primary" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-bg-secondary px-4 py-3 border-b border-border-primary flex justify-between items-center">
                    <h3 className="font-bold text-text-primary text-lg flex items-center gap-2">
                        <HistoryIcon className="h-5 w-5 text-brand-primary" />
                        Debug Log
                        <span className="text-xs bg-bg-tertiary text-text-secondary font-mono rounded-full px-2 py-0.5">{logs.length}</span>
                    </h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-bg-tertiary rounded-md transition-colors">
                        <XIcon className="h-5 w-5 text-text-tertiary" />
                    </button>
                </div>

                {/* Log Content */}
                <pre ref={logContainerRef} className="text-[11px] leading-4 text-text-secondary bg-bg-secondary p-3 flex-1 overflow-y-auto font-mono min-h-[200px]">
                    {logs.length > 0 ? logs.join('\n') : 'No log messages yet.'}
                </pre>

                {/* Footer */}
                <div className="p-3 bg-bg-tertiary border-t border-border-primary flex justify-end space-x-2">
                    <button
                        onClick={handleCopy}
                        className={`flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-md transition ${copySuccess ? 'bg-tag-green-bg text-tag-green-text' : 'bg-bg-quaternary text-text-primary hover:bg-border-primary'}`}
                    >
                        <ClipboardIcon className="h-3.5 w-3.5" />
                        <span>{copySuccess ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <button
                        onClick={onClear}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-tag-red-bg hover:bg-tag-red-bg/80 text-xs text-tag-red-text font-semibold rounded-md transition"
                    >
                        <TrashIcon className="h-3.5 w-3.5" />
                        <span>Clear</span>
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default DebugLogModal;