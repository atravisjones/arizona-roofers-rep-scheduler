import React, { useState, useEffect, useMemo } from 'react';
import { DisplayJob, Rep } from '../../types';
import { useAppContext } from '../../context/AppContext';
import { TAG_KEYWORDS, TIME_SLOTS } from '../../constants';
import { XIcon, SaveIcon, TrashIcon, MapPinIcon, ExternalLinkIcon, UserIcon } from '../icons';
import { normalizeAddressForMatching } from '../../services/googleSheetsService';

const TAG_CLASSES: Record<string, string> = {
  'Tile': 'bg-tag-orange-bg text-tag-orange-text border-tag-orange-border',
  'Shingle': 'bg-tag-amber-bg text-tag-amber-text border-tag-amber-border',
  'Flat': 'bg-tag-cyan-bg text-tag-cyan-text border-tag-cyan-border',
  'Metal': 'bg-tag-slate-bg text-tag-slate-text border-tag-slate-border',
  'Insurance': 'bg-tag-emerald-bg text-tag-emerald-text border-tag-emerald-border',
  'Commercial': 'bg-tag-purple-bg text-tag-purple-text border-tag-purple-border',
  'stories': 'bg-tag-teal-bg text-tag-teal-text border-tag-teal-border',
  'sqft': 'bg-tag-sky-bg text-tag-sky-text border-tag-sky-border',
  'yrs': 'bg-tag-stone-bg text-tag-stone-text border-tag-stone-border',
};

interface JobEditModalProps {
  job: DisplayJob | null;
  isOpen: boolean;
  onClose: () => void;
  currentRepId?: string;
}

const JobEditModal: React.FC<JobEditModalProps> = ({ job, isOpen, onClose, currentRepId }) => {
  const {
    appState,
    handleUpdateJob,
    handleRemoveJob,
    handleUnassignJob,
    handleJobDrop,
    roofrJobIdMap,
    requestConfirmation,
    selectedDate,
  } = useAppContext();

  // Get day name for availability checking
  const dayName = useMemo(() =>
    selectedDate.toLocaleDateString('en-US', { weekday: 'long' }),
    [selectedDate]
  );

  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string>('ts-1');

  // Initialize form when job changes
  useEffect(() => {
    if (job) {
      setCustomerName(job.customerName);
      setAddress(job.address);
      setNotes(job.notes);
      setSelectedRepId(currentRepId || null);
      // Find current slot from job's timeframe or default to first slot
      const currentSlot = TIME_SLOTS.find(slot =>
        job.originalTimeframe?.toLowerCase().includes(slot.label.toLowerCase().split(' - ')[0])
      );
      setSelectedSlotId(currentSlot?.id || 'ts-1');
    }
  }, [job, currentRepId]);

  // Parse tags from notes
  const allTags = useMemo(() => {
    if (!notes) return [];
    const notesLower = notes.toLowerCase();

    const ageMatch = notes.match(/\b(\d+)\s*yrs\b/i);
    const ageTag = ageMatch ? [{ type: 'yrs', value: `${ageMatch[1]} yrs`, classes: TAG_CLASSES['yrs'] }] : [];

    const roofTags = TAG_KEYWORDS.filter(keyword =>
      new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower)
    ).map(tag => ({ type: 'roof', value: tag, classes: TAG_CLASSES[tag] || 'bg-bg-tertiary text-secondary' }));

    const sqftMatch = notes.match(/\b([\d,]+)\s*sq\.?\b/i);
    const sqftTag = sqftMatch ? [{ type: 'sqft', value: `${sqftMatch[1]} sqft`, classes: TAG_CLASSES['sqft'] }] : [];

    const storiesMatch = notes.match(/\b(\d)S\b/i);
    const storiesTag = storiesMatch ? [{ type: 'stories', value: `${storiesMatch[1]} Story`, classes: TAG_CLASSES['stories'] }] : [];

    return [...roofTags, ...sqftTag, ...storiesTag, ...ageTag];
  }, [notes]);

  // Check if a rep is available on the selected day
  const isRepAvailable = (rep: Rep): boolean => {
    const unavailableSlots = rep.unavailableSlots?.[dayName] || [];
    // Rep is unavailable if all 4 slots are marked unavailable
    return unavailableSlots.length < 4;
  };

  // Get reps sorted: available first (by name), then unavailable (by name)
  const sortedReps = useMemo(() => {
    const available: Rep[] = [];
    const unavailable: Rep[] = [];

    appState.reps.forEach(rep => {
      if (isRepAvailable(rep)) {
        available.push(rep);
      } else {
        unavailable.push(rep);
      }
    });

    available.sort((a, b) => a.name.localeCompare(b.name));
    unavailable.sort((a, b) => a.name.localeCompare(b.name));

    return { available, unavailable };
  }, [appState.reps, dayName]);

  // Get Roofr URL
  const roofrUrl = useMemo(() => {
    if (!job?.address || !roofrJobIdMap || roofrJobIdMap.size === 0) return null;
    const normalizedAddress = normalizeAddressForMatching(job.address);
    if (normalizedAddress) {
      const jobId = roofrJobIdMap.get(normalizedAddress);
      if (jobId) {
        return `https://app.roofr.com/dashboard/team/239329/jobs/details/${jobId}`;
      }
    }
    return null;
  }, [job?.address, roofrJobIdMap]);

  // Google Maps URL
  const googleMapsUrl = useMemo(() => {
    if (!job) return '#';
    const addressParts = [job.address, job.city, job.zipCode].filter(Boolean);
    if (addressParts.length === 0) return '#';
    const query = encodeURIComponent(addressParts.join(', '));
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }, [job]);

  const handleSave = () => {
    if (!job) return;

    // Save job details
    handleUpdateJob(job.id, { customerName, address, notes });

    // Handle rep change if different
    if (selectedRepId && selectedRepId !== currentRepId) {
      handleJobDrop(job.id, { repId: selectedRepId, slotId: selectedSlotId }, undefined);
    }

    onClose();
  };

  const handleDelete = () => {
    if (!job) return;
    requestConfirmation({
      title: 'Delete Job',
      message: `Are you sure you want to permanently delete this job?\n\n${job.address}`,
      onConfirm: () => {
        handleRemoveJob(job.id);
        onClose();
      },
      confirmLabel: 'Delete',
      isDangerous: true,
    });
  };

  const handleUnassign = () => {
    if (!job) return;
    handleUnassignJob(job.id);
    onClose();
  };

  if (!isOpen || !job) return null;

  return (
    <div
      className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]"
      onClick={onClose}
    >
      <div
        className="popup-surface w-full max-w-lg flex flex-col animate-fade-in shadow-2xl rounded-xl overflow-hidden ring-1 ring-border-primary max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 py-3 border-b border-border-primary flex justify-between items-center bg-bg-secondary/50">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Edit Job</h2>
            <p className="text-xs text-text-tertiary">{job.city || 'Unknown City'}</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-tertiary transition"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </header>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Tags Display */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag, idx) => (
                <span
                  key={`${tag.type}-${idx}`}
                  className={`px-2 py-0.5 text-xs font-semibold rounded-full border ${tag.classes}`}
                >
                  {tag.value}
                </span>
              ))}
            </div>
          )}

          {/* Quick Links */}
          <div className="flex gap-2">
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary hover:bg-bg-quaternary border border-border-primary rounded-lg transition text-text-secondary hover:text-primary"
            >
              <MapPinIcon className="h-3.5 w-3.5" />
              Google Maps
            </a>
            {roofrUrl && (
              <a
                href={roofrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-bg-light hover:bg-brand-bg-dark border border-brand-primary/30 rounded-lg transition text-brand-primary"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" />
                Job Card
              </a>
            )}
          </div>

          {/* Original Info Section - if job was auto-assigned */}
          {(job.originalAddress || job.originalRepName) && (
            <div className="p-3 bg-bg-tertiary/50 rounded-lg border border-border-secondary space-y-2">
              <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Original (from paste)</div>

              {job.originalAddress && (
                <div>
                  <label className="text-[10px] font-medium text-text-quaternary block">Address</label>
                  <div className="text-sm text-text-secondary select-all">{job.originalAddress}</div>
                </div>
              )}

              {job.originalRepName && (
                <div>
                  <label className="text-[10px] font-medium text-text-quaternary block">Auto-Assigned Rep</label>
                  <div className="text-sm text-text-secondary flex items-center gap-1">
                    <UserIcon className="h-3 w-3 text-text-quaternary" />
                    {job.originalRepName}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Assignment Section */}
          <div className="p-3 bg-bg-secondary rounded-lg border border-border-primary space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <UserIcon className="h-4 w-4 text-brand-primary" />
              Current Assignment
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Rep Dropdown */}
              <div>
                <label className="text-xs font-medium text-text-tertiary block mb-1">Assigned Rep</label>
                <select
                  value={selectedRepId || ''}
                  onChange={e => setSelectedRepId(e.target.value || null)}
                  className="w-full p-2 text-sm border border-border-primary bg-bg-primary rounded-md focus:ring-2 focus:ring-brand-primary focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {sortedReps.available.length > 0 && (
                    <optgroup label="Available">
                      {sortedReps.available.map(rep => (
                        <option key={rep.id} value={rep.id}>
                          {rep.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {sortedReps.unavailable.length > 0 && (
                    <optgroup label="Unavailable Today" className="text-text-quaternary">
                      {sortedReps.unavailable.map(rep => (
                        <option key={rep.id} value={rep.id} className="text-text-quaternary opacity-60">
                          {rep.name} (unavailable)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Time Slot Dropdown */}
              <div>
                <label className="text-xs font-medium text-text-tertiary block mb-1">Time Slot</label>
                <select
                  value={selectedSlotId}
                  onChange={e => setSelectedSlotId(e.target.value)}
                  className="w-full p-2 text-sm border border-border-primary bg-bg-primary rounded-md focus:ring-2 focus:ring-brand-primary focus:outline-none"
                  disabled={!selectedRepId}
                >
                  {TIME_SLOTS.map(slot => (
                    <option key={slot.id} value={slot.id}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedRepId !== currentRepId && selectedRepId && (
              <p className="text-xs text-brand-primary italic">
                Will reassign to {[...sortedReps.available, ...sortedReps.unavailable].find(r => r.id === selectedRepId)?.name}
              </p>
            )}
          </div>

          {/* Job Details Form */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-text-tertiary block mb-1">City / Customer</label>
              <input
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="w-full p-2 border border-border-primary bg-bg-primary rounded-md text-sm focus:ring-2 focus:ring-brand-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-text-tertiary block mb-1">
                Map Address <span className="font-normal text-text-quaternary">(for geocoding)</span>
              </label>
              <textarea
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full p-2 border border-border-primary bg-bg-primary rounded-md text-sm focus:ring-2 focus:ring-brand-primary focus:outline-none resize-none"
                rows={2}
                placeholder="Edit to adjust map location"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-text-tertiary block mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full p-2 border border-border-primary bg-bg-primary rounded-md text-sm focus:ring-2 focus:ring-brand-primary focus:outline-none resize-none"
                rows={3}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="px-5 py-3 bg-bg-secondary/30 border-t border-border-primary flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-tag-red-text bg-bg-primary hover:bg-tag-red-bg border border-tag-red-border rounded-lg transition"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Delete
            </button>
            {currentRepId && (
              <button
                onClick={handleUnassign}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-text-secondary bg-bg-primary hover:bg-bg-tertiary border border-border-primary rounded-lg transition"
              >
                Unassign
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm font-medium text-text-secondary hover:text-primary hover:bg-bg-tertiary rounded-lg transition border border-transparent hover:border-border-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-5 py-1.5 text-sm font-bold text-white bg-brand-primary hover:bg-brand-secondary rounded-lg shadow-md transition active:scale-95"
            >
              <SaveIcon className="h-4 w-4" />
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default JobEditModal;
