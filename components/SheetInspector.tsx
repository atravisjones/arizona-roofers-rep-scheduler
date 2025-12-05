import React, { useState } from 'react';
import { fetchSheetCell } from '../services/googleSheetsService';
import { LoadingIcon } from './icons';

interface SheetInspectorProps {
    activeSheetName: string;
}

const SheetInspector: React.FC<SheetInspectorProps> = ({ activeSheetName }) => {
    const [cellRef, setCellRef] = useState<string>('B5');
    const [result, setResult] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const handleFetch = async () => {
        if (!cellRef) {
            setError('Cell reference cannot be empty.');
            return;
        }
        if (!activeSheetName) {
            setError('No sheet is active.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setResult(null);

        try {
            const value = await fetchSheetCell(cellRef, activeSheetName);
            setResult(value);
        } catch (err) {
            setError('Failed to fetch cell data. Check console.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-primary p-2 border border-border-secondary rounded-md shadow-sm flex items-center space-x-2">
            <label htmlFor="cell-ref" className="text-sm font-medium text-text-secondary whitespace-nowrap">
                Inspect Cell:
            </label>
            <input
                type="text"
                id="cell-ref"
                value={cellRef}
                onChange={(e) => setCellRef(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
                className="w-20 px-2 py-1 border border-primary bg-secondary rounded-md shadow-sm focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm text-primary hover:bg-tertiary"
                placeholder="e.g., B5"
            />
            <button
                onClick={handleFetch}
                disabled={isLoading}
                className="bg-brand-primary text-brand-text-on-primary px-3 py-1 rounded-md hover:bg-brand-secondary disabled:bg-quaternary text-sm transition"
            >
                {isLoading ? <LoadingIcon className="h-4 w-4" /> : 'Fetch'}
            </button>
            {result && (
                <p className="text-sm text-primary bg-secondary px-2 py-1 rounded">
                   <span className="font-semibold">{cellRef.toUpperCase()}:</span> {result}
                </p>
            )}
            {error && (
                <p className="text-sm text-tag-red-text">{error}</p>
            )}
        </div>
    );
};

export default SheetInspector;