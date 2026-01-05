import React, { useState, useEffect, useMemo } from 'react';
import { Job, DisplayJob, Rep } from '../types';
import { TAG_KEYWORDS, TIME_SLOTS } from '../constants';
import { MapPinIcon, UserIcon, TrashIcon, SaveIcon, UnassignJobIcon, ExternalLinkIcon } from './icons';
import { useAppContext } from '../context/AppContext';

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
    job: Job | DisplayJob;
    isOpen: boolean;
    onClose: () => void;
    onSave: (jobId: string, updates: Partial<Pick<Job, 'customerName' | 'address' | 'notes' | 'originalTimeframe'>>) => void;
    onRemove?: (jobId: string) => void;
    onUnassign?: (jobId: string) => void;
    onAssign?: (jobId: string, repId: string, slotId: string) => void;
    currentRepId?: string;
    currentSlotId?: string;
}

export const JobEditModal: React.FC<JobEditModalProps> = ({
    job,
    isOpen,
    onClose,
    onSave,
    onRemove,
    onUnassign,
    onAssign,
    currentRepId,
    currentSlotId,
}) => {
    const { appState } = useAppContext();
    const reps = appState.reps;

    const [customerName, setCustomerName] = useState(job.customerName);
    const [address, setAddress] = useState(job.address);
    const [notes, setNotes] = useState(job.notes);
    const [selectedRepId, setSelectedRepId] = useState(currentRepId || '');
    const [selectedSlotId, setSelectedSlotId] = useState(currentSlotId || 'ts-2');

    useEffect(() => {
        setCustomerName(job.customerName);
        setAddress(job.address);
        setNotes(job.notes);
        setSelectedRepId(currentRepId || '');
        setSelectedSlotId(currentSlotId || 'ts-2');
    }, [job, currentRepId, currentSlotId]);

    const allTags = useMemo(() => {
        if (!job.notes) return [];
        const notesLower = job.notes.toLowerCase();

        const ageMatch = job.notes.match(/\b(\d+)\s*yrs\b/i);
        const ageTag = ageMatch ? [{ type: 'yrs', value: `${ageMatch[1]} yrs`, classes: TAG_CLASSES['yrs'] }] : [];

        const roofTags = TAG_KEYWORDS.filter(keyword => new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower))
            .map(tag => ({ type: 'roof', value: tag, classes: TAG_CLASSES[tag] }));

        const sqftMatch = job.notes.match(/\b([\d,]+)\s*sq\.?\b/i);
        const sqftTag = sqftMatch ? [{ type: 'sqft', value: `${sqftMatch[1]} sqft`, classes: TAG_CLASSES['sqft'] }] : [];

        const storiesMatch = job.notes.match(/\b(\d)S\b/i);
        const storiesTag = storiesMatch ? [{ type: 'stories', value: `${storiesMatch[1]} Story`, classes: TAG_CLASSES['stories'] }] : [];

        return [...roofTags, ...storiesTag, ...ageTag, ...sqftTag];
    }, [job.notes]);

    const googleMapsUrl = useMemo(() => {
        const addressParts = [job.address, job.city, job.zipCode].filter(Boolean);
        if (addressParts.length === 0) return '#';
        const query = encodeURIComponent(addressParts.join(', '));
        return `https://www.google.com/maps/search/?api=1&query=${query}`;
    }, [job.address, job.city, job.zipCode]);

    // Format address for Roofr search
    const formatAddressForRoofr = (addr: string): string => {
        const sourceAddr = job.originalAddress || addr;
        if (/^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(sourceAddr.trim())) {
            return sourceAddr;
        }
        const streetPart = sourceAddr.split(',')[0].trim();
        const directionMap: Record<string, string> = {
            ' N ': ' North ', ' S ': ' South ', ' E ': ' East ', ' W ': ' West ',
            ' NE ': ' Northeast ', ' NW ': ' Northwest ', ' SE ': ' Southeast ', ' SW ': ' Southwest ',
        };
        let formatted = ` ${streetPart} `;
        Object.entries(directionMap).forEach(([abbr, full]) => {
            formatted = formatted.replace(new RegExp(abbr, 'gi'), full);
        });
        const streetTypes: Record<string, string> = {
            ' St ': ' Street ', ' Ave ': ' Avenue ', ' Blvd ': ' Boulevard ',
            ' Dr ': ' Drive ', ' Rd ': ' Road ', ' Ln ': ' Lane ',
            ' Ct ': ' Court ', ' Pl ': ' Place ', ' Cir ': ' Circle ',
        };
        Object.entries(streetTypes).forEach(([abbr, full]) => {
            formatted = formatted.replace(new RegExp(abbr, 'gi'), full);
        });
        return formatted.trim();
    };

    const handleRoofrClick = async () => {
        const formattedAddress = formatAddressForRoofr(job.address);
        try {
            await navigator.clipboard.writeText(formattedAddress);
        } catch (err) {
            console.error('Failed to copy address:', err);
        }
        const encodedAddress = encodeURIComponent(formattedAddress);
        window.open(`https://app.roofr.com/dashboard/team/239329/jobs/list-view?page=1&filter%5Bq%5D=${encodedAddress}`, '_blank');
    };

    const handleSave = () => {
        onSave(job.id, { customerName, address, notes });
        // If rep/slot changed and we have onAssign, call it
        if (onAssign && selectedRepId && (selectedRepId !== currentRepId || selectedSlotId !== currentSlotId)) {
            onAssign(job.id, selectedRepId, selectedSlotId);
        }
        onClose();
    };

    const handleRemove = () => {
        if (window.confirm(`Are you sure you want to permanently remove this job?\n\n${job.originalAddress || job.address}`)) {
            onRemove?.(job.id);
            onClose();
        }
    };

    const handleUnassign = () => {
        onUnassign?.(job.id);
        onClose();
    };

    // Get original line from notes if it contains pasted data markers
    const originalLine = useMemo(() => {
        // The original line is essentially the originalAddress + city + notes combo
        if (job.originalAddress) {
            return `${job.originalAddress}${job.city ? `, ${job.city}` : ''}`;
        }
        return null;
    }, [job.originalAddress, job.city]);

    if (!isOpen) return null;

    const displayJob = job as DisplayJob;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-bg-primary rounded-lg shadow-xl w-full max-w-md border border-border-primary" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border-primary">
                    <div>
                        <h2 className="text-lg font-bold text-text-primary">Edit Job</h2>
                        <p className="text-sm text-text-tertiary">{job.city || job.customerName}</p>
                    </div>
                    <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary text-2xl leading-none">&times;</button>
                </div>

                <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    {/* Tags */}
                    {allTags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {allTags.map((tag, idx) => (
                                <span key={`${tag.value}-${idx}`} className={`text-xs font-bold px-2 py-1 rounded-full border ${tag.classes}`}>
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
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border-secondary rounded-md text-sm font-medium text-text-secondary hover:bg-bg-tertiary transition"
                        >
                            <MapPinIcon className="h-4 w-4" />
                            Google Maps
                        </a>
                        <button
                            onClick={handleRoofrClick}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border-secondary rounded-md text-sm font-medium text-text-secondary hover:bg-bg-tertiary transition"
                        >
                            <ExternalLinkIcon className="h-4 w-4" />
                            Roofr Job Card
                        </button>
                    </div>

                    {/* Original Info Section - only show if originalAddress exists */}
                    {(job.originalAddress || job.originalRepName) && (
                        <div className="p-3 bg-bg-tertiary/50 rounded-lg border border-border-secondary space-y-2">
                            <div className="text-xs font-semibold text-text-quaternary uppercase tracking-wide">Original (from paste)</div>
                            {job.originalAddress && (
                                <div>
                                    <label className="text-xs font-medium text-text-quaternary">Address</label>
                                    <div className="text-sm text-text-secondary select-all font-mono bg-bg-primary px-2 py-1 rounded border border-border-primary mt-0.5">
                                        {job.originalAddress}
                                    </div>
                                </div>
                            )}
                            {/* Only show auto-assigned rep if it was detected from pasted text */}
                            {job.originalRepName && (
                                <div>
                                    <label className="text-xs font-medium text-text-quaternary">Auto-Assigned Rep</label>
                                    <div className="text-sm text-text-secondary flex items-center gap-1.5 mt-0.5">
                                        <UserIcon className="h-3.5 w-3.5 text-brand-primary" />
                                        <span className="font-medium">{job.originalRepName}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Current Assignment Section */}
                    {(currentRepId || onAssign) && (
                        <div className="p-3 bg-bg-secondary rounded-lg border border-border-secondary space-y-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                                <UserIcon className="h-4 w-4 text-brand-primary" />
                                Current Assignment
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-text-tertiary block mb-1">Assigned Rep</label>
                                    <select
                                        value={selectedRepId}
                                        onChange={e => setSelectedRepId(e.target.value)}
                                        className="w-full p-2 border border-border-primary rounded-md text-sm bg-bg-primary text-text-primary focus:ring-2 focus:ring-brand-primary focus:outline-none"
                                    >
                                        <option value="">Unassigned</option>
                                        {reps.map(rep => (
                                            <option key={rep.id} value={rep.id}>{rep.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-text-tertiary block mb-1">Time Slot</label>
                                    <select
                                        value={selectedSlotId}
                                        onChange={e => setSelectedSlotId(e.target.value)}
                                        className="w-full p-2 border border-border-primary rounded-md text-sm bg-bg-primary text-text-primary focus:ring-2 focus:ring-brand-primary focus:outline-none"
                                    >
                                        {TIME_SLOTS.map(slot => (
                                            <option key={slot.id} value={slot.id}>{slot.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Editable Fields */}
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-bold text-text-tertiary block mb-1">City / Customer</label>
                            <input
                                value={customerName}
                                onChange={e => setCustomerName(e.target.value)}
                                className="w-full p-2 border border-border-primary rounded-md text-sm bg-bg-primary text-text-primary placeholder:text-text-quaternary focus:ring-2 focus:ring-brand-primary focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-text-tertiary block mb-1">
                                Map Address <span className="font-normal text-text-quaternary">(for geocoding)</span>
                            </label>
                            <input
                                value={address}
                                onChange={e => setAddress(e.target.value)}
                                className="w-full p-2 border border-border-primary rounded-md text-sm bg-bg-primary text-text-primary placeholder:text-text-quaternary focus:ring-2 focus:ring-brand-primary focus:outline-none"
                                placeholder="Edit to adjust map location or use GPS coordinates"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-text-tertiary block mb-1">Notes</label>
                            <textarea
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                rows={3}
                                className="w-full p-2 border border-border-primary rounded-md text-sm bg-bg-primary text-text-primary placeholder:text-text-quaternary focus:ring-2 focus:ring-brand-primary focus:outline-none resize-none"
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-4 border-t border-border-primary bg-bg-secondary rounded-b-lg">
                    <div className="flex items-center gap-2">
                        {onRemove && (
                            <button
                                onClick={handleRemove}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md text-tag-red-text bg-tag-red-bg hover:bg-tag-red-bg/80 border border-tag-red-border transition"
                            >
                                <TrashIcon className="h-4 w-4" />
                                Delete
                            </button>
                        )}
                        {onUnassign && currentRepId && (
                            <button
                                onClick={handleUnassign}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md text-text-secondary bg-bg-primary hover:bg-bg-tertiary border border-border-secondary transition"
                            >
                                <UnassignJobIcon className="h-4 w-4" />
                                Unassign
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-1.5 text-sm font-semibold rounded-md text-text-secondary bg-bg-primary hover:bg-bg-tertiary border border-border-secondary transition"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-bold rounded-md text-white bg-brand-primary hover:bg-brand-secondary transition"
                        >
                            <SaveIcon className="h-4 w-4" />
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default JobEditModal;
