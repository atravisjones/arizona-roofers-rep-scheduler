import React, { useState } from 'react';
import { XIcon, CloudDownloadIcon } from './icons';
import { BackupListItem } from '../types';

interface LoadOptionsModalProps {
    isOpen: boolean;
    isLoading: boolean;
    manualBackups: BackupListItem[];
    autoBackup: BackupListItem | null;
    onLoadBackup: (backupId: string) => void;
    onStartFresh: () => void;
    onClose: () => void;
}

const LoadOptionsModal: React.FC<LoadOptionsModalProps> = ({
    isOpen,
    isLoading,
    manualBackups,
    autoBackup,
    onLoadBackup,
    onStartFresh,
    onClose,
}) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    if (!isOpen) return null;

    // Find the most recent backup across both types
    const allBackups = [...manualBackups, ...(autoBackup ? [autoBackup] : [])];
    const mostRecentId = allBackups.length > 0
        ? allBackups.reduce((latest, b) =>
            new Date(b.createdAt) > new Date(latest.createdAt) ? b : latest
        ).id
        : null;

    const hasAnyBackups = manualBackups.length > 0 || autoBackup !== null;

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    const formatDateKey = (dateKey: string) => {
        const date = new Date(dateKey + 'T12:00:00');
        return date.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
    };

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={onClose}>
            <div className="popup-surface w-full max-w-lg flex flex-col animate-fade-in shadow-2xl rounded-xl overflow-hidden ring-1 ring-border-primary" onClick={e => e.stopPropagation()}>
                <header className="px-6 py-4 border-b border-border-primary flex justify-between items-center bg-bg-secondary/50">
                    <div className="flex items-center gap-3">
                        <CloudDownloadIcon className="h-5 w-5 text-brand-primary" />
                        <h2 className="text-lg font-bold text-text-primary">Load Schedule</h2>
                    </div>
                    <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-tertiary transition">
                        <XIcon className="h-5 w-5" />
                    </button>
                </header>

                <div className="p-6 max-h-[60vh] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin h-8 w-8 border-2 border-brand-primary border-t-transparent rounded-full"></div>
                            <span className="ml-3 text-text-secondary">Loading backups...</span>
                        </div>
                    ) : !hasAnyBackups ? (
                        <div className="text-center py-8">
                            <p className="text-text-secondary mb-2">No saved backups found.</p>
                            <p className="text-text-tertiary text-sm">Start fresh and your work will be auto-saved.</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Auto-Save Section */}
                            <section>
                                <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                    Auto-Save (Latest)
                                </h3>
                                {autoBackup ? (
                                    <button
                                        onClick={() => setSelectedId(autoBackup.id)}
                                        className={`w-full text-left p-4 rounded-lg border transition-all ${selectedId === autoBackup.id
                                            ? 'border-brand-primary bg-brand-primary/10 ring-2 ring-brand-primary/20'
                                            : 'border-border-secondary hover:border-border-primary hover:bg-bg-tertiary'
                                            }`}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-text-primary">
                                                        {formatDateKey(autoBackup.dateKey)}
                                                    </span>
                                                    {mostRecentId === autoBackup.id && (
                                                        <span className="px-2 py-0.5 text-xs font-medium bg-green-500/10 text-green-500 rounded-full">
                                                            Most Recent
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-text-tertiary mt-1">
                                                    Saved {formatDate(autoBackup.createdAt)}
                                                </p>
                                            </div>
                                            <div className="text-right text-sm text-text-tertiary">
                                                <div>{autoBackup.jobCount || 0} jobs</div>
                                                <div>{autoBackup.repCount || 0} reps</div>
                                            </div>
                                        </div>
                                    </button>
                                ) : (
                                    <p className="text-sm text-text-tertiary italic">No auto-save available</p>
                                )}
                            </section>

                            {/* Manual Saves Section */}
                            <section>
                                <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                    Manual Saves ({manualBackups.length} version{manualBackups.length !== 1 ? 's' : ''})
                                </h3>
                                {manualBackups.length > 0 ? (
                                    <div className="space-y-2">
                                        {manualBackups.map(backup => (
                                            <button
                                                key={backup.id}
                                                onClick={() => setSelectedId(backup.id)}
                                                className={`w-full text-left p-4 rounded-lg border transition-all ${selectedId === backup.id
                                                    ? 'border-brand-primary bg-brand-primary/10 ring-2 ring-brand-primary/20'
                                                    : 'border-border-secondary hover:border-border-primary hover:bg-bg-tertiary'
                                                    }`}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="px-2 py-0.5 text-xs font-bold bg-blue-500/10 text-blue-500 rounded">
                                                                v{backup.versionNumber}
                                                            </span>
                                                            <span className="font-medium text-text-primary">
                                                                {formatDateKey(backup.dateKey)}
                                                            </span>
                                                            {mostRecentId === backup.id && (
                                                                <span className="px-2 py-0.5 text-xs font-medium bg-green-500/10 text-green-500 rounded-full">
                                                                    Most Recent
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-sm text-text-tertiary mt-1">
                                                            Saved {formatDate(backup.createdAt)}
                                                        </p>
                                                    </div>
                                                    <div className="text-right text-sm text-text-tertiary">
                                                        <div>{backup.jobCount || 0} jobs</div>
                                                        <div>{backup.repCount || 0} reps</div>
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-text-tertiary italic">No manual saves available</p>
                                )}
                            </section>
                        </div>
                    )}
                </div>

                <footer className="px-6 py-4 bg-bg-secondary/30 border-t border-border-primary flex justify-between items-center rounded-b-xl">
                    <button
                        onClick={onStartFresh}
                        className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors border border-transparent hover:border-border-secondary"
                    >
                        Start Fresh
                    </button>
                    <button
                        onClick={() => selectedId && onLoadBackup(selectedId)}
                        disabled={!selectedId}
                        className={`px-6 py-2 text-sm font-bold text-white rounded-lg shadow-md transition-all active:scale-95 ${selectedId
                            ? 'bg-brand-primary hover:bg-brand-secondary shadow-brand-primary/20'
                            : 'bg-gray-400 cursor-not-allowed'
                            }`}
                    >
                        Load Selected
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default LoadOptionsModal;
