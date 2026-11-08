// What the app needs from the outside world. market/ and persistence/ provide implementations; tests provide fakes.
import type { Stored, StoredChange } from '../backup/stored';
import type { FxSnapshot, Intraday, MarketData, Quote, RateSeries } from '../domain/market';
import type { ReferenceRates } from '../domain/trade';

export interface PriceProvider {
   /**
    * Fetches the latest quote plus daily closes, dividends and splits from
    * `since` (epoch ms) onwards. Rejects with a human-readable message when
    * the symbol has no quote.
    */
   getQuote(symbol: string, since: number): Promise<Quote>;
   /** Fetches the most recent regular session's prices at a few minutes' resolution. */
   getIntraday(symbol: string): Promise<Intraday>;
}

export interface RateProvider {
   /** Today's units of each currency per USD, and the rates' publication date if any were fetched. */
   getUsdRates(currencies: Iterable<string>): Promise<FxSnapshot>;
   /** Daily units of `currency` per USD between two `YYYY-MM-DD` dates, inclusive. */
   getUsdRateHistory(currency: string, from: string, to: string): Promise<RateSeries>;
   /** EUR/USD and USD per unit of `currency` on a trade date. */
   getReferenceRates(currency: string, date: string): Promise<ReferenceRates>;
}

/** What a save stored: everything, or not the parts it lists. */
export type SaveResult =
   | { ok: true }
   /** No room: `unsaved` is kept for this visit only, and is saved again with every later save. */
   | { ok: false; reason: 'full'; unsaved: ('portfolio' | 'snapshots')[] }
   /** The stored portfolio couldn't be read, nor set aside, so it is never saved over. */
   | { ok: false; reason: 'protected' };

/** Keeps the data that can't be fetched again. Implementations may be slow, so everything is asynchronous. */
export interface PortfolioRepository {
   /** What was kept, and why the stored portfolio couldn't be read when the app has to start without it. */
   load(): Promise<Stored & { warning?: string }>;
   /**
    * Saves `change`, and again whatever an earlier save couldn't store, so an empty change only retries.
    * Never rejects: the result says what couldn't be stored.
    */
   save(change: StoredChange): Promise<SaveResult>;
   /** Calls `listener` with what is saved elsewhere, such as in another tab; returns an unsubscribe. */
   onSavedElsewhere(listener: (change: StoredChange) => void): () => void;
}

/** Keeps market data between visits, so prices show before the first refresh. Losing it costs only a refresh. */
export interface MarketCache {
   load(): Promise<MarketData>;
   /** Keeps as much of `market` as there is room for; never rejects. */
   save(market: MarketData): Promise<void>;
}
