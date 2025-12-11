import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { Settings } from '../types';
import { XIcon } from './icons';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const SettingsSlider: React.FC<{
    label: string;
    value: number;
    onChange: (val: number) => void;
    description?: string;
}> = ({ label, value, onChange, description }) => (
    <div className="mb-5 last:mb-0">
        <div className="flex justify-between items-end mb-2">
            <label className="text-sm font-semibold text-text-secondary">{label}</label>
            <span className="text-xs font-bold text-brand-primary bg-brand-bg-light px-2 py-0.5 rounded-full">{value.toFixed(1)}x</span>
        </div>
        <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-quaternary rounded-lg appearance-none cursor-pointer accent-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2"
        />
        {description && <p className="text-[11px] text-text-tertiary mt-1.5 leading-tight">{description}</p>}
    </div>
);

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const { settings, updateSettings, log } = useAppContext();
    const [localSettings, setLocalSettings] = useState<Settings>(settings);

    useEffect(() => {
        setLocalSettings(settings);
    }, [settings, isOpen]);

    const handleSave = () => {
        updateSettings(localSettings);
        log('SETTINGS: Updated assignment settings.');
        onClose();
    };

    const handleChange = (key: keyof Settings, value: any) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleScoringChange = (key: keyof Settings['scoringWeights'], value: number) => {
        setLocalSettings(prev => ({
            ...prev,
            scoringWeights: { ...prev.scoringWeights, [key]: value }
        }));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="popup-surface w-full max-w-2xl flex flex-col max-h-[90vh] animate-fade-in" onClick={e => e.stopPropagation()}>
                <header className="px-6 py-4 border-b border-border-primary flex justify-between items-center flex-shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-text-primary">Assignment Settings</h2>
                        <p className="text-xs text-text-tertiary mt-0.5">Configure rules for automated dispatching</p>
                    </div>
                    <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-tertiary transition">
                        <XIcon className="h-6 w-6" />
                    </button>
                </header>

                <div className="p-6 space-y-8 overflow-y-auto custom-scrollbar">
                    {/* General Rules Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="h-6 w-1 bg-brand-primary rounded-full"></div>
                            <h3 className="text-lg font-bold text-text-primary">General Constraints</h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                            <div className="bg-secondary p-4 rounded-lg border border-border-primary hover:border-brand-primary/20 transition-colors">
                                <label htmlFor="maxJobsPerRep" className="block text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2">Max Jobs / Rep</label>
                                <div className="flex items-center">
                                    <input
                                        type="number" id="maxJobsPerRep"
                                        value={localSettings.maxJobsPerRep}
                                        onChange={e => handleChange('maxJobsPerRep', parseInt(e.target.value, 10))}
                                        className="w-full p-2 bg-secondary border border-primary rounded-md text-sm font-semibold text-primary shadow-sm focus:ring-2 focus:ring-brand-primary focus:outline-none hover:bg-tertiary"
                                    />
                                </div>
                            </div>
                            <div className="bg-secondary p-4 rounded-lg border border-border-primary hover:border-brand-primary/20 transition-colors">
                                <label htmlFor="minJobsPerRep" className="block text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2">Min Target / Rep</label>
                                <div className="flex items-center">
                                    <input
                                        type="number" id="minJobsPerRep"
                                        value={localSettings.minJobsPerRep}
                                        onChange={e => handleChange('minJobsPerRep', parseInt(e.target.value, 10))}
                                        className="w-full p-2 bg-secondary border border-primary rounded-md text-sm font-semibold text-primary shadow-sm focus:ring-2 focus:ring-brand-primary focus:outline-none hover:bg-tertiary"
                                    />
                                </div>
                            </div>
                            <div className="bg-secondary p-4 rounded-lg border border-border-primary hover:border-brand-primary/20 transition-colors sm:col-span-2">
                                <label htmlFor="maxCitiesPerRep" className="block text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2">Max Cities / Rep</label>
                                <div className="flex items-center">
                                    <input
                                        type="number" id="maxCitiesPerRep"
                                        value={localSettings.maxCitiesPerRep}
                                        onChange={e => handleChange('maxCitiesPerRep', parseInt(e.target.value, 10))}
                                        className="w-full p-2 bg-secondary border border-primary rounded-md text-sm font-semibold text-primary shadow-sm focus:ring-2 focus:ring-brand-primary focus:outline-none hover:bg-tertiary"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="bg-primary border border-border-primary rounded-lg divide-y divide-border-primary">
                            <div className="p-4 flex items-center justify-between">
                                <div>
                                    <label htmlFor="allowDoubleBooking" className="block text-sm font-semibold text-text-primary">Allow Double Booking</label>
                                    <p className="text-xs text-text-tertiary mt-0.5">Enable scheduling multiple jobs in the same time slot.</p>
                                </div>
                                <div className="flex items-center">
                                    <input
                                        type="checkbox" id="allowDoubleBooking"
                                        checked={localSettings.allowDoubleBooking}
                                        onChange={e => handleChange('allowDoubleBooking', e.target.checked)}
                                        className="h-5 w-5 rounded border-border-secondary text-brand-primary focus:ring-brand-primary transition cursor-pointer"
                                    />
                                </div>
                            </div>
                            {localSettings.allowDoubleBooking && (
                                <div className="p-4 bg-brand-bg-light/50 flex items-center justify-between">
                                    <label htmlFor="maxJobsPerSlot" className="text-sm font-medium text-brand-text-light">Max jobs per time slot</label>
                                    <input
                                        type="number" id="maxJobsPerSlot"
                                        value={localSettings.maxJobsPerSlot}
                                        onChange={e => handleChange('maxJobsPerSlot', parseInt(e.target.value, 10))}
                                        className="w-20 p-1.5 border border-border-secondary bg-secondary text-primary rounded-md text-sm text-center shadow-sm focus:ring-2 focus:ring-brand-primary focus:outline-none hover:bg-tertiary"
                                    />
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Auto-Assignment Logic Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="h-6 w-1 bg-purple-500 rounded-full"></div>
                            <h3 className="text-lg font-bold text-text-primary">AI & Auto-Assignment Logic</h3>
                        </div>

                        <div className="bg-primary border border-border-primary rounded-lg divide-y divide-border-primary mb-6">
                            <div className="p-4 flex items-center justify-between">
                                <div>
                                    <label htmlFor="allowAssignOutsideAvailability" className="block text-sm font-semibold text-text-primary">Override Rep Availability</label>
                                    <p className="text-xs text-text-tertiary mt-0.5">Allow jobs in unavailable slots for reps with partial availability (not fully off).</p>
                                </div>
                                <input
                                    type="checkbox" id="allowAssignOutsideAvailability"
                                    checked={localSettings.allowAssignOutsideAvailability}
                                    onChange={e => handleChange('allowAssignOutsideAvailability', e.target.checked)}
                                    className="h-5 w-5 rounded border-border-secondary text-brand-primary focus:ring-brand-primary transition cursor-pointer"
                                />
                            </div>

                            <div className="p-4 flex items-center justify-between">
                                <div>
                                    <label htmlFor="strictTimeSlotMatching" className="block text-sm font-semibold text-text-primary">Strict Time Slot Matching</label>
                                    <p className="text-xs text-text-tertiary mt-0.5">Only assign jobs to the exact time slot from the source.</p>
                                </div>
                                <input
                                    type="checkbox" id="strictTimeSlotMatching"
                                    checked={localSettings.strictTimeSlotMatching}
                                    onChange={e => handleChange('strictTimeSlotMatching', e.target.checked)}
                                    className="h-5 w-5 rounded border-border-secondary text-brand-primary focus:ring-brand-primary transition cursor-pointer"
                                />
                            </div>

                            <div className="p-4 flex items-center justify-between">
                                <div>
                                    <label htmlFor="allowRegionalRepsInPhoenix" className="block text-sm font-semibold text-text-primary">Allow Regional Reps in Phoenix</label>
                                    <p className="text-xs text-text-tertiary mt-0.5">Permit North (London) and South (Richard/Joseph) reps to be assigned Phoenix jobs.</p>
                                </div>
                                <input
                                    type="checkbox" id="allowRegionalRepsInPhoenix"
                                    checked={localSettings.allowRegionalRepsInPhoenix}
                                    onChange={e => handleChange('allowRegionalRepsInPhoenix', e.target.checked)}
                                    className="h-5 w-5 rounded border-border-secondary text-brand-primary focus:ring-brand-primary transition cursor-pointer"
                                />
                            </div>
                        </div>

                        {/* Gamification Settings */}
                        <div className="bg-tag-amber-bg p-5 rounded-lg border border-tag-amber-border shadow-sm">
                            <h4 className="text-xs font-bold text-tag-amber-text uppercase tracking-wider mb-4 border-b border-tag-amber-border pb-2 flex items-center gap-2">
                                <span>🏆</span> Gamification / Scoring Rules
                            </h4>
                            <p className="text-xs text-tag-amber-text/80 mb-4">
                                Define how the "Assignment Score" is calculated. The Auto-Assign algorithm will always choose the highest scoring rep.
                            </p>
                            <div className="space-y-2">
                                <SettingsSlider
                                    label="Distance: Home Base"
                                    value={localSettings.scoringWeights.distanceBase}
                                    onChange={(val) => handleScoringChange('distanceBase', val)}
                                    description="Proximity to Rep's Home Zip (when schedule is empty)."
                                />
                                <SettingsSlider
                                    label="Distance: Job Cluster"
                                    value={localSettings.scoringWeights.distanceCluster}
                                    onChange={(val) => handleScoringChange('distanceCluster', val)}
                                    description="Proximity to other assigned jobs (clustering)."
                                />
                                <SettingsSlider
                                    label="Skill: Roofing"
                                    value={localSettings.scoringWeights.skillRoofing}
                                    onChange={(val) => handleScoringChange('skillRoofing', val)}
                                    description="Skills for Tile, Shingle, Flat, Metal."
                                />
                                <SettingsSlider
                                    label="Skill: Type"
                                    value={localSettings.scoringWeights.skillType}
                                    onChange={(val) => handleScoringChange('skillType', val)}
                                    description="Skills for Insurance vs Commercial jobs."
                                />
                                <SettingsSlider
                                    label="Sales Performance / Rank"
                                    value={localSettings.scoringWeights.performance}
                                    onChange={(val) => handleScoringChange('performance', val)}
                                    description="Prioritize reps with higher sales rankings (e.g. Top 10)."
                                />
                                <div className="border-t border-tag-amber-border my-4"></div>
                                <SettingsSlider
                                    label="Unavailability Penalty"
                                    value={localSettings.unavailabilityPenalty}
                                    onChange={(val) => handleChange('unavailabilityPenalty', val)}
                                    description="Score reduction for assigning to an unavailable slot (if override is enabled)."
                                />
                            </div>
                        </div>
                    </section>

                    {/* Scheduling Tools Links Section */}
                    <section>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="h-6 w-1 bg-teal-500 rounded-full"></div>
                            <h3 className="text-lg font-bold text-text-primary">Scheduling Tools</h3>
                        </div>
                        <div className="bg-primary border border-border-primary rounded-lg p-4">
                            <p className="text-xs text-text-tertiary mb-3">Quick access to external scheduling resources and data sources.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <a
                                    href="https://docs.google.com/spreadsheets/d/1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g/edit?gid=1834112592#gid=1834112592"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 p-3 bg-secondary hover:bg-tertiary rounded-lg border border-border-primary hover:border-brand-primary/30 transition-all group"
                                >
                                    <span className="text-lg">📅</span>
                                    <span className="text-sm font-medium text-text-secondary group-hover:text-brand-primary transition-colors">Rep Availability</span>
                                </a>
                                <a
                                    href="https://docs.google.com/spreadsheets/d/1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g/edit?gid=28876067#gid=28876067"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 p-3 bg-secondary hover:bg-tertiary rounded-lg border border-border-primary hover:border-brand-primary/30 transition-all group"
                                >
                                    <span className="text-lg">🔧</span>
                                    <span className="text-sm font-medium text-text-secondary group-hover:text-brand-primary transition-colors">Rep Skillsets</span>
                                </a>
                                <a
                                    href="https://docs.google.com/spreadsheets/d/1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk/edit?gid=0#gid=0"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 p-3 bg-secondary hover:bg-tertiary rounded-lg border border-border-primary hover:border-brand-primary/30 transition-all group"
                                >
                                    <span className="text-lg">☁️</span>
                                    <span className="text-sm font-medium text-text-secondary group-hover:text-brand-primary transition-colors">Rep Cloud Storage</span>
                                </a>
                                <a
                                    href="https://docs.google.com/spreadsheets/d/1dwmWmMtXer4yOlY1QacqepCyQSe_5D84rzrLXYO2vTE/edit?gid=712107442#gid=712107442"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 p-3 bg-secondary hover:bg-tertiary rounded-lg border border-border-primary hover:border-brand-primary/30 transition-all group"
                                >
                                    <span className="text-lg">📊</span>
                                    <span className="text-sm font-medium text-text-secondary group-hover:text-brand-primary transition-colors">Sales Tracker</span>
                                </a>
                                <a
                                    href="https://docs.google.com/spreadsheets/d/1KadSyM67SOB6agq2YDHkZLYMXnn81Fna5jTWDBQQuog/edit?gid=2137549421#gid=2137549421"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 p-3 bg-secondary hover:bg-tertiary rounded-lg border border-border-primary hover:border-brand-primary/30 transition-all group sm:col-span-2"
                                >
                                    <span className="text-lg">🏠</span>
                                    <span className="text-sm font-medium text-text-secondary group-hover:text-brand-primary transition-colors">Roofr Export</span>
                                </a>
                            </div>
                        </div>
                    </section>
                </div>

                <footer className="px-6 py-4 bg-bg-secondary border-t border-border-primary flex justify-between items-center flex-shrink-0 rounded-b-xl">
                    <button onClick={onClose} className="text-sm font-medium text-text-tertiary hover:text-primary transition">
                        Cancel
                    </button>
                    <button onClick={handleSave} className="px-6 py-2.5 text-sm font-bold text-brand-text-on-primary bg-brand-primary rounded-lg hover:bg-brand-secondary shadow-md hover:shadow-lg transition-all active:scale-95">
                        Save Configuration
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default SettingsModal;