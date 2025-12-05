import React, { useState, useRef, useEffect } from 'react';
import { ClipboardIcon, ChevronDownIcon, ChevronUpIcon, TrashIcon } from './icons';

interface DebugLogProps {
    logs: string[];
    onClear: () => void;
}

const DebugLog: React.FC<DebugLogProps> = ({ logs, onClear }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const logContainerRef = React.useRef<HTMLPreElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isExpanded && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, isExpanded]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsExpanded(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [wrapperRef]);

    const handleCopy = () => {
        if (logs.length > 0) {
            navigator.clipboard.writeText(logs.join('\n')).then(() => {
                setCopySuccess(true);
                setTimeout(() => setCopySuccess(false), 2000);
            });
        }
    };

    return (
        <div ref={wrapperRef} className="relative">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center space-x-2 px-2 py-1 bg-bg-primary border border-border-primary rounded-md shadow-sm hover:bg-bg-secondary transition"
                title={`Debug Log (${logs.length} entries)`}
            >
                <span className="text-xs font-semibold text-text-secondary">Log</span>
                <span className="text-xs bg-bg-tertiary text-text-secondary font-mono rounded-full px-1.5 py-0">{logs.length}</span>
                {isExpanded ? <ChevronDownIcon className="h-4 w-4 text-text-quaternary" /> : <ChevronUpIcon className="h-4 w-4 text-text-quaternary" />}
            </button>
            {isExpanded && (
                <div className="popup-surface absolute top-full right-0 mt-2 w-80 z-50 overflow-hidden">
                    <pre ref={logContainerRef} className="text-[11px] leading-4 text-text-secondary bg-bg-secondary p-2 h-40 overflow-y-auto font-mono">
                        {logs.length > 0 ? logs.join('\n') : 'No log messages yet.'}
                    </pre>
                    <div className="p-1.5 bg-bg-tertiary border-t border-border-primary flex justify-end space-x-2">
                        <button
                            onClick={handleCopy}
                            className={`flex items-center space-x-1 px-2 py-0.5 text-xs font-semibold rounded-md transition ${copySuccess ? 'bg-tag-green-bg text-tag-green-text' : 'bg-bg-quaternary text-text-primary hover:bg-border-primary'}`}
                        >
                            <ClipboardIcon className="h-3 w-3" />
                            <span>{copySuccess ? 'Copied!' : 'Copy'}</span>
                        </button>
                        <button
                            onClick={onClear}
                            className="flex items-center space-x-1 px-2 py-0.5 bg-tag-red-bg hover:bg-tag-red-bg/80 text-xs text-tag-red-text font-semibold rounded-md transition"
                        >
                            <TrashIcon className="h-3 w-3" />
                            <span>Clear</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DebugLog;