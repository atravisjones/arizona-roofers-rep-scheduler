// Section colours lifted from the SRA sheet's banner rows so the board reads
// like the sheet: PHOENIX peach, NORTH blue, TUCSON red, COMMERCIAL/INSURANCE
// charcoal, MANAGEMENT maroon, D2D pale peach.
export interface SectionTheme {
  band: string; // banner fill
  bandText: string; // banner text
  wash: string; // light tint for the rep-name column
}

const DARK = '#ffffff';
const INK = '#111111';

export const SECTION_THEMES: Record<string, SectionTheme> = {
  PHX: { band: '#f9cb9b', bandText: INK, wash: 'rgba(249, 203, 155, 0.35)' },
  NORTH: { band: '#a4c1f4', bandText: INK, wash: 'rgba(164, 193, 244, 0.35)' },
  SOUTH: { band: '#ea9999', bandText: INK, wash: 'rgba(234, 153, 153, 0.35)' },
  COMMERCIAL: { band: '#424242', bandText: DARK, wash: 'rgba(66, 66, 66, 0.16)' },
  INSURANCE: { band: '#424242', bandText: DARK, wash: 'rgba(66, 66, 66, 0.16)' },
  MANAGEMENT: { band: '#731b47', bandText: DARK, wash: 'rgba(115, 27, 71, 0.16)' },
  D2D: { band: '#fce4cd', bandText: INK, wash: 'rgba(252, 228, 205, 0.45)' },
};

const FALLBACK: SectionTheme = { band: '#d9d9d9', bandText: INK, wash: 'rgba(217, 217, 217, 0.4)' };

export const getSectionTheme = (section: string): SectionTheme =>
  SECTION_THEMES[section] || FALLBACK;
