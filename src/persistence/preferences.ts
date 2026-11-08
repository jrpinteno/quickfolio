import { KEYS, readText, writeText, type Key } from './storage';

/** Choices remembered across visits, as stored; callers validate them against the options that exist today. */
export interface Preferences {
   range?: string;
   reporting?: string;
   focus?: string;
   theme?: string;
   layout?: string;
   hideAmounts: boolean;
   pageSize?: number;
   tax?: string;
}

export function loadPreferences(): Preferences {
   const text = (key: Key) => readText(key) ?? undefined;

   return {
      range: text(KEYS.range),
      reporting: text(KEYS.reporting),
      focus: text(KEYS.focus),
      theme: text(KEYS.theme),
      layout: text(KEYS.layout),
      hideAmounts: readText(KEYS.hideAmounts) === '1',
      pageSize: Number(text(KEYS.pageSize)) || undefined,
      tax: text(KEYS.tax),
   };
}

/**
 * Writes the preferences that differ from `previous`, so untouched choices
 * are never stored. Preferences are conveniences: one that can't be written
 * (storage full) is skipped rather than interrupting anything.
 */
export function savePreferences(next: Partial<Preferences>, previous: Partial<Preferences>): void {
   const write = (key: Key, value: string | undefined) => {
      try {
         writeText(key, value);
      } catch {
         // Remembered for this visit only.
      }
   };

   if (next.range !== previous.range) {
      write(KEYS.range, next.range);
   }

   if (next.reporting !== previous.reporting) {
      write(KEYS.reporting, next.reporting);
   }

   if (next.focus !== previous.focus) {
      write(KEYS.focus, next.focus);
   }

   if (next.theme !== previous.theme) {
      write(KEYS.theme, next.theme);
   }

   if (next.layout !== previous.layout) {
      write(KEYS.layout, next.layout);
   }

   if (next.hideAmounts !== previous.hideAmounts) {
      write(KEYS.hideAmounts, next.hideAmounts ? '1' : '0');
   }

   if (next.pageSize !== previous.pageSize) {
      write(KEYS.pageSize, next.pageSize === undefined ? undefined : String(next.pageSize));
   }

   if (next.tax !== previous.tax) {
      write(KEYS.tax, next.tax);
   }
}
