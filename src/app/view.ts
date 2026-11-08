import type { FxHistory, FxRates, RateSeries } from '../domain/market';
import { estimateSpainTax, type TaxEstimate } from '../domain/tax';
import { summarize, type Summary } from '../domain/valuation';
import type { AppState } from './state';

/** The focused symbol, unless it has no trades left or the portfolio only ever held one stock. */
export function focusedSymbol({ portfolio, view }: AppState): string | undefined {
   const symbols = new Set(portfolio.trades.map((t) => t.symbol));

   return view.focus && symbols.has(view.focus) && symbols.size > 1 ? view.focus : undefined;
}

/** What the dashboard shows. */
export interface View {
   /** The whole portfolio, or only the focused stock's trades without cash. */
   s: Summary;
   /** Always the whole portfolio. */
   full: Summary;
   focused?: string;
   /** The tax estimate, in EUR, when one is chosen and the whole portfolio is shown: tax is per person, not per stock. */
   tax?: TaxEstimate;
}

export function viewSummary(state: AppState): View {
   const { portfolio, market, view } = state;
   const full = summarize(portfolio, market.quotes, market.fx, view.reporting);
   const focused = focusedSymbol(state);

   if (!focused) {
      return { s: full, full, tax: view.tax ? taxEstimate(state, full) : undefined };
   }

   const trades = portfolio.trades.filter((t) => t.symbol === focused);
   const s = summarize({ trades, cash: {} }, market.quotes, market.fx, view.reporting);

   // Within a one-stock view the weight would always be 100%; keep its share of the whole portfolio.
   for (const h of s.holdings) {
      h.weight = full.holdings.find((f) => f.symbol === h.symbol)?.weight;
   }

   return { s, full, focused };
}

/** The latest rate in a daily series on or before `date`, if the series reaches back that far. */
function rateOn(series: RateSeries | undefined, date: string): number | undefined {
   let found: number | undefined;

   for (const r of series ?? []) {
      if (r.date > date) {
         break;
      }

      found = r.rate;
   }

   return found;
}

/** EUR per 1 unit of `currency` on `date`, from the ECB history; today's rate before the history starts. */
function eurPerUnitOn(currency: string, date: string, history: FxHistory, fx: FxRates): number | undefined {
   const perUsd = (c: string) => (c === 'USD' ? 1 : (rateOn(history[c], date) ?? fx[c]));
   const eur = perUsd('EUR');
   const unit = perUsd(currency);

   return eur !== undefined && unit !== undefined ? eur / unit : undefined;
}

/**
 * The Spanish savings-tax estimate for the whole portfolio. Spain taxes results in EUR, so they are taken
 * from a EUR valuation whatever the dashboard reports in: each sale at its own rates, each dividend at the
 * ECB rate of its ex-date, and the unrealized result at today's.
 */
function taxEstimate({ portfolio, market }: AppState, full: Summary): TaxEstimate {
   const eur = full.base === 'EUR' ? full : summarize(portfolio, market.quotes, market.fx, 'EUR');
   const gains: Record<number, number> = {};
   const dividends: Record<number, number> = {};

   for (const sale of eur.sales) {
      const year = Number(sale.trade.date.slice(0, 4));

      gains[year] = (gains[year] ?? 0) + sale.gain;
   }

   for (const h of eur.holdings) {
      for (const d of h.dividendsPaid ?? []) {
         const date = new Date(d.date).toISOString().slice(0, 10);
         const rate = eurPerUnitOn(h.currency, date, market.fxHistory ?? {}, market.fx);
         const year = Number(date.slice(0, 4));

         if (rate !== undefined) {
            dividends[year] = (dividends[year] ?? 0) + d.amountLocal * rate;
         }
      }
   }

   const paid = Object.fromEntries(Object.entries(portfolio.taxPaid ?? {}).map(([year, amount]) => [Number(year), amount]));

   return estimateSpainTax(gains, dividends, eur.pl, new Date().getFullYear(), paid);
}

/** Today's USD per 1 EUR, if the rate is known. */
export const eurUsdNow = (fx: FxRates) => (fx.EUR ? 1 / fx.EUR : undefined);
