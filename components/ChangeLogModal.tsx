import React, { useState } from 'react';
import { JobChange } from '../types';
import { XIcon, ClipboardIcon } from './icons';

interface ChangeLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  changes: JobChange[];
}

const ChangeLogModal: React.FC<ChangeLogModalProps> = ({ isOpen, onClose, changes }) => {
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');

  if (!isOpen) return null;

  // Get unique dates from changes
  const uniqueDates = Array.from(new Set(changes.map(c => c.dateKey))).sort();

  // Filter changes
  const filteredChanges = changes.filter(change => {
    if (selectedDateFilter !== 'all' && change.dateKey !== selectedDateFilter) return false;
    if (selectedTypeFilter !== 'all' && change.type !== selectedTypeFilter) return false;
    return true;
  });

  // Group by type
  const changesByType = {
    added: filteredChanges.filter(c => c.type === 'added'),
    removed: filteredChanges.filter(c => c.type === 'removed'),
    updated: filteredChanges.filter(c => c.type === 'updated'),
    moved: filteredChanges.filter(c => c.type === 'moved')
  };

  const getChangeIcon = (type: string) => {
    switch (type) {
      case 'added':
        return <span className="text-tag-green-text font-bold">+</span>;
      case 'removed':
        return <span className="text-tag-red-text font-bold">-</span>;
      case 'updated':
        return <span className="text-tag-blue-text font-bold">✎</span>;
      case 'moved':
        return <span className="text-tag-orange-text font-bold">→</span>;
      default:
        return null;
    }
  };

  const getChangeBadgeClass = (type: string) => {
    switch (type) {
      case 'added':
        return 'bg-tag-green-bg text-tag-green-text';
      case 'removed':
        return 'bg-tag-red-bg text-tag-red-text';
      case 'updated':
        return 'bg-tag-blue-bg text-tag-blue-text';
      case 'moved':
        return 'bg-tag-orange-bg text-tag-orange-text';
      default:
        return 'bg-bg-tertiary text-text-secondary';
    }
  };

  const formatDate = (dateKey: string) => {
    const date = new Date(dateKey + 'T12:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const copyToClipboard = () => {
    const text = filteredChanges.map(change => {
      const date = formatDate(change.dateKey);
      const time = formatTime(change.timestamp);
      return `[${date} ${time}] ${change.type.toUpperCase()}: ${change.after?.address || change.before?.address || 'Unknown'} - ${change.details}`;
    }).join('\n');

    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="popup-surface w-full max-w-5xl h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-border-secondary pb-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-text-primary">Change Log</h2>
            <p className="text-sm text-text-tertiary mt-1">
              {filteredChanges.length} {filteredChanges.length === 1 ? 'change' : 'changes'} recorded
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
              className="px-3 py-2 text-sm font-semibold bg-bg-tertiary text-text-secondary rounded-md hover:bg-bg-quaternary transition flex items-center gap-2"
              title="Copy to clipboard"
            >
              <ClipboardIcon className="h-4 w-4" />
              Copy
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-bg-tertiary text-text-secondary transition"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-4">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-text-secondary mb-1">Filter by Date</label>
            <select
              value={selectedDateFilter}
              onChange={(e) => setSelectedDateFilter(e.target.value)}
              className="w-full px-3 py-2 bg-bg-tertiary text-text-primary rounded-md border border-border-secondary focus:outline-none focus:ring-2 focus:ring-brand-primary"
            >
              <option value="all">All Dates</option>
              {uniqueDates.map(date => (
                <option key={date} value={date}>{formatDate(date)}</option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-xs font-semibold text-text-secondary mb-1">Filter by Type</label>
            <select
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-bg-tertiary text-text-primary rounded-md border border-border-secondary focus:outline-none focus:ring-2 focus:ring-brand-primary"
            >
              <option value="all">All Types</option>
              <option value="added">Added ({changesByType.added.length})</option>
              <option value="removed">Removed ({changesByType.removed.length})</option>
              <option value="updated">Updated ({changesByType.updated.length})</option>
              <option value="moved">Moved ({changesByType.moved.length})</option>
            </select>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-tag-green-bg/20 border border-tag-green-bg rounded-lg p-3">
            <div className="text-2xl font-bold text-tag-green-text">{changesByType.added.length}</div>
            <div className="text-xs text-text-tertiary">Added</div>
          </div>
          <div className="bg-tag-red-bg/20 border border-tag-red-bg rounded-lg p-3">
            <div className="text-2xl font-bold text-tag-red-text">{changesByType.removed.length}</div>
            <div className="text-xs text-text-tertiary">Removed</div>
          </div>
          <div className="bg-tag-blue-bg/20 border border-tag-blue-bg rounded-lg p-3">
            <div className="text-2xl font-bold text-tag-blue-text">{changesByType.updated.length}</div>
            <div className="text-xs text-text-tertiary">Updated</div>
          </div>
          <div className="bg-tag-orange-bg/20 border border-tag-orange-bg rounded-lg p-3">
            <div className="text-2xl font-bold text-tag-orange-text">{changesByType.moved.length}</div>
            <div className="text-xs text-text-tertiary">Moved</div>
          </div>
        </div>

        {/* Changes List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {filteredChanges.length === 0 ? (
            <div className="text-center text-text-tertiary py-8">
              No changes to display
            </div>
          ) : (
            filteredChanges.map((change, index) => (
              <div
                key={`${change.jobId}-${index}`}
                className="bg-bg-tertiary border border-border-secondary rounded-lg p-3 hover:border-brand-primary/30 transition"
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="mt-1">
                    {getChangeIcon(change.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getChangeBadgeClass(change.type)}`}>
                          {change.type.toUpperCase()}
                        </span>
                        <span className="text-xs text-text-tertiary">
                          {formatDate(change.dateKey)} • {formatTime(change.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Job Details */}
                    <div className="space-y-1">
                      {change.after && (
                        <div className="text-sm">
                          <span className="font-semibold text-text-primary">
                            {change.after.address}
                          </span>
                          {change.after.city && (
                            <span className="text-text-secondary"> • {change.after.city}</span>
                          )}
                          {change.after.repName && (
                            <span className="text-text-secondary">
                              {' '}• Assigned to {change.after.repName} ({change.after.slotLabel})
                            </span>
                          )}
                        </div>
                      )}

                      {change.before && !change.after && (
                        <div className="text-sm">
                          <span className="font-semibold text-text-primary line-through">
                            {change.before.address}
                          </span>
                          {change.before.city && (
                            <span className="text-text-secondary line-through"> • {change.before.city}</span>
                          )}
                          {change.before.repName && (
                            <span className="text-text-secondary line-through">
                              {' '}• Was with {change.before.repName} ({change.before.slotLabel})
                            </span>
                          )}
                        </div>
                      )}

                      {change.details && (
                        <div className="text-xs text-text-tertiary italic">
                          {change.details}
                        </div>
                      )}

                      {/* Show before/after comparison for updates */}
                      {change.type === 'updated' && change.before && change.after && (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          {change.before.address !== change.after.address && (
                            <>
                              <div className="bg-tag-red-bg/20 p-2 rounded">
                                <span className="text-text-tertiary">Old: </span>
                                <span className="text-text-primary line-through">{change.before.address}</span>
                              </div>
                              <div className="bg-tag-green-bg/20 p-2 rounded">
                                <span className="text-text-tertiary">New: </span>
                                <span className="text-text-primary">{change.after.address}</span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ChangeLogModal;
