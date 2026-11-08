// Every localStorage key the app uses. They locate data already saved in users' browsers:
// renaming one loses that data, so a format change gets a new key and a migration instead.
export const KEYS = {
   portfolio: 'quickfolio:portfolio:v1',
   /** A stored portfolio that failed validation, kept verbatim so starting empty never destroys it. */
   unreadablePortfolio: 'quickfolio:portfolio:v1:unreadable',
   market: 'quickfolio:market:v1',
   snapshots: 'quickfolio:snapshots:v1',
   range: 'quickfolio:range',
   reporting: 'quickfolio:reporting',
   focus: 'quickfolio:focus',
   theme: 'quickfolio:theme',
   layout: 'quickfolio:layout',
   hideAmounts: 'quickfolio:hide-amounts',
   pageSize: 'quickfolio:page-size',
   /** Which country's tax to estimate, if any. */
   tax: 'quickfolio:tax',
   /** When the trades and cash were last exported, and a fingerprint of them, for the backup reminder. */
   lastExport: 'quickfolio:last-export:v1',
   /** Set once the backup reminder is dismissed; it doesn't come back. */
   backupReminderDismissed: 'quickfolio:backup-reminder-dismissed:v1',
} as const;

export type Key = (typeof KEYS)[keyof typeof KEYS];

export const readText = (key: Key): string | null => localStorage.getItem(key);

export function writeText(key: Key, value: string | undefined): void {
   if (value === undefined) {
      localStorage.removeItem(key);
   } else {
      localStorage.setItem(key, value);
   }
}

/** The stored JSON, or undefined when it is missing or unreadable. */
export function readJson(key: Key): unknown {
   try {
      const raw = localStorage.getItem(key);

      return raw === null ? undefined : (JSON.parse(raw) as unknown);
   } catch {
      return undefined;
   }
}

/** Throws when the value exceeds the browser's storage quota. */
export const writeJson = (key: Key, value: unknown): void => localStorage.setItem(key, JSON.stringify(value));
