import type { ExportMark } from '../backup/export';
import type { MarketData } from '../domain/market';
import { RANGES, type RangeKey } from '../domain/ranges';
import { TAX_REGIMES, type TaxRegime } from '../domain/tax';
import type { Snapshot } from '../domain/snapshots';
import { BASE, REPORTING, type Portfolio, type Reporting } from '../domain/types';
import type { Store } from './store';

/** How many transactions a page of the ledger shows; the first is the default. */
export const PAGE_SIZES = [10, 25] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** How the dashboard is looked at; remembered across visits. */
export interface ViewOptions {
   /** Currency the summary, chart and allocation are reported in. */
   reporting: Reporting;
   /** Symbol the dashboard is narrowed to, as chosen; see `focusedSymbol` for whether it applies. */
   focus?: string;
   range: RangeKey;
   /** Masks every amount that reveals the portfolio's size, for sharing screenshots; percentages stay. */
   hideAmounts: boolean;
   /** Transactions per page of the ledger. */
   pageSize: PageSize;
   /** Country whose tax on gains and dividends is estimated; none when absent. */
   tax?: TaxRegime;
}

/** Outcome of the latest refresh. */
export interface RefreshStatus {
   refreshing: boolean;
   /** Set when a refresh was asked for while one was running; another runs as soon as it ends. */
   queued?: boolean;
   /** Symbols whose last refresh failed, with the reason; their cached quote is shown. */
   failed: ReadonlyMap<string, string>;
   fxError?: string;
   fxHistoryError?: string;
}

export interface AppState {
   /** The user's ledger and cash: the only data that cannot be fetched again. */
   portfolio: Portfolio;
   market: MarketData;
   snapshots: Snapshot[];
   status: RefreshStatus;
   view: ViewOptions;
   /** Why the stored portfolio couldn't be loaded, shown until the page is reloaded. */
   storageWarning?: string;
   /** Why the latest change couldn't be saved; cleared by the next save that succeeds. */
   saveError?: string;
   /** The latest export or import, for the backup reminder. */
   lastExport?: ExportMark;
   /** The backup reminder was dismissed; the Backup panel still shows what isn't exported. */
   backupReminderDismissed?: boolean;
}

export type AppStore = Store<AppState>;

/** View options from stored choices, falling back to defaults for anything missing or no longer offered. */
export function initialView(stored: {
   range?: string;
   reporting?: string;
   focus?: string;
   hideAmounts: boolean;
   pageSize?: number;
   tax?: string;
}): ViewOptions {
   return {
      reporting: REPORTING.find((c) => c === stored.reporting) ?? BASE,
      focus: stored.focus || undefined,
      range: RANGES.find((r) => r.key === stored.range)?.key ?? '1Y',
      hideAmounts: stored.hideAmounts,
      pageSize: PAGE_SIZES.find((n) => n === stored.pageSize) ?? PAGE_SIZES[0],
      tax: TAX_REGIMES.find((r) => r === stored.tax),
   };
}

export const updateView = (store: AppStore, change: Partial<ViewOptions>): void =>
   store.update((s) => ({ ...s, view: { ...s.view, ...change } }));
