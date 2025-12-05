import React, { useMemo, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { TIME_SLOTS } from '../constants';
import { ClipboardIcon, XIcon, ClockIcon, MapPinIcon } from './icons';

interface CitySection {
    title: string;
    cities: string[];
    region: string;
}

const CITY_SECTIONS: CitySection[] = [
    {
        title: 'East Valley',
        cities: ['Gold Canyon', 'Apache Junction', 'Queen Creek', 'San Tan Valley', 'Mesa', 'Gilbert', 'Chandler', 'Sun Lakes'],
        region: 'PHX'
    },
    {
        title: 'Central Phoenix & Scottsdale',
        cities: ['Fountain Hills', 'Scottsdale', 'Paradise Valley', 'Tempe', 'Guadalupe', 'Phoenix', 'Cave Creek', 'Carefree', 'Anthem', 'New River'],
        region: 'PHX'
    },
    {
        title: 'West Valley',
        cities: ['Glendale', 'Peoria', 'Sun City', 'El Mirage', 'Youngtown', 'Tolleson', 'Laveen', 'Avondale', 'Litchfield Park', 'Goodyear', 'Sun City West', 'Surprise', 'Waddell', 'Buckeye'],
        region: 'PHX'
    },
    {
        title: 'Lower Valley',
        cities: ['Florence', 'Coolidge', 'Eloy', 'Arizona City', 'Casa Grande', 'Sacaton', 'Maricopa', 'Stanfield'],
        region: 'PHX'
    },
    {
        title: 'Northern Arizona',
        cities: ['Prescott', 'Prescott Valley', 'Flagstaff', 'Sedona', 'Payson', 'Cottonwood', 'Camp Verde', 'Chino Valley'],
        region: 'NORTH'
    },
    {
        title: 'Southern Arizona',
        cities: ['Tucson', 'Oro Valley', 'Marana', 'Vail', 'Sahuarita', 'Green Valley', 'Rio Rico', 'Nogales'],
        region: 'SOUTH'
    }
];

const REGION_NAMES: Record<string, string> = {
    'PHX': 'Greater Phoenix',
    'NORTH': 'Northern AZ',
    'SOUTH': 'Southern AZ',
    'UNKNOWN': 'Unknown Region'
};

interface AvailabilitySummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AvailabilitySummaryModal: React.FC<AvailabilitySummaryModalProps> = ({ isOpen, onClose }) => {
    const { appState, selectedDate } = useAppContext();
    const selectedDayString = selectedDate.toLocaleString('en-us', { weekday: 'long' });
    const [selectSuccess, setSelectSuccess] = useState(false);
    const summaryRef = useRef<HTMLDivElement>(null);
    const [viewMode, setViewMode] = useState<'by-city' | 'by-time'>('by-time');

    // --- Logic for 'By City' View ---
    const { cityAvailability, otherActiveCities } = useMemo(() => {
        const data: Record<string, Record<string, string[]>> = {};
        const processedCities = new Set<string>();
        const normalize = (s: string) => s.toLowerCase().trim();

        CITY_SECTIONS.forEach(section => {
            section.cities.forEach(city => processedCities.add(normalize(city)));
        });

        const otherCitiesFound = new Set<string>();

        appState.reps.forEach(rep => {
            const unavailableSlotIds = new Set(rep.unavailableSlots?.[selectedDayString] || []);
            
            const openSlots = rep.schedule
                .filter(slot => !unavailableSlotIds.has(slot.id) && slot.jobs.length === 0)
                .map(slot => slot.label);

            if (openSlots.length === 0) return;

            const jobsToday = rep.schedule.flatMap(s => s.jobs);
            const isFree = jobsToday.length === 0;
            
            const activeCitiesMap = new Map<string, string>(); 
            jobsToday.forEach(j => {
                if (j.city) activeCitiesMap.set(normalize(j.city), j.city);
            });

            CITY_SECTIONS.forEach(section => {
                const repMatchesRegion = rep.region === section.region || (rep.region === 'UNKNOWN' && section.region === 'PHX');

                section.cities.forEach(city => {
                    const cityKey = city; 
                    const cityLower = normalize(city);
                    let shouldShow = false;

                    if (isFree) {
                        if (repMatchesRegion) shouldShow = true;
                    } else {
                        if (activeCitiesMap.has(cityLower)) shouldShow = true;
                    }
                    
                    if (shouldShow) {
                         if (!data[cityKey]) data[cityKey] = {};
                         openSlots.forEach(slot => {
                             if (!data[cityKey][slot]) data[cityKey][slot] = [];
                             data[cityKey][slot].push(rep.name);
                         });
                    }
                });
            });

            if (!isFree) {
                activeCitiesMap.forEach((originalCityName, normalizedCity) => {
                    if (!processedCities.has(normalizedCity)) {
                        otherCitiesFound.add(originalCityName);
                        if (!data[originalCityName]) data[originalCityName] = {};
                        openSlots.forEach(slot => {
                            if (!data[originalCityName][slot]) data[originalCityName][slot] = [];
                            data[originalCityName][slot].push(rep.name);
                        });
                    }
                });
            }
        });
        
        Object.values(data).forEach(slots => {
            Object.values(slots).forEach(names => names.sort());
        });

        return { cityAvailability: data, otherActiveCities: Array.from(otherCitiesFound).sort() };
    }, [appState.reps, selectedDayString]);

    // --- Logic for 'By Time Slot' View ---
    const repsByTimeSlot = useMemo(() => {
        const data: Record<string, { name: string, activeCities: string[], isFree: boolean, region: string }[]> = {};
        
        TIME_SLOTS.forEach(slot => {
            data[slot.label] = [];
        });

        appState.reps.forEach(rep => {
            const unavailableSlotIds = new Set(rep.unavailableSlots?.[selectedDayString] || []);
            const jobsToday = rep.schedule.flatMap(s => s.jobs);
            const isFree = jobsToday.length === 0;
            
            // Determine cities they are working in today
            const activeCities = Array.from(new Set(jobsToday.map(j => j.city).filter((c): c is string => !!c))).sort();

            rep.schedule.forEach(slot => {
                // If slot is not unavailable AND has no jobs, they are available
                if (!unavailableSlotIds.has(slot.id) && slot.jobs.length === 0) {
                    data[slot.label].push({
                        name: rep.name,
                        activeCities,
                        isFree,
                        region: rep.region || 'UNKNOWN'
                    });
                }
            });
        });

        // Sort each slot: Busy reps first (grouped by similarity?), then Free reps
        Object.keys(data).forEach(slotLabel => {
            data[slotLabel].sort((a, b) => {
                // 1. Busy reps first
                if (!a.isFree && b.isFree) return -1;
                if (a.isFree && !b.isFree) return 1;
                
                // 2. Alphabetical
                return a.name.localeCompare(b.name);
            });
        });

        return data;
    }, [appState.reps, selectedDayString]);


    const handleSelectAll = () => {
        if (summaryRef.current) {
            const range = document.createRange();
            range.selectNode(summaryRef.current);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
                setSelectSuccess(true);
                setTimeout(() => setSelectSuccess(false), 2500);
            }
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="popup-surface w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                 <header className="p-4 border-b border-border-primary flex justify-between items-center flex-shrink-0 bg-bg-secondary">
                    <div>
                        <h2 className="text-xl font-bold text-text-primary">Slot Availability</h2>
                        <p className="text-xs text-text-tertiary mt-1">
                            Check which reps are open for specific times and where they are located.
                        </p>
                    </div>
                    <div className="flex items-center space-x-3">
                        <div className="flex bg-bg-tertiary rounded-lg p-1">
                            <button
                                onClick={() => setViewMode('by-time')}
                                className={`flex items-center space-x-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'by-time' ? 'bg-bg-primary text-brand-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}`}
                            >
                                <ClockIcon className="h-3.5 w-3.5" />
                                <span>By Time Slot</span>
                            </button>
                            <button
                                onClick={() => setViewMode('by-city')}
                                className={`flex items-center space-x-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'by-city' ? 'bg-bg-primary text-brand-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}`}
                            >
                                <MapPinIcon className="h-3.5 w-3.5" />
                                <span>By City</span>
                            </button>
                        </div>
                        <button 
                            onClick={handleSelectAll}
                            className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors shadow-sm ${selectSuccess ? 'bg-tag-green-bg text-tag-green-text' : 'bg-bg-primary text-brand-primary border border-border-primary hover:bg-brand-bg-light'}`}
                        >
                            <ClipboardIcon className="h-4 w-4" />
                            <span>{selectSuccess ? 'Selected!' : 'Select All'}</span>
                        </button>
                        <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary p-1 hover:bg-bg-tertiary rounded-full transition">
                            <XIcon className="h-6 w-6" />
                        </button>
                    </div>
                </header>
                <div className="flex-grow bg-bg-tertiary p-6 overflow-y-auto custom-scrollbar">
                    <div ref={summaryRef} className="space-y-6 max-w-5xl mx-auto">
                        
                        {viewMode === 'by-time' && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {TIME_SLOTS.map(slot => {
                                    const availableReps = repsByTimeSlot[slot.label];
                                    if (!availableReps || availableReps.length === 0) {
                                        return (
                                            <div key={slot.id} className="bg-bg-primary border border-border-primary rounded-lg p-4 opacity-60">
                                                <h3 className="text-lg font-bold text-text-quaternary mb-2">{slot.label}</h3>
                                                <p className="text-sm text-text-quaternary italic">No representatives available.</p>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={slot.id} className="bg-bg-primary border border-border-primary rounded-lg shadow-sm overflow-hidden">
                                            <div className="bg-brand-bg-light px-4 py-3 border-b border-brand-primary/20 flex justify-between items-center">
                                                <h3 className="text-lg font-bold text-brand-text-light">{slot.label}</h3>
                                                <span className="text-xs font-semibold bg-bg-primary text-brand-primary px-2 py-0.5 rounded-full border border-brand-primary/20">
                                                    {availableReps.length} Available
                                                </span>
                                            </div>
                                            <div className="p-0 divide-y divide-border-primary max-h-80 overflow-y-auto custom-scrollbar">
                                                {availableReps.map((rep, idx) => (
                                                    <div key={idx} className="px-4 py-2.5 hover:bg-bg-secondary transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                                        <span className="font-bold text-text-primary text-sm">{rep.name}</span>
                                                        
                                                        {rep.isFree ? (
                                                            <span className="text-xs font-medium text-tag-green-text bg-tag-green-bg px-2 py-0.5 rounded-full border border-tag-green-border inline-flex items-center">
                                                                <span className="w-1.5 h-1.5 bg-tag-green-text rounded-full mr-1.5"></span>
                                                                Free in {REGION_NAMES[rep.region] || rep.region}
                                                            </span>
                                                        ) : (
                                                            <div className="flex items-center text-xs text-text-tertiary bg-bg-tertiary px-2 py-0.5 rounded-full max-w-full sm:max-w-[60%]">
                                                                <MapPinIcon className="h-3 w-3 mr-1 text-text-quaternary flex-shrink-0" />
                                                                <span className="truncate" title={rep.activeCities.join(', ')}>
                                                                    Active in: <span className="font-semibold text-text-secondary">{rep.activeCities.join(', ')}</span>
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {viewMode === 'by-city' && (
                            <>
                                {[...CITY_SECTIONS, ...(otherActiveCities.length > 0 ? [{ title: 'Other Active Locations', cities: otherActiveCities, region: 'UNKNOWN' }] : [])].map(section => {
                                    const hasData = section.cities.some(city => {
                                        const slots = cityAvailability[city];
                                        return slots && Object.keys(slots).length > 0;
                                    });

                                    if (!hasData) return null;

                                    return (
                                        <div key={section.title} className="bg-bg-primary rounded-lg shadow-sm border border-border-primary overflow-hidden">
                                            <div className="bg-bg-secondary px-6 py-3 border-b border-border-primary">
                                                <h3 className="text-lg font-bold text-brand-text-light">{section.title}</h3>
                                            </div>
                                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                                {section.cities.map(city => {
                                                    const slots = cityAvailability[city];
                                                    if (!slots || Object.keys(slots).length === 0) return null;

                                                    return (
                                                        <div key={city} className="border rounded-md p-3 hover:shadow-md transition-shadow bg-bg-primary">
                                                            <h4 className="font-bold text-text-primary border-b pb-1 mb-2">{city}</h4>
                                                            <div className="space-y-2">
                                                                {TIME_SLOTS.map(slot => {
                                                                    const reps = slots[slot.label];
                                                                    if (!reps || reps.length === 0) return null;
                                                                    return (
                                                                        <div key={slot.id} className="text-sm">
                                                                            <span className="font-semibold text-brand-primary block text-xs">{slot.label}</span>
                                                                            <span className="text-text-secondary leading-tight block">{reps.join(', ')}</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                                {Object.keys(cityAvailability).length === 0 && (
                                     <div className="flex flex-col items-center justify-center h-64 text-text-tertiary">
                                         <p className="text-lg font-semibold">No open slots found.</p>
                                         <p className="text-sm max-w-md text-center mt-2 text-text-quaternary">
                                             All representatives are either fully booked or unavailable for today.
                                         </p>
                                     </div>
                                 )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AvailabilitySummaryModal;