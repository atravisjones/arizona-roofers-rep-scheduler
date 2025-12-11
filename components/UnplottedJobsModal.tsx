import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon, ClipboardIcon, VariationsIcon, LoadingIcon, MapPinIcon, RefreshIcon } from './icons';
import { JobCard } from './JobCard';
import LeafletMap from './LeafletMap';
import { DisplayJob } from '../types';
import { geocodeAddresses } from '../services/osmService';

interface UnplottedJobsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const UnplottedJobsModal: React.FC<UnplottedJobsModalProps> = ({ isOpen, onClose }) => {
    const {
        activeRoute,
        handleUpdateJob,
        handleUnassignJob,
        handleRemoveJob,
        handleTryAddressVariations,
        isTryingVariations,
        placementJobId,
        setPlacementJobId,
        handlePlaceJobOnMap,
        handleRefreshRoute,
    } = useAppContext();

    const [copySuccess, setCopySuccess] = useState(false);
    const [panelWidth, setPanelWidth] = useState(320);
    const [isResizing, setIsResizing] = useState(false);
    const [placedLocation, setPlacedLocation] = useState<{ jobId: string; lat: number; lon: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    if (!isOpen) return null;

    const unmappableJobs = activeRoute?.unmappableJobs || [];
    const mappableJobs = activeRoute?.mappableJobs || [];

    const handleCopyUnplotted = () => {
        if (unmappableJobs.length === 0) return;

        const addressesToCopy = unmappableJobs.map(job => job.address).join('\n');

        navigator.clipboard.writeText(addressesToCopy).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2500);
        }).catch(err => {
            console.error("Failed to copy unplotted addresses:", err);
            alert("Could not copy addresses. Please check browser permissions.");
        });
    };

    // Handle resize
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        const startX = e.clientX;
        const startWidth = panelWidth;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const dx = moveEvent.clientX - startX;
            const newWidth = Math.max(200, Math.min(600, startWidth + dx));
            setPanelWidth(newWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
    }, [panelWidth]);

    // Handle job update with auto-geocode
    const handleUpdateJobWithGeocode = useCallback(async (jobId: string, updates: Partial<DisplayJob>) => {
        // First update the job
        handleUpdateJob(jobId, updates);

        // If address was updated, try to geocode it
        if (updates.address) {
            try {
                const results = await geocodeAddresses([updates.address]);
                if (results[0]?.coordinates) {
                    // Address is now valid, place the job at the geocoded location
                    handlePlaceJobOnMap(jobId, results[0].coordinates.lat, results[0].coordinates.lon);
                }
            } catch (error) {
                console.log('Geocoding failed for updated address:', error);
                // Job stays in unplotted list
            }
        }
    }, [handleUpdateJob, handlePlaceJobOnMap]);

    // Handle custom placement with visual marker
    const handlePlaceWithMarker = useCallback((jobId: string, lat: number, lon: number) => {
        // Store the placed location to show marker
        setPlacedLocation({ jobId, lat, lon });

        // Call the original handler
        handlePlaceJobOnMap(jobId, lat, lon);

        // Clear placement mode
        setPlacementJobId(null);
    }, [handlePlaceJobOnMap, setPlacementJobId]);

    // Create jobs for map - include mappable jobs plus any placed location marker
    const jobsForMap: DisplayJob[] = [...mappableJobs];
    const mapCoordinates: { lat: number; lon: number }[] = activeRoute?.routeInfo?.coordinates ? [...activeRoute.routeInfo.coordinates] : [];

    // Add a temporary marker for a just-placed job
    if (placedLocation) {
        const placedJob = unmappableJobs.find(j => j.id === placedLocation.jobId);
        if (placedJob) {
            // Add as an estimated location marker
            jobsForMap.push({
                ...placedJob,
                isEstimatedLocation: true,
                lat: placedLocation.lat,
                lon: placedLocation.lon,
            });
            mapCoordinates.push({ lat: placedLocation.lat, lon: placedLocation.lon });
        }
    }

    // Construct a temporary RouteInfo object to pass explicit coordinates to LeafletMap
    // This prevents the map from trying to re-geocode addresses (which would fail for the unplotted job)
    const tempRouteInfo = {
        distance: 0,
        duration: 0,
        geometry: null,
        coordinates: mapCoordinates
    };

    const placingJob = placementJobId ? unmappableJobs.find(j => j.id === placementJobId) : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
            <div className="bg-bg-primary rounded-lg shadow-2xl w-[90vw] max-w-5xl h-[85vh] flex flex-col border border-border-primary overflow-hidden">
                {/* Header */}
                <header className="flex-shrink-0 p-4 border-b border-border-primary flex justify-between items-start bg-tag-red-bg">
                    <div>
                        <h2 className="text-lg font-bold text-tag-red-text flex items-center gap-2">
                            <span className="text-xl">⚠️</span>
                            {unmappableJobs.length} Unplotted Jobs
                        </h2>
                        <p className="text-xs text-tag-red-text/80 mt-1">
                            {placementJobId
                                ? "Click on the map to place the selected job at a custom location"
                                : "These jobs could not be geocoded. Click 'Place on Map' to set a custom location."}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleRefreshRoute}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors bg-bg-primary text-text-secondary hover:bg-bg-secondary border border-border-primary"
                            title="Refresh map view"
                        >
                            <RefreshIcon className="h-4 w-4" />
                            <span>Refresh</span>
                        </button>
                        <button
                            onClick={handleCopyUnplotted}
                            disabled={unmappableJobs.length === 0}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${copySuccess
                                ? 'bg-tag-green-bg text-tag-green-text'
                                : 'bg-bg-primary text-text-secondary hover:bg-bg-secondary border border-border-primary'
                                } disabled:opacity-50`}
                            title="Copy addresses to clipboard"
                        >
                            <ClipboardIcon className="h-4 w-4" />
                            <span>{copySuccess ? 'Copied!' : 'Copy All'}</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-md hover:bg-bg-primary/50 text-tag-red-text transition-colors"
                            title="Close"
                        >
                            <XIcon className="h-5 w-5" />
                        </button>
                    </div>
                </header>

                {/* Main Content */}
                <div ref={containerRef} className="flex-grow flex min-h-0 overflow-hidden">
                    {/* Left: Job List */}
                    <div
                        className="flex-shrink-0 border-r border-border-primary flex flex-col bg-bg-secondary"
                        style={{ width: panelWidth }}
                    >
                        <div className="flex-grow overflow-y-auto p-3 space-y-2">
                            {unmappableJobs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                                    <MapPinIcon className="h-12 w-12 text-tag-green-text mb-3" />
                                    <p className="text-sm font-medium text-text-secondary">All jobs plotted!</p>
                                    <p className="text-xs text-text-tertiary mt-1">No unplotted jobs remaining.</p>
                                </div>
                            ) : (
                                unmappableJobs.map(job => (
                                    <div
                                        key={job.id}
                                        className={`bg-bg-primary rounded-lg border shadow-sm transition-all ${placementJobId === job.id
                                            ? 'border-brand-primary ring-2 ring-brand-primary/30'
                                            : 'border-tag-red-border/50'
                                            }`}
                                    >
                                        <JobCard
                                            job={job}
                                            onUpdateJob={handleUpdateJobWithGeocode}
                                            onUnassign={job.assignedRepName ? handleUnassignJob : undefined}
                                            onRemove={handleRemoveJob}
                                            onPlaceOnMap={setPlacementJobId}
                                        />
                                        {job.geocodeError && (
                                            <div className="px-3 py-1.5 text-[10px] text-tag-red-text font-mono border-t border-tag-red-border/30 bg-tag-red-bg/30">
                                                {job.geocodeError}
                                            </div>
                                        )}
                                        {placementJobId === job.id && (
                                            <div className="px-3 py-2 text-xs font-semibold text-brand-primary bg-brand-bg-light border-t border-brand-primary/20 flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
                                                Click on map to place
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer with Auto-Fix Button */}
                        {unmappableJobs.length > 0 && (
                            <div className="flex-shrink-0 p-3 border-t border-border-primary bg-bg-primary">
                                <button
                                    onClick={handleTryAddressVariations}
                                    disabled={isTryingVariations}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-colors bg-tag-red-bg border border-tag-red-border text-tag-red-text hover:bg-tag-red-bg/70 disabled:opacity-50"
                                >
                                    {isTryingVariations ? (
                                        <LoadingIcon className="text-tag-red-text" />
                                    ) : (
                                        <VariationsIcon className="h-4 w-4" />
                                    )}
                                    <span>{isTryingVariations ? 'Trying Variations...' : 'Try Auto-Fix Variations'}</span>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Resizer Handle */}
                    <div
                        onMouseDown={handleResizeStart}
                        className={`w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center group hover:bg-brand-primary/20 transition-colors ${isResizing ? 'bg-brand-primary/30' : ''}`}
                    >
                        <div className={`w-0.5 h-16 rounded-full transition-colors ${isResizing ? 'bg-brand-primary' : 'bg-border-secondary group-hover:bg-brand-primary'}`} />
                    </div>

                    {/* Right: Map */}
                    <div className="flex-grow relative bg-bg-quaternary overflow-hidden">
                        {placingJob && (
                            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-brand-primary text-brand-text-on-primary px-4 py-2 rounded-full shadow-lg text-xs font-bold flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                                Click map to place: {placingJob.customerName || placingJob.address.slice(0, 30)}...
                            </div>
                        )}
                        <LeafletMap
                            jobs={jobsForMap}
                            routeInfo={tempRouteInfo}
                            mapType="unassigned"
                            placementJobId={placementJobId}
                            onPlaceJob={handlePlaceWithMarker}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UnplottedJobsModal;
