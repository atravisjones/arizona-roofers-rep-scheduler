export interface HolidayTheme {
  bg: string;
  border: string;
  text: string;
  stripe: string;
}

const GOLD: HolidayTheme = {
  bg: 'rgba(180, 135, 35, 0.18)',
  border: 'rgb(180, 135, 35)',
  text: 'rgb(133, 95, 20)',
  stripe: 'rgb(180, 135, 35)',
};

export const HOLIDAY_THEMES: Record<string, HolidayTheme> = {
  "New Year's Day": GOLD,
  "New Year's Eve": GOLD,
  'MLK Day': {
    bg: 'rgba(30, 64, 175, 0.18)',
    border: 'rgb(30, 64, 175)',
    text: 'rgb(29, 58, 145)',
    stripe: 'rgb(30, 64, 175)',
  },
  'Presidents Day': {
    bg: 'rgba(30, 58, 95, 0.16)',
    border: 'rgb(30, 58, 95)',
    text: 'rgb(146, 54, 64)',
    stripe: 'rgb(146, 54, 64)',
  },
  'Memorial Day': {
    bg: 'rgba(185, 28, 28, 0.18)',
    border: 'rgb(30, 58, 95)',
    text: 'rgb(153, 27, 27)',
    stripe: 'rgb(30, 58, 95)',
  },
  Juneteenth: {
    bg: 'rgba(185, 28, 28, 0.18)',
    border: 'rgb(22, 101, 52)',
    text: 'rgb(22, 101, 52)',
    stripe: 'rgb(22, 101, 52)',
  },
  'Independence Day': {
    bg: 'rgba(30, 58, 95, 0.16)',
    border: 'rgb(185, 28, 28)',
    text: 'rgb(153, 27, 27)',
    stripe: 'rgb(185, 28, 28)',
  },
  'Labor Day': {
    bg: 'rgba(194, 93, 14, 0.18)',
    border: 'rgb(194, 93, 14)',
    text: 'rgb(154, 66, 12)',
    stripe: 'rgb(194, 93, 14)',
  },
  'Columbus Day': {
    bg: 'rgba(13, 116, 128, 0.18)',
    border: 'rgb(13, 116, 128)',
    text: 'rgb(15, 91, 101)',
    stripe: 'rgb(13, 116, 128)',
  },
  'Veterans Day': {
    bg: 'rgba(30, 58, 95, 0.16)',
    border: 'rgb(180, 135, 35)',
    text: 'rgb(133, 95, 20)',
    stripe: 'rgb(180, 135, 35)',
  },
  Thanksgiving: {
    bg: 'rgba(194, 93, 14, 0.18)',
    border: 'rgb(120, 72, 40)',
    text: 'rgb(120, 72, 40)',
    stripe: 'rgb(194, 93, 14)',
  },
  'Christmas Eve': {
    bg: 'rgba(185, 28, 28, 0.18)',
    border: 'rgb(22, 101, 52)',
    text: 'rgb(22, 101, 52)',
    stripe: 'rgb(185, 28, 28)',
  },
  Christmas: {
    bg: 'rgba(185, 28, 28, 0.18)',
    border: 'rgb(22, 101, 52)',
    text: 'rgb(22, 101, 52)',
    stripe: 'rgb(185, 28, 28)',
  },
};

const SLATE: HolidayTheme = {
  bg: 'rgba(71, 85, 105, 0.18)',
  border: 'rgb(71, 85, 105)',
  text: 'rgb(71, 85, 105)',
  stripe: 'rgb(71, 85, 105)',
};

export const DEFAULT_HOLIDAY_THEME = SLATE;
export const HOLIDAY_GLYPH = 'H';

export const holidayThemes = HOLIDAY_THEMES;

export function getHolidayTheme(name?: string): HolidayTheme {
  return (name && HOLIDAY_THEMES[name]) || DEFAULT_HOLIDAY_THEME;
}
