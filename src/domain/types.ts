/** Pivot currency for FX math: stored and fetched rates are expressed against it. */
export const BASE = 'USD';

/** Currencies the portfolio can be reported in. */
export const REPORTING = ['USD', 'EUR'] as const;
export type Reporting = (typeof REPORTING)[number];

export type Side = 'buy' | 'sell';

/**
 * One transaction as on the trade confirmation. Holdings, open lots and
 * realized gains are all derived from the ledger of trades, so editing an old
 * trade recomputes everything after it.
 */
export interface Trade {
   id: string;
   side: Side;
   /** Yahoo symbol, exchange-qualified where needed (e.g. `NOKIA.HE`). */
   symbol: string;
   /** Trade date, `YYYY-MM-DD`. */
   date: string;
   /** Shares bought or sold, as on the trade confirmation (later splits are applied automatically). */
   quantity: number;
   /** Trading currency of the instrument; `unitPrice` and `gross` are in it. */
   currency: string;
   /** Price per share as entered, in `currency`. */
   unitPrice: number;
   /**
    * Trade amount before fees, in `currency`: `settled` when that was in the
    * same currency (what actually moved), else quantity × `unitPrice`.
    */
   gross: number;
   /** Amount paid (buy) or received (sell) before fees, in `settledIn`. */
   settled: number;
   /** Currency `settled` is in: the instrument's own, EUR or USD. */
   settledIn: string;
   /** Fees in `feeCurrency`: added to the cost of a buy, deducted from the proceeds of a sell. */
   fees: number;
   /** Currency the fees were charged in, which need not be the instrument's. */
   feeCurrency: string;
   /** USD per 1 unit of `currency` on the trade date; 1 for USD trades. */
   fxRate: number;
   /** USD per 1 unit of `feeCurrency` on the trade date. */
   feeFxRate: number;
   /**
    * USD per 1 EUR on the trade date. Implied by `settled` ÷ `gross` when the
    * trade converted between EUR and USD, otherwise the reference rate.
    * Absent only on USD trades saved before it existed, until the next refresh
    * backfills the reference rate.
    */
   eurUsd?: number;
}

export interface Portfolio {
   /** Every buy and sell, in the order entered. */
   trades: Trade[];
   /** Cash balance per ISO currency code; maintained by hand, trades never touch it. */
   cash: Record<string, number>;
   /**
    * Tax paid on this portfolio's results per calendar year, in EUR, as filed in the tax return; entered by
    * hand. It replaces the estimate for that year. Absent when none was entered.
    */
   taxPaid?: Record<string, number>;
}

/** Cash is held, and entered, in a single currency. */
export const CASH_CURRENCY = 'EUR';
