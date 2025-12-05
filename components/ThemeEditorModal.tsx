import React, { useState, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon, RefreshIcon, AutoAssignIcon } from './icons';

interface ThemeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Helpers to convert between hex and "R G B" string for CSS variables
const hexToRgbString = (hex: string): string | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}` : null;
};
const rgbStringToHex = (rgbString?: string): string => {
  if (!rgbString) return '#000000';
  const [r, g, b] = rgbString.split(' ').map(Number);
  const toHex = (c: number) => `0${c.toString(16)}`.slice(-2);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const ColorInput: React.FC<{ label: string; colorVar: string; value?: string; onChange: (v: string) => void }> = ({ label, colorVar, value, onChange }) => {
    const hexValue = rgbStringToHex(value);
    
    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rgb = hexToRgbString(e.target.value);
        if (rgb) {
            onChange(rgb);
        }
    };

    return (
        <div className="flex items-center justify-between p-2 rounded-md hover:bg-bg-tertiary">
            <label htmlFor={colorVar} className="text-xs font-medium text-text-secondary flex items-center gap-2">
                <div className="w-3 h-3 rounded-full border border-border-secondary" style={{ backgroundColor: hexValue }}></div>
                {label}
            </label>
            <input
                id={colorVar}
                type="color"
                value={hexValue}
                onChange={handleColorChange}
                className="w-8 h-6 p-0 border-none rounded cursor-pointer bg-transparent"
            />
        </div>
    );
};

const ALL_THEME_VARS = [
    // Base
    { group: 'Base', label: 'Primary BG', key: '--bg-primary' },
    { group: 'Base', label: 'Secondary BG', key: '--bg-secondary' },
    { group: 'Base', label: 'Tertiary BG', key: '--bg-tertiary' },
    { group: 'Base', label: 'Quaternary BG', key: '--bg-quaternary' },
    { group: 'Base', label: 'Primary Text', key: '--text-primary' },
    { group: 'Base', label: 'Secondary Text', key: '--text-secondary' },
    { group: 'Base', label: 'Tertiary Text', key: '--text-tertiary' },
    // Borders
    { group: 'Borders', label: 'Primary Border', key: '--border-primary' },
    { group: 'Borders', label: 'Secondary Border', key: '--border-secondary' },
    { group: 'Borders', label: 'Tertiary Border', key: '--border-tertiary' },
    // Brand
    { group: 'Brand', label: 'Primary Brand', key: '--brand-primary' },
    { group: 'Brand', label: 'Secondary Brand', key: '--brand-secondary' },
    { group: 'Brand', label: 'Text on Brand', key: '--brand-text-on-primary' },
    { group: 'Brand', label: 'Light BG', key: '--brand-bg-light' },
    { group: 'Brand', label: 'Light Text', key: '--brand-text-light' },
    // Tags
    ...['amber', 'red', 'green', 'blue', 'teal', 'orange', 'cyan', 'slate', 'purple', 'emerald', 'sky', 'stone'].flatMap(color => [
        { group: `Tag: ${color.charAt(0).toUpperCase() + color.slice(1)}`, label: 'Background', key: `--${color}-bg` },
        { group: `Tag: ${color.charAt(0).toUpperCase() + color.slice(1)}`, label: 'Text', key: `--${color}-text` },
        { group: `Tag: ${color.charAt(0).toUpperCase() + color.slice(1)}`, label: 'Border', key: `--${color}-border` },
    ])
];

const ThemeEditorModal: React.FC<ThemeEditorModalProps> = ({ isOpen, onClose }) => {
  const { uiSettings, updateCustomTheme, resetCustomTheme } = useAppContext();

  const handleColorChange = (key: string, value: string) => {
    updateCustomTheme({ [key]: value });
  };

  const handleRandomize = () => {
    const newTheme: Record<string, string> = {};
    const isLight = Math.random() > 0.5;
    const baseHue = Math.floor(Math.random() * 360);
    const baseSat = Math.random() * 0.2 + 0.05;

    const hslToRgbString = (h: number, s: number, l: number): string => {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`;
    };

    if (isLight) {
        newTheme['--bg-primary'] = hslToRgbString(baseHue / 360, baseSat, 1.0);
        newTheme['--bg-secondary'] = hslToRgbString(baseHue / 360, baseSat, 0.98);
        newTheme['--bg-tertiary'] = hslToRgbString(baseHue / 360, baseSat, 0.95);
        newTheme['--bg-quaternary'] = hslToRgbString(baseHue / 360, baseSat, 0.90);
        newTheme['--text-primary'] = hslToRgbString(baseHue / 360, baseSat * 1.2, 0.1);
        newTheme['--text-secondary'] = hslToRgbString(baseHue / 360, baseSat, 0.25);
        newTheme['--text-tertiary'] = hslToRgbString(baseHue / 360, baseSat, 0.4);
        newTheme['--border-primary'] = hslToRgbString(baseHue / 360, baseSat, 0.90);
        newTheme['--border-secondary'] = hslToRgbString(baseHue / 360, baseSat, 0.85);
    } else {
        newTheme['--bg-primary'] = hslToRgbString(baseHue / 360, baseSat, 0.1);
        newTheme['--bg-secondary'] = hslToRgbString(baseHue / 360, baseSat, 0.05);
        newTheme['--bg-tertiary'] = hslToRgbString(baseHue / 360, baseSat, 0.2);
        newTheme['--bg-quaternary'] = hslToRgbString(baseHue / 360, baseSat, 0.25);
        newTheme['--text-primary'] = hslToRgbString(baseHue / 360, baseSat, 0.98);
        newTheme['--text-secondary'] = hslToRgbString(baseHue / 360, baseSat, 0.85);
        newTheme['--text-tertiary'] = hslToRgbString(baseHue / 360, baseSat, 0.6);
        newTheme['--border-primary'] = hslToRgbString(baseHue / 360, baseSat, 0.2);
        newTheme['--border-secondary'] = hslToRgbString(baseHue / 360, baseSat, 0.25);
    }

    const brandHue = (baseHue + Math.floor(Math.random() * 60) + 150) % 360;
    const brandSat = Math.random() * 0.4 + 0.6;
    const brandLight = Math.random() * 0.2 + 0.5;
    newTheme['--brand-primary'] = hslToRgbString(brandHue / 360, brandSat, brandLight);
    newTheme['--brand-secondary'] = hslToRgbString(brandHue / 360, brandSat, brandLight - 0.1);
    newTheme['--brand-text-on-primary'] = brandLight > 0.55 ? newTheme['--bg-primary'] : newTheme['--text-primary'];

    if (isLight) {
        newTheme['--brand-bg-light'] = hslToRgbString(brandHue / 360, brandSat, 0.95);
        newTheme['--brand-text-light'] = hslToRgbString(brandHue / 360, brandSat, 0.4);
    } else {
        newTheme['--brand-bg-light'] = hslToRgbString(brandHue / 360, brandSat * 0.5, 0.2);
        newTheme['--brand-text-light'] = hslToRgbString(brandHue / 360, brandSat, 0.8);
    }

    const tagColors = ['amber', 'red', 'green', 'blue', 'teal', 'orange', 'cyan', 'slate', 'purple', 'emerald', 'sky', 'stone'];
    tagColors.forEach(color => {
        const hue = Math.floor(Math.random() * 360);
        const sat = Math.random() * 0.3 + 0.7;
        if (isLight) {
            newTheme[`--${color}-bg`] = hslToRgbString(hue / 360, sat, 0.95);
            newTheme[`--${color}-text`] = hslToRgbString(hue / 360, sat, 0.35);
            newTheme[`--${color}-border`] = hslToRgbString(hue / 360, sat, 0.85);
        } else {
            newTheme[`--${color}-bg`] = hslToRgbString(hue / 360, sat * 0.7, 0.2);
            newTheme[`--${color}-text`] = hslToRgbString(hue / 360, sat, 0.8);
            newTheme[`--${color}-border`] = hslToRgbString(hue / 360, sat * 0.8, 0.3);
        }
    });

    updateCustomTheme(newTheme);
  };


  const groupedVars = useMemo(() => {
    return ALL_THEME_VARS.reduce((acc, v) => {
        if (!acc[v.group]) acc[v.group] = [];
        acc[v.group].push(v);
        return acc;
    }, {} as Record<string, typeof ALL_THEME_VARS>);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={onClose}>
      <div className="popup-surface w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-border-primary flex justify-between items-center bg-bg-secondary">
          <div>
            <h2 className="text-xl font-bold text-text-primary">Theme Editor</h2>
            <p className="text-xs text-text-tertiary mt-0.5">Customize the application's appearance. Changes are saved automatically.</p>
          </div>
          <div className="flex items-center gap-3">
             <button
                onClick={handleRandomize}
                className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary text-brand-text-on-primary font-semibold rounded-lg hover:bg-brand-secondary transition-colors text-xs shadow-sm"
            >
                <AutoAssignIcon className="h-4 w-4" />
                Randomize
            </button>
             <button
                onClick={resetCustomTheme}
                className="flex items-center gap-2 px-3 py-1.5 bg-bg-primary border border-border-primary text-text-secondary font-semibold rounded-lg hover:bg-bg-tertiary transition-colors text-xs"
            >
                <RefreshIcon className="h-4 w-4" />
                Reset to Defaults
            </button>
            <button onClick={onClose} className="p-2 text-text-quaternary hover:text-text-secondary hover:bg-bg-tertiary rounded-full transition-colors">
              <XIcon className="h-6 w-6" />
            </button>
          </div>
        </header>
        <div className="flex-grow p-6 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.entries(groupedVars).map(([groupName, vars]) => (
                    <div key={groupName} className="bg-bg-secondary p-4 rounded-lg border border-border-primary">
                        <h3 className="text-sm font-bold text-text-primary mb-2 border-b border-border-secondary pb-2">{groupName}</h3>
                        <div className="space-y-1">
                            {vars.map(v => (
                                <ColorInput
                                    key={v.key}
                                    label={v.label}
                                    colorVar={v.key}
                                    value={uiSettings.customTheme?.[v.key]}
                                    onChange={(val) => handleColorChange(v.key, val)}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
      </div>
    </div>
  );
};

export default ThemeEditorModal;