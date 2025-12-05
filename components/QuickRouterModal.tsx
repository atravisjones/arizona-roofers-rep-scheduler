import React, { useState, useMemo } from 'react';
import LeafletMap from './LeafletMap';
import { DisplayJob } from '../types';

interface QuickRouterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const QuickRouterModal: React.FC<QuickRouterModalProps> = ({ isOpen, onClose }) => {
  const [pastedText, setPastedText] = useState('');
  const [addresses, setAddresses] = useState<string[]>([]);

  const handleParse = () => {
    const cleanedText = pastedText
      .replace(/\b\d{1,2}(:\d{2})?(am|pm)?\s*-\s*\d{1,2}(:\d{2})?(am|pm)?\b/gi, '')
      .replace(/\b(Tile|Flat|Job)\b/gi, '');

    const splitters = /[\n;|\/]/;
    const lines = cleanedText.split(splitters);

    const uniqueAddresses = Array.from(
      new Set(
        lines
          .map(line => line.trim())
          .filter(line => line.length > 5)
      )
    );
    setAddresses(uniqueAddresses);
  };

  const jobsForMap = useMemo((): DisplayJob[] => 
    addresses.map((addr, i) => ({
      id: `qr-job-${i}`,
      customerName: `Stop ${i + 1}`,
      address: addr,
      notes: ''
    })), [addresses]);
  
  // URL generation is kept for the "Open in Google Maps" buttons as a fallback/alternative
  const googleMapsUrl = useMemo(() => {
    if (addresses.length === 0) return '#';

    if (addresses.length === 1) {
      const query = encodeURIComponent(addresses[0]);
      return `https://www.google.com/maps/search/?api=1&query=${query}`;
    }

    const origin = encodeURIComponent(addresses[0]);
    const destination = encodeURIComponent(addresses[addresses.length - 1]);
    const waypoints = addresses
      .slice(1, -1)
      .slice(0, 20)
      .map(addr => encodeURIComponent(addr))
      .join('|');

    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving&waypoints=${waypoints}`;
  }, [addresses]);


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="popup-surface w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
        <header className="p-4 border-b border-border-primary flex justify-between items-center">
          <h2 className="text-2xl font-bold text-text-primary">Quick Router</h2>
          <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary text-3xl leading-none">&times;</button>
        </header>

        <div className="flex-grow p-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
          <div className="flex flex-col space-y-4">
            <div>
              <label htmlFor="address-paste" className="block text-sm font-medium text-text-secondary mb-1">
                Paste Schedule or Addresses
              </label>
              <textarea
                id="address-paste"
                rows={10}
                className="w-full p-2 border border-primary rounded-md shadow-sm focus:ring-2 focus:ring-brand-primary focus:outline-none transition bg-secondary text-primary placeholder:text-secondary hover:bg-tertiary"
                placeholder="Paste any text with addresses here..."
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
              />
            </div>
            <div className="flex space-x-2">
                <button
                onClick={handleParse}
                className="flex-grow bg-brand-primary text-brand-text-on-primary py-2 px-4 rounded-md hover:bg-brand-secondary transition"
                >
                Generate Route Preview
                </button>
                <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="flex-grow text-center bg-brand-blue text-brand-text-on-primary py-2 px-4 rounded-md hover:bg-brand-blue-dark transition">
                      Open in Google Maps
                </a>
            </div>
            
            {addresses.length > 0 && (
              <div className="p-3 bg-secondary rounded-lg border border-border-primary flex-grow overflow-y-auto">
                <h3 className="font-semibold mb-2 text-text-primary">{addresses.length} unique addresses found:</h3>
                <ul className="list-disc list-inside text-sm space-y-1 text-text-secondary">
                  {addresses.map((addr, i) => <li key={i}>{addr}</li>)}
                </ul>
              </div>
            )}
            
          </div>

          <div className="bg-tertiary rounded-lg flex flex-col items-center justify-center p-1">
             {jobsForMap.length > 0 ? (
                <LeafletMap jobs={jobsForMap} key={addresses.join('-')} mapType="route" />
             ) : (
                <div className="text-center text-text-tertiary">
                    <p>Address preview will appear here.</p>
                </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickRouterModal;