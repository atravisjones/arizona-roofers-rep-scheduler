

import React, { useState } from 'react';
import { LoadingIcon, PasteIcon, ProcessIcon, XIcon } from './icons';

interface PasteJobsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onParse: (text: string, onComplete: () => void) => Promise<void>;
    isParsing: boolean;
}

const PasteJobsModal: React.FC<PasteJobsModalProps> = ({ isOpen, onClose, onParse, isParsing }) => {
    const [pastedText, setPastedText] = useState('');

    const handleParse = () => {
        onParse(pastedText, () => {
            setPastedText('');
            onClose();
        });
    };
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-2xl flex flex-col animate-fade-in" onClick={e => e.stopPropagation()}>
                <header className="px-6 py-4 border-b border-border-primary flex justify-between items-center bg-bg-secondary rounded-t-xl">
                    <div className="flex items-center gap-3">
                         <div className="p-2 bg-bg-primary rounded-lg shadow-sm border border-border-primary text-brand-primary">
                            <PasteIcon className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-text-primary">Paste Job Information</h2>
                            <p className="text-xs text-text-tertiary">Import jobs from spreadsheet, email, or text</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-bg-tertiary transition">
                        <XIcon className="h-6 w-6" />
                    </button>
                </header>
                <div className="p-6">
                    <label className="block text-sm font-semibold text-text-secondary mb-2">Job Data</label>
                    <div className="relative">
                        <textarea
                            rows={12}
                            className="w-full p-4 bg-bg-primary border border-border-secondary rounded-lg shadow-sm focus:ring-2 focus:ring-brand-primary focus:border-brand-primary transition text-sm font-mono leading-relaxed resize-none"
                            placeholder="Example:&#10;Monday, Nov 20, 2023&#10;7:30am - 10am&#10;MESA, AZ 85204 (Tile 2700sqft) -> Christian Noren&#10;13858 West Tara Lane..."
                            value={pastedText}
                            onChange={(e) => setPastedText(e.target.value)}
                            autoFocus
                        />
                        <div className="absolute bottom-3 right-3 text-xs text-text-quaternary bg-bg-primary px-2 py-1 rounded border border-border-primary">
                            {pastedText.length} chars
                        </div>
                    </div>
                    <p className="text-xs text-text-tertiary mt-2 flex items-center gap-1">
                        <span className="font-bold text-brand-primary">Tip:</span> Include the date, time ranges, and city names for best results.
                    </p>
                </div>
                <footer className="px-6 py-4 bg-bg-secondary border-t border-border-primary flex justify-end space-x-3 rounded-b-xl">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-primary border border-border-secondary rounded-lg hover:bg-bg-tertiary transition shadow-sm">
                        Cancel
                    </button>
                    <button
                        onClick={handleParse}
                        disabled={isParsing || !pastedText.trim()}
                        className="px-6 py-2 text-sm font-bold text-brand-text-on-primary bg-brand-primary rounded-lg hover:bg-brand-secondary disabled:bg-brand-primary/50 disabled:cursor-not-allowed flex items-center justify-center min-w-[140px] shadow-md hover:shadow-lg transition-all active:scale-95"
                    >
                        {isParsing ? <LoadingIcon /> : <ProcessIcon className="h-4 w-4" />}
                        <span className="ml-2">{isParsing ? 'Processing...' : 'Process Jobs'}</span>
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default PasteJobsModal;