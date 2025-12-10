import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon, ChevronLeftIcon, ChevronRightIcon, CalendarIcon } from './icons';

// Helper to get week number
const getWeekNumber = (date: Date): number => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

// Helper to check if date is today
const isToday = (date: Date): boolean => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
};

// Helper to check if date is weekend
const isWeekend = (date: Date): boolean => {
    const day = date.getDay();
    return day === 0 || day === 6;
};

// A completely redesigned, better-styled calendar component for adding new days.
const CalendarPicker: React.FC<{ onSelect: (date: Date) => void; existingDates: string[] }> = ({ onSelect, existingDates }) => {
    const [displayDate, setDisplayDate] = useState(new Date());
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const changeMonth = (offset: number) => {
        setDisplayDate(prev => {
            const newDate = new Date(prev);
            newDate.setDate(1);
            newDate.setMonth(newDate.getMonth() + offset);
            return newDate;
        });
    };

    const year = displayDate.getFullYear();
    const month = displayDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();

    const calendarDays = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
        calendarDays.push(<div key={`pad-${i}`} className="w-9 h-9"></div>);
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(year, month, day);
        const dateKey = currentDate.toISOString().split('T')[0];
        const isTodayDate = currentDate.getTime() === today.getTime();
        const isAlreadyAdded = existingDates.includes(dateKey);
        const isWeekendDay = isWeekend(currentDate);

        calendarDays.push(
            <button
                key={day}
                onClick={() => !isAlreadyAdded && onSelect(currentDate)}
                disabled={isAlreadyAdded}
                className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm transition-all
                    ${isTodayDate ? 'ring-2 ring-brand-primary ring-offset-1 font-bold' : ''}
                    ${isAlreadyAdded ? 'bg-brand-primary/20 text-brand-primary cursor-not-allowed' : ''}
                    ${isWeekendDay && !isAlreadyAdded ? 'text-text-tertiary' : 'text-text-primary'}
                    ${!isAlreadyAdded && !isTodayDate ? 'hover:bg-brand-bg-light hover:scale-105' : ''}
                    ${isTodayDate && !isAlreadyAdded ? 'hover:bg-brand-primary/20' : ''}
                `}
            >
                {day}
            </button>
        );
    }

    return (
        <div className="bg-bg-primary border border-border-primary rounded-xl shadow-xl p-4 w-72">
            <div className="flex justify-between items-center mb-4">
                <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg hover:bg-bg-tertiary text-text-secondary transition-colors">
                    <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <div className="font-bold text-sm text-text-primary">
                    {displayDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                </div>
                <button onClick={() => changeMonth(1)} className="p-2 rounded-lg hover:bg-bg-tertiary text-text-secondary transition-colors">
                    <ChevronRightIcon className="h-4 w-4" />
                </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-text-tertiary font-semibold mb-2">
                <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
            </div>
            <div className="grid grid-cols-7 gap-1">
                {calendarDays}
            </div>
            <div className="flex gap-2 mt-4">
                <button
                    onClick={() => onSelect(today)}
                    className="flex-1 py-2 text-xs font-semibold bg-brand-bg-light text-brand-text-light rounded-lg hover:bg-brand-primary/20 transition"
                >
                    Today
                </button>
                <button
                    onClick={() => {
                        const nextMonday = new Date();
                        nextMonday.setDate(nextMonday.getDate() + ((1 + 7 - nextMonday.getDay()) % 7 || 7));
                        onSelect(nextMonday);
                    }}
                    className="flex-1 py-2 text-xs font-semibold bg-bg-tertiary text-text-secondary rounded-lg hover:bg-bg-quaternary transition"
                >
                    Next Week
                </button>
            </div>
        </div>
    );
};

// Compact progress indicator (dot-based for small space)
const ProgressDot: React.FC<{ assigned: number; total: number; isSelected: boolean }> = ({ assigned, total, isSelected }) => {
    if (total === 0) return null;
    const percentage = Math.round((assigned / total) * 100);

    const color = percentage === 100
        ? 'bg-green-400'
        : percentage >= 50
        ? isSelected ? 'bg-white/80' : 'bg-brand-primary'
        : isSelected ? 'bg-white/60' : 'bg-amber-400';

    return (
        <div className={`w-1.5 h-1.5 rounded-full ${color}`} title={`${percentage}% assigned`} />
    );
};

// Individual day tab component - compact horizontal layout
const DayTab: React.FC<{
    dateKey: string;
    isSelected: boolean;
    assigned: number;
    total: number;
    canRemove: boolean;
    onSelect: () => void;
    onRemove: () => void;
}> = ({ dateKey, isSelected, assigned, total, canRemove, onSelect, onRemove }) => {
    const date = new Date(dateKey + 'T12:00:00');
    const isTodayDate = isToday(date);
    const isWeekendDay = isWeekend(date);

    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const dayOfMonth = date.getDate();
    const monthDay = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    const fullDate = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    return (
        <div
            onClick={onSelect}
            title={`${fullDate}${total > 0 ? ` • ${assigned}/${total} jobs assigned` : ''}`}
            className={`
                relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-all duration-150 group
                ${isSelected
                    ? 'bg-brand-primary text-brand-text-on-primary shadow-md'
                    : isWeekendDay
                    ? 'bg-bg-tertiary/50 text-text-tertiary hover:bg-bg-quaternary'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-bg-quaternary'
                }
                ${isTodayDate && !isSelected ? 'ring-1 ring-brand-primary' : ''}
            `}
        >
            {/* Today indicator dot */}
            {isTodayDate && (
                <div className={`absolute -top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-brand-primary'}`} />
            )}

            {/* Day name & number */}
            <div className="flex flex-col items-center leading-none">
                <span className={`text-[9px] font-medium uppercase ${isSelected ? 'opacity-70' : 'text-text-quaternary'}`}>
                    {dayName}
                </span>
                <span className="text-sm font-bold">{dayOfMonth}</span>
            </div>

            {/* Job count with progress dot */}
            {total > 0 && (
                <div className={`flex items-center gap-1 text-[10px] font-medium ${isSelected ? 'opacity-80' : 'text-text-tertiary'}`}>
                    <ProgressDot assigned={assigned} total={total} isSelected={isSelected} />
                    <span>{assigned}/{total}</span>
                </div>
            )}

            {/* Remove button */}
            {canRemove && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    className={`
                        absolute -top-1 -right-1 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all
                        ${isSelected
                            ? 'bg-white/20 hover:bg-red-500 text-white'
                            : 'bg-gray-400 text-white hover:bg-red-500'
                        }
                    `}
                >
                    <XIcon className="h-2.5 w-2.5" />
                </button>
            )}
        </div>
    );
};

const DayTabs: React.FC = () => {
    const { activeDayKeys, selectedDate, setSelectedDate, addActiveDay, removeActiveDay, getJobCountsForDay, allJobs, assignedJobsCount } = useAppContext();
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const calendarRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const handleSelectDay = (date: Date) => {
        addActiveDay(date);
        setIsCalendarOpen(false);
    };

    // Check scroll state
    const checkScrollState = useCallback(() => {
        if (scrollContainerRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
            setCanScrollLeft(scrollLeft > 0);
            setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
        }
    }, []);

    useEffect(() => {
        checkScrollState();
        const container = scrollContainerRef.current;
        if (container) {
            container.addEventListener('scroll', checkScrollState);
            window.addEventListener('resize', checkScrollState);
        }
        return () => {
            if (container) {
                container.removeEventListener('scroll', checkScrollState);
            }
            window.removeEventListener('resize', checkScrollState);
        };
    }, [checkScrollState, activeDayKeys]);

    // Scroll handlers
    const scroll = (direction: 'left' | 'right') => {
        if (scrollContainerRef.current) {
            const scrollAmount = 200;
            scrollContainerRef.current.scrollBy({
                left: direction === 'left' ? -scrollAmount : scrollAmount,
                behavior: 'smooth'
            });
        }
    };

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            const currentIndex = activeDayKeys.indexOf(selectedDate.toISOString().split('T')[0]);

            if (e.key === 'ArrowLeft' && currentIndex > 0) {
                const prevDate = new Date(activeDayKeys[currentIndex - 1] + 'T12:00:00');
                setSelectedDate(prevDate);
            } else if (e.key === 'ArrowRight' && currentIndex < activeDayKeys.length - 1) {
                const nextDate = new Date(activeDayKeys[currentIndex + 1] + 'T12:00:00');
                setSelectedDate(nextDate);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeDayKeys, selectedDate, setSelectedDate]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
                setIsCalendarOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedKey = selectedDate.toISOString().split('T')[0];

    // Group days by week for visual separation
    const groupedDays = useMemo(() => {
        const groups: { weekLabel: string; days: string[] }[] = [];
        let currentWeek: string[] = [];
        let currentWeekNum: number | null = null;

        activeDayKeys.forEach((dateKey, index) => {
            const date = new Date(dateKey + 'T12:00:00');
            const weekNum = getWeekNumber(date);

            if (currentWeekNum !== null && weekNum !== currentWeekNum && currentWeek.length > 0) {
                const firstDay = new Date(currentWeek[0] + 'T12:00:00');
                groups.push({
                    weekLabel: `Week of ${firstDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
                    days: currentWeek
                });
                currentWeek = [];
            }

            currentWeek.push(dateKey);
            currentWeekNum = weekNum;

            if (index === activeDayKeys.length - 1 && currentWeek.length > 0) {
                const firstDay = new Date(currentWeek[0] + 'T12:00:00');
                groups.push({
                    weekLabel: `Week of ${firstDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
                    days: currentWeek
                });
            }
        });

        return groups;
    }, [activeDayKeys]);

    // Calculate totals for header summary
    const totalStats = useMemo(() => {
        let totalJobs = 0;
        let totalAssigned = 0;
        activeDayKeys.forEach(dateKey => {
            const { assigned, total } = dateKey === selectedKey
                ? { assigned: assignedJobsCount, total: allJobs.length }
                : getJobCountsForDay(dateKey);
            totalJobs += total;
            totalAssigned += assigned;
        });
        return { totalJobs, totalAssigned };
    }, [activeDayKeys, selectedKey, assignedJobsCount, allJobs.length, getJobCountsForDay]);

    return (
        <div className="flex items-center gap-1.5">
            {/* Summary badge - compact */}
            <div className="hidden xl:flex items-center gap-1.5 px-2 py-1 bg-bg-tertiary/50 rounded-md">
                <span className="text-[10px] font-semibold text-text-tertiary">
                    {activeDayKeys.length}d
                </span>
                {totalStats.totalJobs > 0 && (
                    <>
                        <div className="w-px h-3 bg-border-secondary" />
                        <span className="text-[10px] font-semibold text-text-secondary">
                            {totalStats.totalAssigned}/{totalStats.totalJobs}
                        </span>
                    </>
                )}
            </div>

            {/* Main container */}
            <div className="relative flex items-center bg-bg-primary border border-border-secondary rounded-lg shadow-sm overflow-hidden">
                {/* Left scroll button */}
                {canScrollLeft && (
                    <button
                        onClick={() => scroll('left')}
                        className="absolute left-0 z-20 h-full px-0.5 bg-gradient-to-r from-bg-primary via-bg-primary to-transparent hover:from-bg-tertiary"
                    >
                        <ChevronLeftIcon className="h-3.5 w-3.5 text-text-secondary" />
                    </button>
                )}

                {/* Scrollable days container */}
                <div
                    ref={scrollContainerRef}
                    className="flex items-center gap-0.5 p-1 overflow-x-auto scrollbar-hide max-w-[500px]"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {groupedDays.map((group, groupIndex) => (
                        <React.Fragment key={group.weekLabel}>
                            {/* Week divider (show between groups) */}
                            {groupIndex > 0 && (
                                <div className="flex items-center px-0.5 opacity-40">
                                    <div className="w-px h-6 bg-border-secondary" />
                                </div>
                            )}

                            {/* Days in this week */}
                            {group.days.map(dateKey => {
                                const isSelected = dateKey === selectedKey;
                                const { assigned, total } = isSelected
                                    ? { assigned: assignedJobsCount, total: allJobs.length }
                                    : getJobCountsForDay(dateKey);

                                return (
                                    <DayTab
                                        key={dateKey}
                                        dateKey={dateKey}
                                        isSelected={isSelected}
                                        assigned={assigned}
                                        total={total}
                                        canRemove={activeDayKeys.length > 1}
                                        onSelect={() => setSelectedDate(new Date(dateKey + 'T12:00:00'))}
                                        onRemove={() => removeActiveDay(dateKey)}
                                    />
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>

                {/* Right scroll button */}
                {canScrollRight && (
                    <button
                        onClick={() => scroll('right')}
                        className="absolute right-0 z-20 h-full px-0.5 bg-gradient-to-l from-bg-primary via-bg-primary to-transparent hover:from-bg-tertiary"
                    >
                        <ChevronRightIcon className="h-3.5 w-3.5 text-text-secondary" />
                    </button>
                )}
            </div>

            {/* Add day button - compact */}
            <div className="relative" ref={calendarRef}>
                <button
                    onClick={() => setIsCalendarOpen(prev => !prev)}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-semibold bg-tag-green-bg text-tag-green-text rounded-lg hover:bg-tag-green-bg/80 transition-all"
                    title="Add a new day to your workspace"
                >
                    <CalendarIcon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Add</span>
                </button>
                {isCalendarOpen && (
                    <div className="absolute top-full right-0 mt-2 z-50">
                        <CalendarPicker onSelect={handleSelectDay} existingDates={activeDayKeys} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default DayTabs;