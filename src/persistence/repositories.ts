import type { ExportMark } from '../backup/export';
import { parsePortfolio, parseSnapshots } from '../backup/schema';
import { isCurrencyCode, isIsoDate, isSymbol } from '../domain/codes';
import { message } from '../domain/errors';
import type { MarketData, Quote } from '../domain/market';
import type { Snapshot } from '../domain/snapshots';
import type { Portfolio } from '../domain/types';
import { KEYS, readJson, readText, writeJson, writeText } from './storage';

/** True when the write succeeded; false when it was refused, normally because storage is full. */
const attempt = (write: () => void): boolean => {
   try {
      write();

      return true;
   } catch {
      return false;
   }
};

/** Drops the market cache, which can always be fetched again, to make room for what can't. */
const dropMarketCache = () => attempt(() => writeText(KEYS.market, undefined));

/** One stored portfolio that failed to load, kept verbatim. */
interface KeptCopy {
   /** When it was set aside, ISO 8601; absent on a copy kept before copies were dated. */
   keptAt?: string;
   data: string;
}

/** Every copy kept so far. Before the list format a single copy was stored as the raw text itself. */
function keptCopies(): KeptCopy[] {
   const stored = readText(KEYS.unreadablePortfolio);

   if (stored === null) {
      return [];
   }

   try {
      const list: unknown = JSON.parse(stored);

      if (Array.isArray(list) && list.every((c: Partial<KeptCopy> | null) => typeof c?.data === 'string')) {
         return list as KeptCopy[];
      }
   } catch {
      // Not a list: the older single-copy format.
   }

   return [{ data: stored }];
}

export interface LoadedPortfolio {
   portfolio: Portfolio;
   /** Why the stored portfolio couldn't be loaded, for a banner. */
   error?: string;
   /**
    * Set when the unreadable portfolio could not be copied aside (storage
    * full): it is then still the only copy, and must not be saved over.
    */
   protect?: boolean;
}

/**
 * The stored portfolio, or an empty one with the reason when it can't be
 * read. Saving would overwrite unreadable data, so it is first added to the
 * list under `KEYS.unreadablePortfolio`, which only ever grows; if even that
 * can't be written, `protect` asks for the original to be left alone.
 */
export function loadPortfolio(): LoadedPortfolio {
   const raw = readText(KEYS.portfolio);

   if (!raw) {
      return { portfolio: { trades: [], cash: {} } };
   }

   try {
      return { portfolio: parsePortfolio(JSON.parse(raw)) };
   } catch (e) {
      const reason = message(e);
      const copies = keptCopies();
      const list = copies.some((c) => c.data === raw) ? copies : [...copies, { keptAt: new Date().toISOString(), data: raw }];
      const write = () => writeJson(KEYS.unreadablePortfolio, list);
      const kept = list === copies || attempt(write) || (dropMarketCache() && attempt(write));
      const intro = `Your saved trades could not be read (${reason}), so the app started empty.`;

      return kept
         ? {
              portfolio: { trades: [], cash: {} },
              error: `${intro} A copy is kept in this browser under “${KEYS.unreadablePortfolio}”.`,
           }
         : {
              portfolio: { trades: [], cash: {} },
              protect: true,
              error:
                 `${intro} Browser storage is too full to keep a copy, ` +
                 'so nothing will be saved over the original until there is room. Free up space and reload.',
           };
   }
}

/** The market cache as stored by an earlier version or a damaged write: any part of it may be missing. */
type CachedMarket = Partial<Omit<MarketData, 'quotes'>> & { quotes?: Record<string, Partial<Quote> | null> };

export function loadMarket(): MarketData {
   const cached = readJson(KEYS.market) as CachedMarket | null | undefined;

   // Anything unreadable falls back to an empty cache; it is rebuilt on the next refresh.
   if (!cached?.quotes || !cached.fx) {
      return { quotes: {}, fx: { USD: 1 } };
   }

   // Quotes are re-fetched anyway, so any that don't have the shape the app relies on are dropped.
   const quotes = Object.fromEntries(
      Object.entries(cached.quotes).filter((entry): entry is [string, Quote] => {
         const [s, q] = entry;

         return isSymbol(s) && isCurrencyCode(q?.currency) && (q.name === undefined || typeof q.name === 'string');
      }),
   );
   const intraday = cached.intraday && Object.fromEntries(Object.entries(cached.intraday).filter(([s]) => isSymbol(s)));

   return { ...cached, fx: cached.fx, quotes, intraday, fxDate: isIsoDate(cached.fxDate) ? cached.fxDate : undefined };
}

export const loadSnapshots = (): Snapshot[] => parseSnapshots(readJson(KEYS.snapshots) ?? []);

/** The latest export's mark; anything unreadable counts as never exported, which only shows a reminder. */
export function loadLastExport(): ExportMark | undefined {
   const mark = readJson(KEYS.lastExport) as Partial<ExportMark> | null | undefined;

   return isIsoDate(mark?.date) && typeof mark.fingerprint === 'string' ? { date: mark.date, fingerprint: mark.fingerprint } : undefined;
}

/** Remembers the latest export; without room it is skipped, and the reminder shows again after a reload. */
export const saveLastExport = (mark: ExportMark | undefined): void => {
   attempt(() => (mark ? writeJson(KEYS.lastExport, mark) : writeText(KEYS.lastExport, undefined)));
};

/** Whether the backup reminder was dismissed; anything else counts as not, which only shows the reminder. */
export const loadBackupReminderDismissed = (): boolean => readText(KEYS.backupReminderDismissed) === 'true';

/** Remembers the dismissal; without room it is skipped, and the reminder shows again after a reload. */
export const saveBackupReminderDismissed = (dismissed: boolean): void => {
   attempt(() => writeText(KEYS.backupReminderDismissed, dismissed ? 'true' : undefined));
};

/** What another tab saved, for this tab to adopt; only the part under the key it wrote is set. */
export interface SavedElsewhere {
   portfolio?: Portfolio;
   snapshots?: Snapshot[];
   lastExport?: ExportMark;
   backupReminderDismissed?: boolean;
}

/**
 * What another tab just saved under `key`, read back from storage; undefined for a key whose data each
 * tab keeps to itself (the market cache, display choices). A portfolio that is missing or can't be read
 * is undefined too: this tab's trades are never swapped for an empty ledger, and the next tab to start
 * sets the unreadable copy aside.
 */
export function loadSavedElsewhere(key: string | null): SavedElsewhere | undefined {
   switch (key) {
      case KEYS.portfolio: {
         const raw = readText(KEYS.portfolio);

         try {
            return raw ? { portfolio: parsePortfolio(JSON.parse(raw)) } : undefined;
         } catch {
            return undefined;
         }
      }

      case KEYS.snapshots:
         return { snapshots: loadSnapshots() };

      case KEYS.lastExport:
         return { lastExport: loadLastExport() };

      case KEYS.backupReminderDismissed:
         return { backupReminderDismissed: loadBackupReminderDismissed() };

      // Null when all of storage was cleared: this tab keeps what it has, and saves it with its next change.
      case null:
      default:
         return undefined;
   }
}

/** What is written back to storage. */
export interface Saved {
   portfolio: Portfolio;
   snapshots: Snapshot[];
   market: MarketData;
}

/**
 * Caches market data, which can always be fetched again, so it never throws.
 * Without room for everything it keeps the latest quotes but no history,
 * which still shows numbers offline; without room even for that, no cache.
 */
function saveMarket(market: MarketData): void {
   if (attempt(() => writeJson(KEYS.market, market))) {
      return;
   }

   const quotes = Object.fromEntries(Object.entries(market.quotes).map(([k, q]) => [k, { ...q, closes: [] }]));

   if (attempt(() => writeJson(KEYS.market, { ...market, quotes, fxHistory: undefined, intraday: undefined }))) {
      return;
   }

   dropMarketCache();
}

/** Writes what changed; returns why something could not be saved, or undefined when everything was. */
export type Save = (data: Saved, changed: { [K in keyof Saved]?: boolean }) => string | undefined;

/**
 * A save function for the page's lifetime. It writes the data that can't be
 * fetched again first, and when storage is full the market cache gives up
 * its history, then itself, to make room. Whatever still doesn't fit is
 * remembered and written again with every later save, so the reported error
 * only clears once it has actually been stored.
 *
 * - Parameter options.protectPortfolio: Never write the portfolio (see `LoadedPortfolio.protect`).
 */
export function createSave({ protectPortfolio = false } = {}): Save {
   const unsaved = new Set<'portfolio' | 'snapshots'>(protectPortfolio ? ['portfolio'] : []);

   return (data, changed) => {
      let shrunk = false;
      const keep = (what: 'portfolio' | 'snapshots', key: typeof KEYS.portfolio | typeof KEYS.snapshots) => {
         if (!changed[what] && !unsaved.has(what)) {
            return;
         }

         if (what === 'portfolio' && protectPortfolio) {
            return;
         }

         const write = () => writeJson(key, data[what]);
         let ok = attempt(write);

         if (!ok && !shrunk) {
            shrunk = true;
            // Drop the cache entirely, then write back as much of it as still fits.
            ok = dropMarketCache() && attempt(write);
         }

         if (ok) {
            unsaved.delete(what);
         } else {
            unsaved.add(what);
         }
      };

      keep('portfolio', KEYS.portfolio);
      keep('snapshots', KEYS.snapshots);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `keep` above sets it; the checker can't see that.
      if (changed.market || shrunk) {
         saveMarket(data.market);
      }

      if (protectPortfolio) {
         return (
            'Changes to trades and cash are not being saved: your earlier saved trades could not be read, ' +
            'and there is no room to keep a copy of them. Free up space in this browser’s storage and reload.'
         );
      }

      const lost = [...unsaved].map((w) => (w === 'portfolio' ? 'trades and cash' : 'daily history'));

      return lost.length
         ? `Browser storage is full, so your latest ${lost.join(' and ')} could not be saved and will be lost when the page reloads. ` +
              'Export a backup now.'
         : undefined;
   };
}
