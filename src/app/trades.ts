import { parsePortfolio } from '../backup/schema';
import { message } from '../domain/errors';
import { firstOversold, type Match } from '../domain/ledger';
import type { Quote } from '../domain/market';
import { buildTrade, impliedEurUsd, type ReferenceRates, type TradeInput } from '../domain/trade';
import { BASE, CASH_CURRENCY, type Trade } from '../domain/types';
import { summarize, type Sale } from '../domain/valuation';
import type { RateProvider } from './ports';
import type { AppState, AppStore } from './state';

/** Currencies a trade or its fees can be settled in, besides the instrument's own. */
export const PAY_CURRENCIES = ['EUR', BASE];
/** A derived EUR/USD further than this from the reference is treated as a typo. */
const MAX_RATE_DEVIATION = 0.1;

/** A trade as typed into the form, not yet checked against the ledger. */
export interface TradeDraft {
   input: TradeInput;
   quote: Quote;
   date: string;
   /** The trade being edited, which the draft replaces; absent for a new trade. */
   replacing?: string;
}

/** Why a draft cannot be saved. */
export type TradeProblem =
   | { kind: 'currency'; recorded: string }
   | { kind: 'rates'; error: unknown }
   | { kind: 'rate'; implied: number; reference: number }
   | { kind: 'oversold'; match: Match; trade: Trade }
   | { kind: 'invalid'; reason: string };

/**
 * The ledger with `trade` added, or replacing the trade with id `replacing`. An edit of a trade that
 * is no longer there (another tab removed it) is added as a new trade rather than lost.
 */
const withTrade = (trades: Trade[], trade: Trade, replacing: string | undefined): Trade[] =>
   replacing && trades.some((t) => t.id === replacing) ? trades.map((t) => (t.id === replacing ? trade : t)) : [...trades, trade];

/**
 * Reference rates for the trade, or for a straight EUR↔USD conversion the
 * rate the amounts imply when the reference can't be fetched.
 */
export async function ratesFor(
   input: TradeInput,
   date: string,
   rates: Pick<RateProvider, 'getReferenceRates'>,
): Promise<ReferenceRates> {
   try {
      return await rates.getReferenceRates(input.currency, date);
   } catch (e) {
      const implied = impliedEurUsd(input);

      if (implied === undefined) {
         throw e;
      }

      return { eurUsd: implied, usdPerUnit: input.currency === BASE ? 1 : implied };
   }
}

/**
 * Turns a draft into the ledger it would produce, or the first reason it
 * can't: the symbol trading in another currency than its earlier trades,
 * no reference rates, amounts implying an implausible EUR/USD, a trade that
 * would not load again, or a sale of more shares than were held (including
 * an edited purchase that leaves a later sale short).
 */
export async function prepareTrade(
   state: AppState,
   draft: TradeDraft,
   id: string,
   rates: Pick<RateProvider, 'getReferenceRates'>,
): Promise<{ trade: Trade; trades: Trade[] } | { problem: TradeProblem }> {
   const { input, quote, date, replacing } = draft;
   const other = state.portfolio.trades.find((t) => t.symbol === quote.symbol && t.id !== replacing);

   if (other && other.currency !== input.currency) {
      return { problem: { kind: 'currency', recorded: other.currency } };
   }

   let ref: ReferenceRates;

   try {
      ref = await ratesFor(input, date, rates);
   } catch (error) {
      return { problem: { kind: 'rates', error } };
   }

   const implied = impliedEurUsd(input);

   if (implied !== undefined && Math.abs(implied / ref.eurUsd - 1) > MAX_RATE_DEVIATION) {
      return { problem: { kind: 'rate', implied, reference: ref.eurUsd } };
   }

   const trade = buildTrade(input, ref, quote.symbol, date, id);

   // Saved trades are checked again on every load; one that would fail there (a rate that isn't a
   // number, amounts that overflow) must not be saved, or the whole ledger would fail to load.
   try {
      parsePortfolio({ trades: [trade], cash: {} });
   } catch (e) {
      return { problem: { kind: 'invalid', reason: message(e) } };
   }

   const trades = withTrade(state.portfolio.trades, trade, replacing);
   const match = firstOversold(trades, quote.symbol, quote);

   return match ? { problem: { kind: 'oversold', match, trade } } : { trade, trades };
}

/**
 * What saving a sale draft would realize, or the sale it would leave oversold.
 * `sale` is undefined when the gain can't be valued yet.
 */
export function previewSale(
   state: AppState,
   draft: TradeDraft,
   ref: ReferenceRates,
): { oversold: Match; trade: Trade } | { sale?: Sale } {
   const { input, quote, date, replacing } = draft;
   const trade = buildTrade(input, ref, quote.symbol, date, replacing ?? 'draft');
   const trades = withTrade(state.portfolio.trades, trade, replacing);
   const oversold = firstOversold(trades, quote.symbol, quote);

   if (oversold) {
      return { oversold, trade };
   }

   const { market, view } = state;
   const s = summarize({ ...state.portfolio, trades }, { ...market.quotes, [quote.symbol]: quote }, market.fx, view.reporting);

   return { sale: s.sales.find((x) => x.trade.id === trade.id) };
}

/**
 * Saves a prepared trade, keeping the quote looked up for it so the trade is valued before the next
 * refresh. It goes into the ledger as it is now, not as it was when prepared: preparing waits for
 * rates, and another tab may have saved trades meanwhile.
 */
export function commitTrade(store: AppStore, trade: Trade, replacing: string | undefined, quote: Quote): void {
   store.update((s) => ({
      ...s,
      portfolio: { ...s.portfolio, trades: withTrade(s.portfolio.trades, trade, replacing) },
      market: { ...s.market, quotes: { ...s.market.quotes, [quote.symbol]: quote } },
   }));
}

/** The sale that removing the trade would leave selling more shares than were held, if any. */
export function deletionConflict({ portfolio, market }: AppState, id: string): Match | undefined {
   const t = portfolio.trades.find((x) => x.id === id);

   if (!t || t.side === 'sell') {
      return undefined;
   }

   return firstOversold(
      portfolio.trades.filter((x) => x.id !== id),
      t.symbol,
      market.quotes[t.symbol],
   );
}

export const deleteTrade = (store: AppStore, id: string): void =>
   store.update((s) => ({ ...s, portfolio: { ...s.portfolio, trades: s.portfolio.trades.filter((t) => t.id !== id) } }));

/** Sets the cash balance; zero removes it. */
export function setCash(store: AppStore, amount: number): void {
   store.update((s) => {
      const cash = { ...s.portfolio.cash };

      if (amount === 0) {
         delete cash[CASH_CURRENCY];
      } else {
         cash[CASH_CURRENCY] = amount;
      }

      return { ...s, portfolio: { ...s.portfolio, cash } };
   });
}
