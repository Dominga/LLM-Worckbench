import { createTheme, MantineColorsTuple } from '@mantine/core';

// V5 Loom palette — single source of truth for all shell components.
// Mirrors the `V5` const in Design/llm-workshop/project/v5-loom.jsx so the
// implementation stays visually aligned with the mockup.
export const V5 = {
  bg:        '#1e1f22',
  surface:   '#2b2d31',
  surface2:  '#232428',
  panel:     '#1a1b1e',
  border:    '#33353b',
  borderSoft:'#2a2c30',
  text:      '#dcddde',
  textMuted: '#8e9298',
  textDim:   '#5f6268',
  accent:    '#3b82f6',
  accentSoft:'rgba(59,130,246,.14)',
  ok:        '#22c55e',
  warn:      '#f59e0b',
  danger:    '#ef4444',
  chip:      '#373a40',
  code:      '#16171a',
  added:     'rgba(34,197,94,.14)',
  addedText: '#86efac',
} as const;

const brand: MantineColorsTuple = [
  '#e8f1ff',
  '#cfdfff',
  '#9ebcff',
  '#6c98ff',
  '#4179fd',
  '#2867fb',
  '#1e5ffb',
  '#1450e1',
  '#0746c9',
  '#003cb1',
];

export const v5Theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  defaultRadius: 'sm',
  fontFamily: 'ui-sans-serif, "Inter", "Segoe UI", system-ui, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "JetBrains Mono", monospace',
  fontSizes: {
    xs: '11px',
    sm: '12.5px',
    md: '13.5px',
    lg: '15px',
    xl: '17px',
  },
  lineHeights: { md: '1.5' },
  headings: { fontWeight: '600' },
});
