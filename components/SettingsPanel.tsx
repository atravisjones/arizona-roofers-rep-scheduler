import React from 'react';
import { useAppContext } from '../context/AppContext';
import { UiSettings } from '../types';
import { SunIcon, MoonIcon, DesktopIcon, PaletteIcon, EyeIcon, EyeOffIcon, ExternalLinkIcon } from './icons';

interface SettingsPanelProps {
    onOpenThemeEditor: () => void;
}

const SCHEDULING_TOOL_LINKS = [
    { name: 'Rep Availability', url: 'https://docs.google.com/spreadsheets/d/1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g/edit?gid=1834112592#gid=1834112592' },
    { name: 'Rep Skillsets', url: 'https://docs.google.com/spreadsheets/d/1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g/edit?gid=28876067#gid=28876067' },
    { name: 'Rep Cloud Storage', url: 'https://docs.google.com/spreadsheets/d/1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk/edit?gid=0#gid=0' },
    { name: 'Sales Tracker', url: 'https://docs.google.com/spreadsheets/d/1dwmWmMtXer4yOlY1QacqepCyQSe_5D84rzrLXYO2vTE/edit?gid=712107442#gid=712107442' },
    { name: 'Roofr Export', url: 'https://docs.google.com/spreadsheets/d/1KadSyM67SOB6agq2YDHkZLYMXnn81Fna5jTWDBQQuog/edit?gid=2137549421#gid=2137549421' },
];

const ThemeButton: React.FC<{
    theme: UiSettings['theme'];
    currentTheme: UiSettings['theme'];
    label: string;
    icon: React.ReactNode;
    onClick: (theme: UiSettings['theme']) => void;
}> = ({ theme, currentTheme, label, icon, onClick }) => (
    <button
        onClick={() => onClick(theme)}
        className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors w-full text-xs font-semibold ${currentTheme === theme
            ? 'bg-brand-bg-light text-brand-text-light ring-2 ring-brand-primary'
            : 'bg-bg-tertiary text-text-secondary hover:bg-bg-quaternary'
            }`}
    >
        {icon}
        <span>{label}</span>
    </button>
);

const ToggleSwitch: React.FC<{
    label: string;
    description: string;
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    icon: React.ReactNode;
}> = ({ label, description, enabled, onChange, icon }) => (
    <div
        onClick={() => onChange(!enabled)}
        className="flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-bg-secondary transition-colors"
    >
        <div className="flex items-center gap-3">
            {icon}
            <div>
                <p className="text-sm font-medium text-text-primary">{label}</p>
                <p className="text-xs text-text-tertiary">{description}</p>
            </div>
        </div>
        <div className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${enabled ? 'bg-brand-primary' : 'bg-bg-quaternary'}`}>
            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </div>
    </div>
);

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onOpenThemeEditor }) => {
    const { uiSettings, updateUiSettings } = useAppContext();

    const handleThemeChange = (theme: UiSettings['theme']) => {
        updateUiSettings({ theme });
    };

    const handleToggleChange = (key: keyof UiSettings, value: boolean) => {
        updateUiSettings({ [key]: value });
    };

    return (
        <div className="popup-surface absolute top-full right-0 mt-2 w-80 z-50 animate-fade-in overflow-hidden">
            <div className="p-4">
                <h3 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-3 flex items-center gap-1.5"><PaletteIcon className="h-4 w-4" /> Theme</h3>
                <div className="grid grid-cols-2 gap-2">
                    <ThemeButton theme="light" currentTheme={uiSettings.theme} label="Light" icon={<SunIcon />} onClick={handleThemeChange} />
                    <ThemeButton theme="dark" currentTheme={uiSettings.theme} label="Dark" icon={<MoonIcon />} onClick={handleThemeChange} />
                    <ThemeButton theme="midnight" currentTheme={uiSettings.theme} label="Midnight" icon={<div className="w-5 h-5 rounded-full bg-[#0f172a] border-2 border-[#334155]" />} onClick={handleThemeChange} />
                    <ThemeButton theme="gruvbox" currentTheme={uiSettings.theme} label="Gruvbox" icon={<div className="w-5 h-5 rounded-full bg-[#fbf1c7] border-2 border-[#928374]" />} onClick={handleThemeChange} />
                    {uiSettings.customTheme && (
                        <ThemeButton theme="custom" currentTheme={uiSettings.theme} label="Custom" icon={<div className="w-5 h-5 rounded-full bg-gradient-to-br from-brand-primary to-tag-amber-bg" />} onClick={handleThemeChange} />
                    )}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                    <ThemeButton theme="system" currentTheme={uiSettings.theme} label="System" icon={<DesktopIcon />} onClick={handleThemeChange} />
                    <button
                        onClick={onOpenThemeEditor}
                        className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors w-full text-xs font-semibold bg-bg-tertiary text-text-secondary hover:bg-bg-quaternary"
                    >
                        <PaletteIcon />
                        <span>Customize</span>
                    </button>
                </div>
            </div>
            <div className="border-t border-border-primary p-2">
                <h3 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-1 px-2">Display Options</h3>
                <div className="space-y-0">
                    <ToggleSwitch
                        label="Unplotted Jobs"
                        description="Show the unplottable jobs section."
                        enabled={uiSettings.showUnplottedJobs}
                        onChange={(val) => handleToggleChange('showUnplottedJobs', val)}
                        icon={uiSettings.showUnplottedJobs ? <EyeIcon className="h-5 w-5 text-text-tertiary" /> : <EyeOffIcon className="h-5 w-5 text-text-quaternary" />}
                    />
                    <ToggleSwitch
                        label="Unassigned Column"
                        description="Show the 'Unassigned' column."
                        enabled={uiSettings.showUnassignedJobsColumn}
                        onChange={(val) => handleToggleChange('showUnassignedJobsColumn', val)}
                        icon={uiSettings.showUnassignedJobsColumn ? <EyeIcon className="h-5 w-5 text-text-tertiary" /> : <EyeOffIcon className="h-5 w-5 text-text-quaternary" />}
                    />
                </div>
            </div>
            <div className="border-t border-border-primary p-3">
                <h3 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <ExternalLinkIcon className="h-4 w-4" /> Scheduling Tools
                </h3>
                <div className="space-y-1">
                    {SCHEDULING_TOOL_LINKS.map((link) => (
                        <a
                            key={link.name}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-secondary transition-colors text-sm text-text-secondary hover:text-text-primary group"
                        >
                            <ExternalLinkIcon className="h-4 w-4 text-text-quaternary group-hover:text-brand-primary transition-colors" />
                            <span>{link.name}</span>
                        </a>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default SettingsPanel;
