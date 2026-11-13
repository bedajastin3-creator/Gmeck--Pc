import { ColorOption } from '../types';

export const SELLER_COLORS: ColorOption[] = [
  {
    id: 'blue',
    name: 'Cobalt Blue',
    primary: '#2563eb', // blue-600
    bgLight: '#eff6ff', // blue-50
    border: '#93c5fd', // blue-300
    hover: '#1d4ed8', // blue-700
    text: '#1e40af',
  },
  {
    id: 'purple',
    name: 'Royal Purple',
    primary: '#7c3aed', // violet-600
    bgLight: '#f5f3ff', // violet-50
    border: '#c4b5fd',
    hover: '#6d28d9',
    text: '#5b21b6',
  },
  {
    id: 'teal',
    name: 'Emerald Teal',
    primary: '#0d9488', // teal-600
    bgLight: '#f0fdfa', // teal-50
    border: '#99f6e4',
    hover: '#0f766e',
    text: '#115e59',
  },
  {
    id: 'green',
    name: 'Forest Green',
    primary: '#16a34a', // green-600
    bgLight: '#f0fdf4', // green-50
    border: '#86efac',
    hover: '#15803d',
    text: '#166534',
  },
  {
    id: 'orange',
    name: 'Amber Orange',
    primary: '#ea580c', // orange-600
    bgLight: '#fff7ed', // orange-50
    border: '#fdba74',
    hover: '#c2410c',
    text: '#9a3412',
  },
  {
    id: 'red',
    name: 'Ruby Crimson',
    primary: '#e11d48', // rose-600
    bgLight: '#fff1f2', // rose-50
    border: '#fca5a5',
    hover: '#be123c',
    text: '#9f1239',
  },
  {
    id: 'indigo',
    name: 'Deep Indigo',
    primary: '#4f46e5', // indigo-600
    bgLight: '#eef2ff', // indigo-50
    border: '#a5b4fc',
    hover: '#4338ca',
    text: '#3730a3',
  },
  {
    id: 'slate',
    name: 'Industrial Slate',
    primary: '#475569', // slate-600
    bgLight: '#f8fafc', // slate-50
    border: '#cbd5e1',
    hover: '#334155',
    text: '#1e293b',
  },
];

export function getColorOption(colorIdOrHex?: string): ColorOption {
  if (!colorIdOrHex) return SELLER_COLORS[0];
  const found = SELLER_COLORS.find(
    c => c.id === colorIdOrHex || c.primary.toLowerCase() === colorIdOrHex.toLowerCase()
  );
  return found || SELLER_COLORS[0];
}

export const getSellerColorById = (id?: string): ColorOption => getColorOption(id);
