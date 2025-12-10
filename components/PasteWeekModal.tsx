import React, { useState } from 'react';
import { LoadingIcon, PasteIcon, ProcessIcon, XIcon, CheckCircleIcon, AlertCircleIcon } from './icons';
import { parseWeekSchedule, isWeekSchedule, getWeekSummary, DaySchedule } from '../services/weekScheduleParser';

interface PasteWeekModalProps {
    isOpen: boolean;
    onClose: () => void;
    onParseDays: (days: DaySchedule[], onComplete: () => void) => Promise<void>;
    isParsing: boolean;
}

const PasteWeekModal: React.FC<PasteWeekModalProps> = ({ isOpen, onClose, onParseDays, isParsing }) => {
    const [pastedText, setPastedText] = useState('');
    const [parsedDays, setParsedDays] = useState<DaySchedule[]>([]);
    const [showPreview, setShowPreview] = useState(false);

    const handlePreview = () => {
        const days = parseWeekSchedule(pastedText);
        setParsedDays(days);
        setShowPreview(true);
    };

    const handleProcess = () => {
        if (parsedDays.length > 0) {
            onParseDays(parsedDays, () => {
                setPastedText('');
                setParsedDays([]);
                setShowPreview(false);
                onClose();
            });
        }
    };

    const handleBack = () => {
        setShowPreview(false);
        setParsedDays([]);
    };

    const handleClose = () => {
        setPastedText('');
        setParsedDays([]);
        setShowPreview(false);
        onClose();
    };

    if (!isOpen) return null;

    const isValidWeekSchedule = pastedText.trim() && isWeekSchedule(pastedText);

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={handleClose}>
            <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] animate-fade-in" onClick={e => e.stopPropagation()}>
                <header className="px-6 py-4 border-b border-border-primary flex justify-between items-center bg-bg-secondary rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-bg-primary rounded-lg shadow-sm border border-border-primary text-brand-primary">
                            <PasteIcon className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-text-primary">
                                {showPreview ? 'Preview Week Schedule' : 'Paste Week Schedule'}
                            </h2>
                            <p className="text-xs text-text-tertiary">
                                {showPreview
                                    ? `${parsedDays.length} days parsed - ${getWeekSummary(parsedDays)}`
                                    : 'Import a full week schedule and split it by day'}
                            </p>
                        </div>
                    </div>
                    <button onClick={handleClose} className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-bg-tertiary transition">
                        <XIcon className="h-6 w-6" />
                    </button>
                </header>

                {!showPreview ? (
                    <>
                        <div className="p-6 flex-1 overflow-y-auto">
                            <label className="block text-sm font-semibold text-text-secondary mb-2">Week Schedule Data</label>
                            <div className="relative">
                                <textarea
                                    rows={16}
                                    className="w-full p-4 bg-bg-primary border border-border-secondary rounded-lg shadow-sm focus:ring-2 focus:ring-brand-primary focus:border-brand-primary transition text-sm font-mono leading-relaxed resize-none"
                                    placeholder="Example:&#10;Sunday, Dec 7, 2025&#10;7:30am - 9am&#10;MESA, AZ 85204 -> Christian Noren&#10;1234 Main Street...&#10;&#10;Monday, Dec 8, 2025&#10;10am - 12pm&#10;PHOENIX, AZ 85001 -> John Smith&#10;5678 Oak Avenue..."
                                    value={pastedText}
                                    onChange={(e) => setPastedText(e.target.value)}
                                    autoFocus
                                />
                                <div className="absolute bottom-3 right-3 text-xs text-text-quaternary bg-bg-primary px-2 py-1 rounded border border-border-primary">
                                    {pastedText.length} chars
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mt-3">
                                {isValidWeekSchedule ? (
                                    <div className="flex items-center gap-1 text-xs text-green-600">
                                        <CheckCircleIcon className="h-4 w-4" />
                                        <span>Valid week schedule detected</span>
                                    </div>
                                ) : pastedText.trim() ? (
                                    <div className="flex items-center gap-1 text-xs text-yellow-600">
                                        <AlertCircleIcon className="h-4 w-4" />
                                        <span>Make sure to include day headers (e.g., "Sunday, Dec 7, 2025")</span>
                                    </div>
                                ) : (
                                    <p className="text-xs text-text-tertiary flex items-center gap-1">
                                        <span className="font-bold text-brand-primary">Tip:</span> Paste the entire week with day headers like "Sunday, Dec 7, 2025"
                                    </p>
                                )}
                            </div>
                        </div>
                        <footer className="px-6 py-4 bg-bg-secondary border-t border-border-primary flex justify-end space-x-3 rounded-b-xl">
                            <button onClick={handleClose} className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-primary border border-border-secondary rounded-lg hover:bg-bg-tertiary transition shadow-sm">
                                Cancel
                            </button>
                            <button
                                onClick={handlePreview}
                                disabled={!isValidWeekSchedule}
                                className="px-6 py-2 text-sm font-bold text-brand-text-on-primary bg-brand-primary rounded-lg hover:bg-brand-secondary disabled:bg-brand-primary/50 disabled:cursor-not-allowed flex items-center justify-center min-w-[140px] shadow-md hover:shadow-lg transition-all active:scale-95"
                            >
                                <ProcessIcon className="h-4 w-4" />
                                <span className="ml-2">Preview Days</span>
                            </button>
                        </footer>
                    </>
                ) : (
                    <>
                        <div className="p-6 flex-1 overflow-y-auto">
                            <div className="space-y-4">
                                {parsedDays.map((day, index) => (
                                    <div key={index} className="border border-border-secondary rounded-lg p-4 bg-bg-secondary">
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="font-bold text-text-primary flex items-center gap-2">
                                                <span className="bg-brand-primary text-brand-text-on-primary rounded-full w-6 h-6 flex items-center justify-center text-xs">
                                                    {index + 1}
                                                </span>
                                                {day.fullDate}
                                            </h3>
                                            <span className="text-xs text-text-tertiary">
                                                {day.content.length} chars
                                            </span>
                                        </div>
                                        <div className="bg-bg-primary rounded p-3 border border-border-primary">
                                            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
{day.content}
                                            </pre>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <footer className="px-6 py-4 bg-bg-secondary border-t border-border-primary flex justify-between rounded-b-xl">
                            <button
                                onClick={handleBack}
                                disabled={isParsing}
                                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-primary border border-border-secondary rounded-lg hover:bg-bg-tertiary transition shadow-sm disabled:opacity-50"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleProcess}
                                disabled={isParsing || parsedDays.length === 0}
                                className="px-6 py-2 text-sm font-bold text-brand-text-on-primary bg-brand-primary rounded-lg hover:bg-brand-secondary disabled:bg-brand-primary/50 disabled:cursor-not-allowed flex items-center justify-center min-w-[180px] shadow-md hover:shadow-lg transition-all active:scale-95"
                            >
                                {isParsing ? <LoadingIcon /> : <CheckCircleIcon className="h-4 w-4" />}
                                <span className="ml-2">{isParsing ? 'Processing...' : `Process ${parsedDays.length} Days`}</span>
                            </button>
                        </footer>
                    </>
                )}
            </div>
        </div>
    );
};

export default PasteWeekModal;
