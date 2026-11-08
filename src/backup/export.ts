import { realizedByYear } from '../domain/realized';
import type { Snapshot } from '../domain/snapshots';
import { tradeAmountLocal, tradeAmountUsd, usdPerBaseAt } from '../domain/trade';
import type { Portfolio, Trade } from '../domain/types';
import type { Summary } from '../domain/valuation';

/** Format version of the export; `parsePortfolio` also reads every earlier one. 3 added `taxPaid`. */
const EXPORT_VERSION = 3;

type Pair = { USD: number; EUR: number };

const cents = (v: number) => Math.round(v * 100) / 100;
const units = (v: number) => Math.round(v * 1e6) / 1e6;
/** Both reporting currencies, or nothing when either is unknown. */
const pair = (usd: number | undefined, eur: number | undefined): Pair | undefined =>
   usd === undefined || eur === undefined || !Number.isFinite(usd) || !Number.isFinite(eur)
      ? undefined
      : { USD: cents(usd), EUR: cents(eur) };

/**
 * Builds the export file: the ledger, cash and snapshots, which restore
 * everything, plus figures computed from them for reading or for a tax
 * return. Computed figures sit under `computed` and `report` and are ignored
 * on import, since they are derived again from the ledger.
 *
 * - Parameters:
 *   - usd: The portfolio valued in USD.
 *   - eur: The same portfolio valued in EUR.
 *   - prices: When prices were last refreshed and the date of the FX rates.
 */
export function buildExport(
   portfolio: Portfolio,
   snapshots: Snapshot[],
   usd: Summary,
   eur: Summary,
   prices: { refreshedAt?: number; fxDate?: string; eurUsd?: number },
   exportedAt: Date,
) {
   const salesUsd = new Map(usd.sales.map((s) => [s.trade.id, s]));
   const salesEur = new Map(eur.sales.map((s) => [s.trade.id, s]));
   const usdPerEurNow = prices.eurUsd ?? NaN;

   const realized = (t: Trade) => {
      const u = salesUsd.get(t.id);
      const e = salesEur.get(t.id);

      if (!u || !e) {
         return undefined;
      }

      // Matched shares are counted in today's split-adjusted units; report them as on the sale date.
      const toSaleUnits = (n: number) => units((n * t.quantity) / u.shares);

      return {
         method: 'FIFO',
         proceeds: { local: cents(u.proceedsLocal), ...pair(u.proceeds, e.proceeds) },
         costBasis: { local: cents(u.basisLocal), ...pair(u.basis, e.basis) },
         gain: { local: cents(u.gainLocal), ...pair(u.gain, e.gain) },
         lots: u.lots.map((l, i) => ({
            buyId: l.buy.id,
            buyDate: l.buy.date,
            units: toSaleUnits(l.shares),
            costBasis: { local: cents(l.basisLocal), ...pair(l.basis, e.lots[i]?.basis) },
         })),
      };
   };

   const trades = [...portfolio.trades]
      .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol))
      .map((t) => ({
         ...t,
         computed: {
            // Buy: cost including fees. Sell: proceeds after fees. At trade-date rates.
            total: {
               local: cents(tradeAmountLocal(t)),
               ...pair(tradeAmountUsd(t), tradeAmountUsd(t) / usdPerBaseAt(t, 'EUR', usdPerEurNow)),
            },
            ...(t.side === 'sell' ? { realized: realized(t) } : {}),
         },
      }));

   const eurHoldings = new Map(eur.holdings.map((h) => [h.symbol, h]));
   const holdings = usd.holdings.map((h) => {
      const e = eurHoldings.get(h.symbol);

      return {
         symbol: h.symbol,
         name: h.quote?.name,
         currency: h.currency,
         shares: units(h.shares),
         price: h.quote?.price,
         issue: h.issue,
         avgCost: h.avgCostLocal !== undefined ? cents(h.avgCostLocal) : undefined,
         costBasis: { local: cents(h.basisLocal), ...pair(h.basis, e?.basis) },
         value: h.valueLocal !== undefined ? { local: cents(h.valueLocal), ...pair(h.value, e?.value) } : undefined,
         unrealized: pair(h.pl, e?.pl),
         realized: pair(h.realized, e?.realized),
         dividends: h.dividendsLocal !== undefined ? { local: cents(h.dividendsLocal), ...pair(h.dividends, e?.dividends) } : undefined,
      };
   });

   const totals = (s: Summary) => ({
      total: cents(s.total),
      invested: cents(s.invested),
      cash: cents(s.cashValue),
      costBasis: cents(s.costBasis),
      unrealized: cents(s.pl),
      realized: cents(s.realized),
      realizedByYear: Object.fromEntries(Object.entries(realizedByYear(s.sales)).map(([y, v]) => [y, cents(v)])),
      dividends: cents(s.dividends),
      excludedItems: s.excluded,
   });

   return {
      app: 'QuickFolio',
      version: EXPORT_VERSION,
      exportedAt: exportedAt.toISOString(),
      trades,
      cash: portfolio.cash,
      ...(portfolio.taxPaid ? { taxPaid: portfolio.taxPaid } : {}),
      snapshots,
      report: {
         note:
            'Computed at export time and ignored on import. Amounts at trade-date FX rates, except value, ' +
            'unrealized and dividends, which use the latest rate. Realized gains match sales to buys FIFO; fees included.',
         pricesAsOf: prices.refreshedAt !== undefined ? new Date(prices.refreshedAt).toISOString() : undefined,
         fxDate: prices.fxDate,
         eurUsd: prices.eurUsd,
         totals: { USD: totals(usd), EUR: totals(eur) },
         holdings,
      },
   };
}

/** The latest export: its date, and which trades and cash it holds, so later changes can be told apart. */
export interface ExportMark {
   /** `YYYY-MM-DD`. */
   date: string;
   fingerprint: string;
}

/** JSON with object keys sorted and undefined fields left out, so equal content always gives equal text. */
const canonical = (v: unknown): string => {
   if (Array.isArray(v)) {
      return `[${v.map(canonical).join(',')}]`;
   }

   if (v === null || typeof v !== 'object') {
      return JSON.stringify(v);
   }

   const fields = Object.entries(v).filter(([, x]) => x !== undefined);

   return `{${fields
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(',')}}`;
};

/** Portfolios are immutable, so each one is hashed once however often the page renders. */
const fingerprints = new WeakMap<Portfolio, string>();

/** A short hash (32-bit FNV-1a) of the trades and cash: the same for the same content, whatever its field order. */
export function fingerprint(portfolio: Portfolio): string {
   let hash = fingerprints.get(portfolio);

   if (hash === undefined) {
      const text = canonical(portfolio);
      let h = 0x811c9dc5;

      for (let i = 0; i < text.length; i++) {
         h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
      }

      hash = h.toString(16).padStart(8, '0');
      fingerprints.set(portfolio, hash);
   }

   return hash;
}

export const exportMark = (portfolio: Portfolio, date: string): ExportMark => ({
   date,
   fingerprint: fingerprint(portfolio),
});
