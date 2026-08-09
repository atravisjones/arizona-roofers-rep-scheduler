import React from 'react';
import type { BackupListItem } from '../types';
import { LoadingIcon } from './icons';

interface StartupModalProps {
    isOpen: boolean;
    backupInfo: BackupListItem | null;
    isLoading: boolean; // true while the "Load most recent" restore is running
    onStartFresh: () => void;
    onLoadMostRecent: () => void;
}

const formatSavedWhen = (iso: string): string => {
    const saved = new Date(iso);
    const diffMs = new Date().getTime() - saved.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hr ago`;
    return saved.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const StartupModal: React.FC<StartupModalProps> = ({ isOpen, backupInfo, isLoading, onStartFresh, onLoadMostRecent }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
            <div className="popup-surface w-full max-w-md flex flex-col animate-fade-in shadow-2xl rounded-xl overflow-hidden ring-1 ring-border-primary">
                <header className="px-6 py-4 border-b border-border-primary bg-bg-secondary/50">
                    <h2 className="text-[15px] font-semibold text-text-primary">Welcome back</h2>
                </header>

                <div className="p-6">
                    <p className="text-sm text-text-secondary leading-relaxed">
                        Load your most recent saved schedule, or start fresh from the availability sheet?
                    </p>
                    {backupInfo && (
                        <div className="mt-3 text-xs text-text-tertiary bg-bg-tertiary/50 rounded-lg px-3 py-2 border border-border-secondary/50">
                            Most recent save: <span className="font-semibold text-text-secondary">{formatSavedWhen(backupInfo.createdAt)}</span>
                            {typeof backupInfo.jobCount === 'number' && <> · {backupInfo.jobCount} job{backupInfo.jobCount === 1 ? '' : 's'}</>}
                            {backupInfo.dateKey && <> · {backupInfo.dateKey}</>}
                        </div>
                    )}
                </div>

                <footer className="px-6 py-4 bg-bg-secondary/30 border-t border-border-primary flex justify-end gap-3 rounded-b-xl">
                    <button
                        onClick={onStartFresh}
                        disabled={isLoading}
                        className="px-4 py-2 text-sm font-semibold text-text-secondary bg-bg-primary border border-border-secondary hover:bg-bg-tertiary hover:text-text-primary rounded-md transition-colors duration-150 disabled:opacity-40"
                    >
                        Start Fresh
                    </button>
                    <button
                        onClick={onLoadMostRecent}
                        disabled={isLoading}
                        className="px-5 py-2 text-sm font-semibold text-brand-text-on-primary bg-brand-primary hover:bg-brand-secondary rounded-md shadow-sm transition-colors duration-150 active:scale-95 disabled:opacity-60 flex items-center gap-2"
                    >
                        {isLoading && <LoadingIcon className="h-4 w-4" />}
                        {isLoading ? 'Loading…' : 'Load Most Recent'}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default StartupModal;
