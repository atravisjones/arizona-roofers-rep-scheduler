import React, { useEffect, useRef, useState, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { geocodeAddresses, Coordinates, fetchRoute } from '../services/osmService';
import { LoadingIcon } from './icons';
import { RouteInfo, DisplayJob } from '../types';
import { JobCard } from './JobCard';
import { useAppContext, AppContext } from '../context/AppContext';
import { TAG_KEYWORDS } from '../constants';

declare const L: any;

interface LeafletMapProps {
  jobs: DisplayJob[];
  routeInfo?: RouteInfo | null;
  mapType?: 'unassigned' | 'route';
  placementJobId?: string | null;
  onPlaceJob?: (jobId: string, lat: number, lon: number) => void;
}

const PHOENIX_COORDS: [number, number] = [33.4484, -112.0740];
const DEFAULT_ZOOM = 9;
const ROUTE_ZOOM = 12;

const LeafletMap: React.FC<LeafletMapProps> = ({ jobs, routeInfo: preloadedRouteInfo, mapType = 'route', placementJobId, onPlaceJob }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const featureGroupRef = useRef<any>(null);
  const markersRef = useRef<Map<string, { marker: any; baseIcon: any; highlightIcon: any }>>(new Map());

  // Get current context to bridge into Leaflet popups
  const contextValue = useAppContext();
  // Store context in a ref so closure always accesses the latest value when opening popups
  const contextValueRef = useRef(contextValue);
  contextValueRef.current = contextValue;

  const { handleUnassignJob, handleUpdateJob, handleRemoveJob, setDraggedJob, handleJobDragEnd, hoveredJobId, hoveredRepId, appState } = contextValue;

  // Create a lookup from repId to repName for hover filtering
  const repIdToNameMap = useMemo(() => {
    const map = new Map<string, string>();
    appState.reps.forEach(rep => {
      map.set(rep.id, rep.name);
    });
    return map;
  }, [appState.reps]);

  // Track React roots for cleanup to prevent memory leaks and hydration errors
  const popupRootsRef = useRef<ReactDOM.Root[]>([]);
  const dataIdentityRef = useRef<string>('');
  const previousHoveredIdRef = useRef<string | null>(null);
  const previousHoveredRepIdRef = useRef<string | null>(null);
  const jobRepNameMapRef = useRef<Map<string, string | undefined>>(new Map()); // Map jobId to assignedRepName

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalRouteInfo, setInternalRouteInfo] = useState<RouteInfo | null>(null);
  const [mappableJobs, setMappableJobs] = useState<DisplayJob[]>([]);

  const effectiveRouteInfo = preloadedRouteInfo !== undefined ? preloadedRouteInfo : internalRouteInfo;
  const addresses = useMemo(() => jobs.map(j => {
    // Combine address, city, and zipCode for accurate geocoding
    const parts = [j.address];
    if (j.city) parts.push(j.city);
    if (j.zipCode) parts.push(j.zipCode);
    return parts.join(', ');
  }), [jobs]);

  const isPlacementMode = !!placementJobId;

  // Clean up any React roots created for popups when the component unmounts
  useEffect(() => {
    return () => {
      // Defer unmounting to avoid "synchronously unmount while rendering" errors
      const rootsToUnmount = [...popupRootsRef.current];
      popupRootsRef.current = [];
      setTimeout(() => {
        rootsToUnmount.forEach(root => {
          try {
            root.unmount();
          } catch (e) {
            // Ignore errors during cleanup
          }
        });
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (mapContainerRef.current && !mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        center: PHOENIX_COORDS,
        zoom: DEFAULT_ZOOM,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(mapRef.current);

      featureGroupRef.current = L.featureGroup().addTo(mapRef.current);
    }

    return () => {
      if (mapRef.current) {
        if (featureGroupRef.current) featureGroupRef.current.clearLayers();
        mapRef.current.remove();
        mapRef.current = null;
        featureGroupRef.current = null;
      }
    };
  }, []);

  // Add click handler for placement mode
  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current;

    if (isPlacementMode && onPlaceJob) {
      // Change cursor to crosshair
      const container = mapContainerRef.current;
      if (container) {
        container.style.cursor = 'crosshair';
      }

      const handleMapClick = (e: any) => {
        const { lat, lng } = e.latlng;
        onPlaceJob(placementJobId, lat, lng);
      };

      map.on('click', handleMapClick);

      return () => {
        map.off('click', handleMapClick);
        if (container) {
          container.style.cursor = '';
        }
      };
    } else {
      const container = mapContainerRef.current;
      if (container) {
        container.style.cursor = '';
      }
    }
  }, [isPlacementMode, placementJobId, onPlaceJob]);

  useEffect(() => {
    if (!mapRef.current || !mapContainerRef.current) return;

    const map = mapRef.current;
    const resizeObserver = new ResizeObserver(() => {
      setTimeout(() => {
        if (mapRef.current) {
          map.invalidateSize();
        }
      }, 100);
    });

    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Handle hover highlighting without rebuilding all markers
  useEffect(() => {
    // Reset the previously hovered marker to its base icon
    if (previousHoveredIdRef.current && previousHoveredIdRef.current !== hoveredJobId) {
      const prevMarkerData = markersRef.current.get(previousHoveredIdRef.current);
      if (prevMarkerData) {
        prevMarkerData.marker.setIcon(prevMarkerData.baseIcon);
        prevMarkerData.marker.setZIndexOffset(500);
      }
    }

    // Highlight the newly hovered marker
    if (hoveredJobId) {
      const markerData = markersRef.current.get(hoveredJobId);
      if (markerData) {
        markerData.marker.setIcon(markerData.highlightIcon);
        markerData.marker.setZIndexOffset(2000); // Bring to front
      }
    }

    previousHoveredIdRef.current = hoveredJobId;
  }, [hoveredJobId]);

  // Handle rep hover - dim all jobs not belonging to the hovered rep
  // IMPORTANT: Jobs should NEVER be removed from the map on hover - only visually dimmed
  useEffect(() => {
    if (previousHoveredRepIdRef.current === hoveredRepId) return;

    // Get the rep name for the hovered rep ID
    const hoveredRepName = hoveredRepId ? repIdToNameMap.get(hoveredRepId) : null;

    markersRef.current.forEach((markerData, jobId) => {
      const jobRepName = jobRepNameMapRef.current.get(jobId);

      if (hoveredRepId && hoveredRepName) {
        // A rep is being hovered - dim markers not belonging to that rep
        const belongsToRep = jobRepName === hoveredRepName;

        if (!belongsToRep) {
          // Apply grayscale + reduced opacity via icon update for non-matching markers
          // Use baseIcon HTML to avoid nesting wrapper divs on repeated hovers
          const baseIconHtml = markerData.baseIcon?.options?.html || '';
          const baseIconOptions = markerData.baseIcon?.options || {};
          const dimmedHtml = `<div style="filter: grayscale(100%); opacity: 0.5;">${baseIconHtml}</div>`;
          const dimmedIcon = L.divIcon({
            ...baseIconOptions,
            html: dimmedHtml,
            className: 'dimmed-marker',
          });
          markerData.marker.setIcon(dimmedIcon);
          markerData.marker.setZIndexOffset(0); // Send dimmed markers to back
        } else {
          // Restore the base icon for markers that belong to the hovered rep
          markerData.marker.setIcon(markerData.baseIcon);
          markerData.marker.setZIndexOffset(500); // Normal z-index for matching markers
        }
      } else {
        // No rep is hovered - restore all markers to normal
        markerData.marker.setIcon(markerData.baseIcon);
        // Restore original z-index (we don't track it, so use default of 500)
        markerData.marker.setZIndexOffset(500);
      }
    });

    previousHoveredRepIdRef.current = hoveredRepId;
  }, [hoveredRepId, repIdToNameMap]);

  useEffect(() => {
    if (!mapRef.current || !featureGroupRef.current) return;

    if (preloadedRouteInfo !== undefined) {
      setMappableJobs(jobs);
      setInternalRouteInfo(null);
      setError(null);
      return;
    }

    if (featureGroupRef.current) featureGroupRef.current.clearLayers();
    if (jobs.length === 0) {
      setIsLoading(false);
      setError(null);
      setInternalRouteInfo(null);
      setMappableJobs([]);
      if (mapRef.current) mapRef.current.setView(PHOENIX_COORDS, DEFAULT_ZOOM);
      return;
    }

    const fetchAndSetRoute = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const coordsWithNulls = await geocodeAddresses(addresses);
        if (!mapRef.current) return;

        const newMappableJobs: DisplayJob[] = [];
        const validCoords: Coordinates[] = [];
        jobs.forEach((job, index) => {
          const result = coordsWithNulls[index];
          if (result?.coordinates) {
            newMappableJobs.push(job);
            validCoords.push(result.coordinates);
          }
        });

        setMappableJobs(newMappableJobs);

        if (validCoords.length === 0) {
          throw new Error('Could not find locations for any of the provided addresses.');
        }

        if (validCoords.length < addresses.length) {
          setError(`Warning: Could only locate ${validCoords.length} of ${addresses.length} addresses.`);
        }

        const route = await fetchRoute(validCoords);
        setInternalRouteInfo(route);

      } catch (e: any) {
        console.error("Geocoding/Routing failed:", e);
        let message = "An unknown error occurred while fetching location data.";
        if (e instanceof Error) {
          message = e.message;
        } else if (typeof e === 'string') {
          message = e;
        }
        setError(message);
        setInternalRouteInfo(null);
        setMappableJobs([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAndSetRoute();

  }, [addresses, preloadedRouteInfo, jobs]);

  useEffect(() => {
    if (!mapRef.current || !featureGroupRef.current) return;

    const map = mapRef.current;
    const jobsToDisplay = preloadedRouteInfo !== undefined ? jobs : mappableJobs;
    const coordsToDisplay = effectiveRouteInfo?.coordinates;

    // Calculate identity BEFORE clearing markers to prevent unnecessary rebuilds
    const currentJobsId = jobsToDisplay.map(j => j.id).sort().join(',');
    const currentRouteId = effectiveRouteInfo?.geometry
      ? JSON.stringify(effectiveRouteInfo.geometry).length
      : (effectiveRouteInfo?.coordinates?.length || '0');
    // Include dimmed state in identity so filter changes trigger marker rebuild
    const dimmedJobsId = jobsToDisplay.filter(j => j.isDimmed).map(j => j.id).sort().join(',');
    const currentIdentity = `${mapType}-${currentJobsId}-${currentRouteId}-${dimmedJobsId}`;

    // Skip rebuild if nothing meaningful changed (preserves hover highlighting)
    if (currentIdentity === dataIdentityRef.current) {
      return;
    }
    dataIdentityRef.current = currentIdentity;

    featureGroupRef.current.clearLayers();
    markersRef.current.clear();
    jobRepNameMapRef.current.clear();

    // Clear old React roots when creating new markers (deferred to avoid render cycle issues)
    const oldRoots = [...popupRootsRef.current];
    popupRootsRef.current = [];
    if (oldRoots.length > 0) {
      setTimeout(() => {
        oldRoots.forEach(root => {
          try { root.unmount(); } catch (e) { }
        });
      }, 0);
    }

    if (coordsToDisplay && coordsToDisplay.length > 0 && jobsToDisplay.length === coordsToDisplay.length) {

      const uniqueRepNames: string[] = Array.from(new Set<string>(
        jobsToDisplay.map(j => j.assignedRepName).filter((name): name is string => !!name)
      )).sort();

      const repColorMap = new Map<string, string>();
      const goldenRatioConjugate = 0.61803398875;
      let hue = 0.1;

      uniqueRepNames.forEach((repName: string) => {
        hue += goldenRatioConjugate;
        hue %= 1;
        const color = `hsl(${hue * 360}, 75%, 45%)`;
        repColorMap.set(repName, color);
      });

      const getColorForRep = (repName?: string): string => {
        if (!repName) return '#808080';
        return repColorMap.get(repName) || '#808080';
      };

      coordsToDisplay.forEach((coord: Coordinates, index: number) => {
        const job = jobsToDisplay[index];
        if (!job) return;

        let markerHtml: string;
        let iconSize: [number, number];
        let iconAnchor: [number, number];
        const color = getColorForRep(job.assignedRepName);
        const isPriority = job.notes.includes('#');

        const dimFilter = job.isDimmed ? 'filter: grayscale(100%); opacity: 0.4;' : '';
        const dimZIndex = job.isDimmed ? 0 : (isPriority ? 1000 : 500);
        const finalZIndex = job.isRepHome ? 900 : dimZIndex;

        const shadow = (isPriority && !job.isDimmed)
          ? 'box-shadow: 0 0 0 2px #FFD700, 0 0 10px #FFD700, 0 4px 6px rgba(0,0,0,0.3);'
          : (!job.isDimmed ? 'box-shadow: 0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3);' : 'box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1);');

        const border = isPriority
          ? 'border: 2px solid #FFF;'
          : 'border: 2px solid white;';

        if (job.isRepHome) {
          markerHtml = `
                    <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; ${dimFilter}">
                        <svg viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3)); width: 100%; height: 100%;">
                            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                        </svg>
                    </div>`;
          iconSize = [24, 24];
          iconAnchor = [12, 20];
        } else if (job.isStartLocation) {
          markerHtml = `
                    <div style="background-color: ${color}; ${border} ${shadow} ${dimFilter}" class="text-white w-7 h-7 rounded-md flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                        </svg>
                    </div>`;
          iconSize = [28, 28];
          iconAnchor = [14, 14];
        } else if (job.isEstimatedLocation) {
          markerHtml = `<div style="width: 16px; height: 16px; background-color: ${color}; border-radius: 50%; border: 2px dashed white; ${shadow} ${dimFilter}"></div>`;
          iconSize = [20, 20];
          iconAnchor = [10, 10];
        } else if (mapType === 'unassigned') {
          markerHtml = `<div style="width: 14px; height: 14px; background-color: ${color}; border-radius: 50%; ${border} ${shadow} ${dimFilter}"></div>`;
          iconSize = [18, 18];
          iconAnchor = [9, 9];
        } else {
          markerHtml = `<div style="background-color: ${color}; ${border} ${shadow} ${dimFilter}" class="text-white w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs">${job.markerLabel || index + 1}</div>`;
          iconSize = [28, 28];
          iconAnchor = [14, 14];
        }

        const icon = L.divIcon({
          html: markerHtml,
          className: '',
          iconSize,
          iconAnchor,
        });

        // Create highlighted version of the icon (larger with glow)
        const highlightScale = 1.5;
        const highlightSize: [number, number] = [Math.round(iconSize[0] * highlightScale), Math.round(iconSize[1] * highlightScale)];
        const highlightAnchor: [number, number] = [Math.round(iconAnchor[0] * highlightScale), Math.round(iconAnchor[1] * highlightScale)];
        const highlightHtml = `<div style="transform: scale(${highlightScale}); transform-origin: center; filter: drop-shadow(0 0 8px ${color}) drop-shadow(0 0 16px ${color}); z-index: 9999;">${markerHtml}</div>`;

        const highlightIcon = L.divIcon({
          html: highlightHtml,
          className: 'highlighted-marker',
          iconSize: highlightSize,
          iconAnchor: highlightAnchor,
        });

        const marker = L.marker([coord.lat, coord.lon], { icon, zIndexOffset: finalZIndex })
          .addTo(featureGroupRef.current);

        // Store marker with both icons for hover highlighting
        markersRef.current.set(job.id, { marker, baseIcon: icon, highlightIcon });
        // Store job's assigned rep name for rep hover filtering
        jobRepNameMapRef.current.set(job.id, job.assignedRepName);

        const notesLower = (job.notes || '').toLowerCase();
        const tagsList: string[] = [];

        TAG_KEYWORDS.forEach((keyword: string) => {
          if (new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower)) {
            tagsList.push(keyword);
          }
        });

        const storiesMatch = job.notes.match(/\b(\d)S\b/i);
        if (storiesMatch) tagsList.push(`${storiesMatch[1]} Story`);

        const sqftMatch = job.notes.match(/\b(\d+)\s*sq\.?\b/i);
        if (sqftMatch) tagsList.push(`${sqftMatch[1]} sqft`);

        const ageMatch = job.notes.match(/\b(\d+)\s*yrs\b/i);
        if (ageMatch) tagsList.push(`${ageMatch[1]}yrs`);

        const tagsString = tagsList.join(', ');

        const timeLabel = (job.timeSlotLabel as string) || 'Unscheduled';

        // Show score badge if available
        const scoreHtml = job.assignmentScore ? `
          <div style="margin-top: 4px; font-weight: bold; font-size: 10px; color: rgb(var(--text-tertiary));">
            Score: <span style="color: rgb(var(--amber-text));">${job.assignmentScore}</span>
          </div>
        ` : '';

        let toolTipContent = '';
        if (job.isRepHome) {
          toolTipContent = `
                    <div style="text-align: center; line-height: 1.3; min-width: 120px; color: rgb(var(--text-primary));">
                        <div style="font-weight: bold; font-size: 11px; color: rgb(var(--text-tertiary)); text-transform: uppercase; margin-bottom: 2px;">Home Base</div>
                        <div style="font-weight: 800; font-size: 13px; color: rgb(var(--text-primary)); margin-bottom: 1px;">${job.zipCode}</div>
                        ${job.assignedRepName ? `
                        <div style="font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 3px; background-color: rgb(var(--brand-bg-light)); color: rgb(var(--brand-text-light)); padding: 2px 6px; border-radius: 4px; display: inline-flex; margin-top: 2px;">
                            ${job.assignedRepName}
                        </div>` : ''}
                    </div>
                  `;
        } else {
          toolTipContent = `
                    <div style="text-align: center; line-height: 1.3; min-width: 120px; color: rgb(var(--text-primary));">
                        <div style="font-weight: bold; font-size: 11px; color: rgb(var(--text-tertiary)); text-transform: uppercase; margin-bottom: 2px;">${timeLabel}</div>
                        <div style="font-weight: 800; font-size: 13px; margin-bottom: 1px;">${job.customerName}</div>
                        <div style="font-size: 10px; color: rgb(var(--text-secondary)); margin-bottom: 4px;">${job.address}</div>
                        
                        ${tagsString ? `
                        <div style="margin-bottom: 4px;">
                            <span style="display: inline-block; background-color: rgb(var(--bg-tertiary)); color: rgb(var(--text-secondary)); border: 1px solid rgb(var(--border-primary)); padding: 2px 6px; border-radius: 12px; font-size: 9px; font-weight: 600;">
                                ${tagsString}
                            </span>
                        </div>` : ''}
                        
                        ${job.assignedRepName ? `
                        <div style="font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 3px; background-color: rgb(var(--brand-bg-light)); color: rgb(var(--brand-text-light)); padding: 2px 6px; border-radius: 4px; display: inline-flex;">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width: 10px; height: 10px;"><path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" /></svg>
                            ${job.assignedRepName}
                        </div>` : ''}

                        ${isPriority ? '<div style="color: rgb(var(--amber-text)); font-weight: bold; font-size: 10px; margin-top: 4px;">★ Priority Job</div>' : ''}

                        ${scoreHtml}
                    </div>
                  `;
        }

        marker.bindTooltip(toolTipContent, {
          direction: 'top',
          offset: [0, -10],
          opacity: job.isDimmed ? 0.5 : 1,
          className: 'job-tooltip',
          sticky: false
        });

        // Prepare for React content inside popup
        const popupContainer = document.createElement('div');
        const root = ReactDOM.createRoot(popupContainer);
        popupRootsRef.current.push(root); // Track root for cleanup

        marker.bindPopup(popupContainer, { minWidth: 420, className: 'job-card-popup' });

        marker.on('popupopen', () => {
          const popupContentNode = marker.getPopup()?.getContent();
          if (popupContentNode instanceof HTMLElement) {
            L.DomEvent.disableClickPropagation(popupContentNode);
            L.DomEvent.disableScrollPropagation(popupContentNode);
          }

          // Use the latest context value from ref to bridge the gap
          const currentContext = contextValueRef.current;

          root.render(
            <React.StrictMode>
              <AppContext.Provider value={currentContext}>
                <div className="popup-surface w-[420px] overflow-hidden">
                  <JobCard
                    job={job}
                    onUnassign={job.assignedRepName ? currentContext.handleUnassignJob : undefined}
                    onUpdateJob={currentContext.handleUpdateJob}
                    onRemove={currentContext.handleRemoveJob}
                    isDraggable={true}
                    onDragStart={currentContext.setDraggedJob}
                    onDragEnd={currentContext.handleJobDragEnd}
                  />
                </div>
              </AppContext.Provider>
            </React.StrictMode>
          );
        });

        // NOTE: We do NOT unmount on popupclose anymore to prevent React #409 error
        // roots are unmounted when the parent map/markers are destroyed in useEffect cleanup.
      });

      if (mapType === 'route' && effectiveRouteInfo?.geometry) {
        L.geoJSON(effectiveRouteInfo.geometry, {
          style: () => ({ color: '#6366f1', weight: 5, opacity: 0.6, lineCap: 'round' })
        }).addTo(featureGroupRef.current);
      } else if (mapType === 'route' && coordsToDisplay.length > 1) {
        const latLngs = coordsToDisplay.map(coord => [coord.lat, coord.lon]);
        L.polyline(latLngs, { color: '#6366f1', weight: 4, opacity: 0.5, dashArray: '6, 8' }).addTo(featureGroupRef.current);
      }

      if (dataIdentityRef.current !== currentIdentity) {
        if (featureGroupRef.current.getLayers().length > 0) {
          map.fitBounds(featureGroupRef.current.getBounds().pad(0.1));
        } else if (coordsToDisplay.length === 1) {
          map.setView([coordsToDisplay[0].lat, coordsToDisplay[0].lon], ROUTE_ZOOM);
        }
        dataIdentityRef.current = currentIdentity;
      }

    } else {
      if (dataIdentityRef.current !== currentIdentity) {
        map.setView(PHOENIX_COORDS, DEFAULT_ZOOM);
        dataIdentityRef.current = currentIdentity;
      }
    }

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100);

    return () => clearTimeout(timer);

  }, [effectiveRouteInfo, jobs, mapType, mappableJobs, preloadedRouteInfo]);
  // Note: Removed handlers and hoveredJobId from dependency array - hoveredJobId causes full rebuild which creates stutter

  return (
    <div className="w-full h-full relative rounded-lg overflow-hidden bg-bg-tertiary">
      {isLoading && (
        <div className="absolute inset-0 bg-bg-primary/80 flex flex-col items-center justify-center z-20">
          <LoadingIcon />
          <span className="mt-2 text-text-primary">Generating route map...</span>
        </div>
      )}
      {isPlacementMode && (
        <div className="absolute top-2 left-2 right-2 bg-brand-primary/90 border border-brand-primary text-white text-sm text-center font-semibold p-3 rounded-md shadow-lg z-20 flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
          </svg>
          <span>Click anywhere on the map to place this job marker</span>
          <button
            onClick={() => contextValue.setPlacementJobId(null)}
            className="ml-2 px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-bold"
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <div className="absolute top-2 left-2 right-2 bg-tag-amber-bg/90 border border-tag-amber-border text-tag-amber-text text-xs text-center font-semibold p-2 rounded-md shadow-lg z-20">
          {error}
        </div>
      )}
      <div ref={mapContainerRef} className="w-full h-full z-10" />
    </div>
  );
};

export default LeafletMap;