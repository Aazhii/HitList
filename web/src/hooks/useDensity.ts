/**
 * The density preference (P5.5): how tall rows and cards are. Compact trims 2px of padding from each
 * side of a row, Roomy adds 4px; Standard is the prototype. It is one CSS variable on <html>, which
 * the row-shaped surfaces add to their own padding — nothing re-renders when it changes.
 */
import { useCallback, useEffect, useState } from 'react';

export type Density = 'compact' | 'standard' | 'roomy';
export const DENSITIES: ReadonlyArray<{ id: Density; label: string }> = [
  { id: 'compact', label: 'Compact' },
  { id: 'standard', label: 'Standard' },
  { id: 'roomy', label: 'Roomy' },
];

const KEY = 'hitlist-density';

export function readDensity(): Density {
  try {
    const v = localStorage.getItem(KEY);
    return DENSITIES.some((d) => d.id === v) ? (v as Density) : 'standard';
  } catch { return 'standard'; }
}

export function applyDensity(density: Density): void {
  document.documentElement.dataset.density = density;
}

export function useDensity(): [Density, (next: Density) => void] {
  const [density, setDensity] = useState<Density>(readDensity);
  useEffect(() => { applyDensity(density); }, [density]);
  const set = useCallback((next: Density) => {
    setDensity(next);
    try { localStorage.setItem(KEY, next); } catch { /* applied for this visit only */ }
  }, []);
  return [density, set];
}
