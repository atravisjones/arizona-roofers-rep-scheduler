

import React, { useState, useEffect } from 'react';
import { Rep, ScoringWeights } from '../types';
import { useAppContext } from '../context/AppContext';
import { XIcon, SaveIcon, TrophyIcon } from './icons';

interface RepSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    repId: string | null;
}

const RepSettingsModal: React.FC<RepSettingsModalProps> = ({ isOpen, onClose, repId }) => {
    const { appState, handleUpdateRep, settings } = useAppContext();
    const [overrides, setOverrides] = useState<Partial<ScoringWeights>>({});
    
    const rep = appState.reps.find(r => r.id === repId);

    useEffect(() => {
        if (rep) {
            setOverrides(rep.scoringOverrides || {});
        }
    }, [rep, isOpen]);

    if (!isOpen || !rep) return null;

    const handleSave = () => {
        if (repId) {
            handleUpdateRep(repId, {
                scoringOverrides: overrides
            });
        }
        onClose();
    };

    const handleOverrideChange = (key: keyof ScoringWeights, value: string) => {
        const numVal = parseFloat(value);
        if (isNaN(numVal)) return;
        
        setOverrides(prev => ({
            ...prev,
            [key]: numVal
        }));
    };

    const clearOverride = (key: keyof ScoringWeights) => {
        setOverrides(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-md flex flex-col animate-fade-in" onClick={e => e.stopPropagation()}>
                <header className="px-5 py-3 border-b border-border-primary flex justify-between items-center bg-bg-secondary rounded-t-xl">
                    <h2 className="text-lg font-bold text-text-primary">Rep Settings: {rep.name}</h2>
                    <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary"><XIcon className="h-5 w-5" /></button>
                </header>
                
                <div className="p-6 space-y-6">
                    {/* Rank Display */}
                    <div className="bg-tag-amber-bg border border-tag-amber-border p-3 rounded-lg flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-tag-amber-bg border border-tag-amber-border rounded-full text-tag-amber-text">
                                <TrophyIcon className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-xs text-tag-amber-text font-semibold uppercase">Sales Ranking</p>
                                <p className="text-lg font-black text-text-primary">
                                    {rep.salesRank ? `#${rep.salesRank}` : 'Unranked'}
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] text-text-tertiary">Data Source:</p>
                            <p className="text-xs font-semibold text-text-secondary">Appointment Blocks</p>
                        </div>
                    </div>

                    {/* Priority Overrides */}
                    <div>
                        <h3 className="text-sm font-bold text-text-primary mb-3 border-b border-border-primary pb-1">Scoring Overrides</h3>
                        <p className="text-xs text-text-tertiary mb-3">Override global weighting for this specific rep to fine-tune auto-assignment.</p>
                        
                        <div className="space-y-4 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                            {[
                                { key: 'distanceBase', label: 'Dist: Home Base', global: settings.scoringWeights.distanceBase },
                                { key: 'distanceCluster', label: 'Dist: Job Cluster', global: settings.scoringWeights.distanceCluster },
                                { key: 'skillRoofing', label: 'Skill: Roofing', global: settings.scoringWeights.skillRoofing },
                                { key: 'skillType', label: 'Skill: Type', global: settings.scoringWeights.skillType },
                                { key: 'performance', label: 'Performance Override', global: settings.scoringWeights.performance },
                            ].map((item) => {
                                const key = item.key as keyof ScoringWeights;
                                const isOverridden = overrides[key] !== undefined;
                                const currentValue = isOverridden ? overrides[key] : item.global;

                                return (
                                    <div key={key}>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-xs font-semibold text-text-secondary">{item.label}</label>
                                            <div className="flex items-center gap-2">
                                                {isOverridden && (
                                                    <button onClick={() => clearOverride(key)} className="text-[10px] text-tag-red-text hover:underline">Reset</button>
                                                )}
                                                <span className={`text-xs font-mono px-1.5 rounded ${isOverridden ? 'bg-tag-amber-bg text-tag-amber-text font-bold' : 'bg-bg-tertiary text-text-tertiary'}`}>
                                                    {currentValue?.toFixed(1)}x
                                                </span>
                                            </div>
                                        </div>
                                        <input
                                            type="range"
                                            min="0" max="2" step="0.1"
                                            value={currentValue}
                                            onChange={e => handleOverrideChange(key, e.target.value)}
                                            className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer ${isOverridden ? 'accent-tag-amber-text bg-tag-amber-bg' : 'accent-text-quaternary bg-bg-quaternary'}`}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                <footer className="px-5 py-3 bg-bg-secondary border-t border-border-primary flex justify-end space-x-2 rounded-b-xl">
                    <button onClick={onClose} className="px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-tertiary rounded-md">Cancel</button>
                    <button onClick={handleSave} className="flex items-center px-4 py-1.5 text-sm font-bold text-brand-text-on-primary bg-brand-primary hover:bg-brand-secondary rounded-md shadow-sm">
                        <SaveIcon className="h-4 w-4 mr-1" /> Save
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default RepSettingsModal;