// Shared control vocabulary — one segmented-control style and one control
// height (h-7 / 28px, rounded-md, hairline borders, 150ms color transitions)
// so every surface reads as the same system. See DESIGN.md.
export const SEG_WRAP = 'inline-flex items-center rounded-md border border-border-secondary bg-bg-primary p-0.5 gap-0.5';
export const SEG_BTN = 'inline-flex items-center gap-1.5 px-2.5 h-6 rounded text-[11px] font-semibold transition-colors duration-150';
export const SEG_ON = 'bg-brand-primary text-brand-text-on-primary';
export const SEG_OFF = 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary';

// Standalone toolbar button (non-grouped): pair with SEG-height for alignment.
export const CTRL_BTN = 'inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold rounded-md border border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary disabled:opacity-40 transition-colors duration-150';

// Micro-label above or beside a control group.
export const MICRO_LABEL = 'text-[10px] font-bold uppercase tracking-wider text-text-tertiary';
