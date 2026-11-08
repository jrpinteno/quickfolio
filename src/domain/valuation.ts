import { matchFifo, SHARE_EPSILON, type Match, type Position } from './ledger';
import type { FxRates, Quote } from './market';
import { ratio, sum } from './math';
import { convert } from './money';
import { xirr, type Flow } from './returns';
import { DAY, localDay, tradeTime } from './time';
import { affectedFrom, currentShares, tradeAmountLocal, tradeAmountUsd, tradeFeesLocal, tradeFeesUsd, usdPerBaseAt } from './trade';
import { BASE, type Portfolio, type Reporting, type Trade } from './types';

/** Holding periods shorter than this are not annualized; the figure would be noise. */
const MIN_ANNUALIZE_MS = 365 * DAY;

/**
 * Whether the holding's latest price is from `day`. Only those holdings move
 * the portfolio on that day; the rest still show their previous session.
 */
export const tradedOn = (h: Holding, day: string | undefined) =>
   day !== undefined && h.quote !== undefined && localDay(h.quote.marketTime) === day;

/** A sale's realized result. Unsuffixed amounts are in the summary's reporting currency. */
export interface Sale {
   trade: Trade;
   /** Shares sold, in today's split-adjusted shares. */
   shares: number;
   /** Proceeds net of selling fees, at the sale-date rate. */
   proceeds: number;
   /** Cost of the shares sold, purchase fees included, at each buy's trade-date rate. */
   basis: number;
   gain: number;
   /** `gain` over `basis`. */
   returnPct?: number;
   /** The same figures in the instrument's currency, without any currency effect. */
   proceedsLocal: number;
   basisLocal: number;
   gainLocal: number;
   /** The buys consumed, first-in first-out. */
   lots: { buy: Trade; shares: number; basis: number; basisLocal: number }[];
}

/**
 * One symbol's trades, valued. Fields without a suffix are in the summary's
 * reporting currency; `…Local` fields are in the instrument's own currency.
 * Cost figures cover the shares still held; sold shares move to `sales`.
 */
export interface Holding {
   symbol: string;
   currency: string;
   trades: Trade[];
   /** Every buy with what is left of it, fully sold ones included. */
   positions: Position[];
   /** Buys still (partly) held. */
   open: Position[];
   quote?: Quote;
   /** Why the holding is excluded from totals, if it is. */
   issue?: string;
   /** Current share count, split-adjusted; 0 once everything is sold. */
   shares: number;
   /** Purchase amounts plus fees of the shares held, in the holding's currency. */
   basisLocal: number;
   /** Cost basis of the shares held at each buy's trade-date rate. */
   basis: number;
   /** Purchase fees within `basisLocal`. */
   feesLocal: number;
   /** Purchase fees within `basis`. */
   fees: number;
   /** Basis per current share, fees included: the break-even price before selling costs. */
   avgCostLocal?: number;
   /** Purchase amount per current share, excluding fees, as trade confirmations quote it. */
   avgPriceLocal?: number;
   /** `basis` per current share. */
   avgCost?: number;
   /** Realized results, oldest first; empty when the ledger is inconsistent. */
   sales: Sale[];
   /** Sum of `sales` gains. */
   realized: number;
   valueLocal?: number;
   value?: number;
   pl?: number;
   /** Part of `pl` from the share price moving. */
   pricePl?: number;
   /** Part of `pl` from the instrument's currency moving against the reporting currency. */
   fxPl?: number;
   /** `pl` over `basis`; dividends excluded. */
   returnPct?: number;
   /** Money-weighted annual return over every trade, sales and dividends included. */
   annualized?: number;
   /** Gross dividends earned while held, before withholding tax. */
   dividendsLocal?: number;
   /** `dividendsLocal` at today's rate. */
   dividends?: number;
   /** Each dividend making up `dividendsLocal`: its ex-date (epoch ms) and gross amount, in the holding's currency. */
   dividendsPaid?: { date: number; amountLocal: number }[];
   /** Dividends with ex-dates in the last 12 months over today's price. */
   yieldTtm?: number;
   dayPct?: number;
   dayChange?: number;
   /** Price relative to the 52-week high: 0 at the high, negative below it. */
   fromHigh?: number;
   /** Whether the exchange is in its regular session; absent if unknown. */
   marketOpen?: boolean;
   /** Share of total portfolio value, cash included. */
   weight?: number;
}

export interface CashRow {
   currency: string;
   amount: number;
   /** `amount` in the reporting currency; absent without an FX rate. */
   value?: number;
   weight?: number;
}

export interface Exposure {
   currency: string;
   value: number;
   weight: number;
}

/** Portfolio totals. Amounts are in `base` unless the name says otherwise. */
export interface Summary {
   base: Reporting;
   /** Every symbol ever traded; sold-out ones have zero shares and value. */
   holdings: Holding[];
   cash: CashRow[];
   invested: number;
   /** Cost basis of priced holdings at trade-date rates, fees included. */
   costBasis: number;
   /** Fees within `costBasis`. */
   fees: number;
   cashValue: number;
   total: number;
   /** Unrealized: value minus cost of the shares held. */
   pl: number;
   pricePl: number;
   fxPl: number;
   plPct?: number;
   /** Every sale's realized result, oldest first. */
   sales: Sale[];
   /** Sum of realized gains. */
   realized: number;
   /** Gross dividends earned, at today's rate. */
   dividends: number;
   /** Money-weighted annual return of all priced holdings, sales and dividends included. */
   annualized?: number;
   /**
    * The most recent local date on which any held exchange traded: today on a
    * trading day, otherwise the last one. Absent without priced holdings.
    */
   day?: string;
   /** Change since the previous close of the holdings that traded on `day`. */
   dayChange: number;
   dayPct?: number;
   /** Total value by currency, stocks and cash combined, largest first. */
   exposure: Exposure[];
   largest?: { symbol: string; weight: number };
   /** Combined weight of the three largest holdings; only set with four or more. */
   top3Weight?: number;
   /** Holdings and cash balances missing a price or FX rate, or with an inconsistent ledger. */
   excluded: number;
}

/** A trade's USD amount in the reporting currency, at its trade-date rate. */
type ToBase = (t: Trade, usd: number) => number;

/** Fraction of a buy still held; cost figures scale with it. */
const heldPart = (p: Position) => p.remaining / p.shares;

/** Cost of the shares still held, fees included, and its averages per share. */
function openCost(open: Position[], shares: number, toBase: ToBase) {
   const basisLocal = sum(open, (p) => heldPart(p) * tradeAmountLocal(p.buy));
   const basis = sum(open, (p) => heldPart(p) * toBase(p.buy, tradeAmountUsd(p.buy)));

   return {
      basisLocal,
      basis,
      feesLocal: sum(open, (p) => heldPart(p) * tradeFeesLocal(p.buy)),
      fees: sum(open, (p) => heldPart(p) * toBase(p.buy, tradeFeesUsd(p.buy))),
      // Per split-adjusted share, so the averages compare directly with today's price.
      avgCostLocal: ratio(basisLocal, shares),
      avgPriceLocal: ratio(
         sum(open, (p) => heldPart(p) * p.buy.gross),
         shares,
      ),
      avgCost: ratio(basis, shares),
   };
}

/** Why the trades can't be valued at all: mixed currencies, or a sale of more shares than were held. */
function ledgerIssue(symbol: string, trades: Trade[], currency: string, matches: Match[]): string | undefined {
   if (trades.some((t) => t.currency !== currency)) {
      return `Trades of ${symbol} are recorded in different currencies`;
   }

   const oversold = matches.find((m) => m.unmatched > 0);

   if (!oversold) {
      return undefined;
   }

   const excess = +((oversold.unmatched * oversold.sale.quantity) / oversold.shares).toFixed(6);

   return `The sale of ${oversold.sale.date} sells ${excess} more shares than were held`;
}

/** Each sale's result against the buys it consumed, first in, first out. */
function realize(matches: Match[], sharesToday: (t: Trade) => number, toBase: ToBase): Sale[] {
   return matches.map((m) => {
      const lots = m.lots.map(({ buy, shares }) => {
         const part = shares / sharesToday(buy);

         return { buy, shares, basis: part * toBase(buy, tradeAmountUsd(buy)), basisLocal: part * tradeAmountLocal(buy) };
      });
      const proceeds = toBase(m.sale, tradeAmountUsd(m.sale));
      const proceedsLocal = tradeAmountLocal(m.sale);
      const basis = sum(lots, (l) => l.basis);
      const basisLocal = sum(lots, (l) => l.basisLocal);

      return {
         trade: m.sale,
         shares: m.shares,
         proceeds,
         basis,
         gain: proceeds - basis,
         returnPct: ratio(proceeds - basis, basis),
         proceedsLocal,
         basisLocal,
         gainLocal: proceedsLocal - basisLocal,
         lots,
      };
   });
}

/** Why the shares still held can't be priced: no quote, a currency mismatch, or a missing rate. */
function pricingIssue(quote: Quote | undefined, currency: string, fx: FxRates, base: Reporting, usdPerBaseNow: number | undefined) {
   if (!quote) {
      return 'No price yet';
   }

   if (quote.currency !== currency) {
      return `Quoted in ${quote.currency}, but trades are in ${currency}`;
   }

   if (!fx[currency] || !usdPerBaseNow) {
      return `No FX rate for ${fx[currency] ? base : currency}`;
   }

   return undefined;
}

/** Value of the shares held, and its P/L split into the price's and the currency's effect. */
function marketValue(open: Position[], price: number, rateNow: number, toBase: ToBase) {
   let valueLocal = 0;
   let pricePl = 0;
   let fxPl = 0;

   for (const p of open) {
      const lotValue = p.remaining * price;
      const lotBasisLocal = heldPart(p) * tradeAmountLocal(p.buy);
      const lotBasis = heldPart(p) * toBase(p.buy, tradeAmountUsd(p.buy));
      // Instrument currency → reporting currency on the trade date, so that
      // pricePl + fxPl adds up exactly to value - basis.
      const rateThen = lotBasisLocal > 0 ? lotBasis / lotBasisLocal : rateNow;

      valueLocal += lotValue;
      pricePl += (lotValue - lotBasisLocal) * rateThen;
      fxPl += lotValue * (rateNow - rateThen);
   }

   return { valueLocal, pricePl, fxPl };
}

/**
 * Gross dividends earned while held, in the instrument's currency, and the
 * cash flows they add to the return at today's rate. Amounts are per
 * split-adjusted share, so they pair with today's share counts.
 */
function dividendsEarned(positions: Position[], quote: Quote, rateNow: number, now: number) {
   let amountLocal = 0;
   const flows: Flow[] = [];
   const paid: { date: number; amountLocal: number }[] = [];

   for (const p of positions) {
      const from = affectedFrom(p.buy);

      for (const d of quote.dividends) {
         if (d.date < from || d.date > now) {
            continue;
         }

         const entitled =
            p.shares -
            sum(
               p.closures.filter((c) => affectedFrom(c.sale) <= d.date),
               (c) => c.shares,
            );

         if (entitled <= SHARE_EPSILON) {
            continue;
         }

         amountLocal += d.amount * entitled;
         paid.push({ date: d.date, amountLocal: d.amount * entitled });
         flows.push({ t: d.date, amount: d.amount * entitled * rateNow });
      }
   }

   return { amountLocal, flows, paid };
}

/** Trailing yield, today's move and the distance from the 52-week high, for shares still held. */
function todaysFigures(q: Quote, shares: number, rateNow: number, now: number) {
   const ttm = sum(
      q.dividends.filter((d) => d.date > now - 365 * DAY && d.date <= now),
      (d) => d.amount,
   );
   const prev = q.previousClose;

   return {
      yieldTtm: ttm > 0 ? ratio(ttm, q.price) : undefined,
      dayPct: prev !== undefined ? ratio(q.price - prev, prev) : undefined,
      dayChange: prev !== undefined ? shares * (q.price - prev) * rateNow : undefined,
      fromHigh: q.high52 ? q.price / q.high52 - 1 : undefined,
      marketOpen: q.session ? now >= q.session.start && now < q.session.end : undefined,
   } satisfies Partial<Holding>;
}

/**
 * Values one symbol's trades, and returns the cash flows its money-weighted
 * return is computed from. A holding with an issue keeps its cost figures
 * but contributes no flows, value or totals.
 */
function valueHolding(
   symbol: string,
   trades: Trade[],
   quote: Quote | undefined,
   fx: FxRates,
   base: Reporting,
   now: number,
): { holding: Holding; flows: Flow[] } {
   const currency = trades[0]!.currency;
   // Today's USD per unit of the reporting currency; also the legacy-trade fallback.
   const usdPerBaseNow = fx[base] ? 1 / fx[base] : undefined;
   const toBase: ToBase = (t, usd) => usd / usdPerBaseAt(t, base, usdPerBaseNow ?? NaN);
   // Without a quote the splits are unknown; assume none until it arrives.
   const sharesToday = (t: Trade) => (quote ? currentShares(t, quote) : t.quantity);

   const { positions, matches } = matchFifo(trades, sharesToday);
   const open = positions.filter((p) => p.remaining > 0);
   const shares = sum(open, (p) => p.remaining);
   const holding: Holding = {
      symbol,
      currency,
      trades,
      positions,
      open,
      quote,
      shares,
      ...openCost(open, shares, toBase),
      sales: [],
      realized: 0,
   };

   holding.issue = ledgerIssue(symbol, trades, currency, matches);

   if (holding.issue) {
      return { holding, flows: [] };
   }

   holding.sales = realize(matches, sharesToday, toBase);
   holding.realized = sum(holding.sales, (s) => s.gain);
   const flows: Flow[] = [
      ...positions.map((p) => ({ t: tradeTime(p.buy.date), amount: -toBase(p.buy, tradeAmountUsd(p.buy)) })),
      ...holding.sales.map((s) => ({ t: tradeTime(s.trade.date), amount: s.proceeds })),
   ];

   // Sold out: nothing to price. Dividends earned while held still need a quote and today's rate.
   const closed = open.length === 0;

   holding.issue = closed ? undefined : pricingIssue(quote, currency, fx, base, usdPerBaseNow);

   if (holding.issue) {
      return { holding, flows: [] };
   }

   // Instrument currency → reporting currency, today; known for every open holding past the check above.
   const rateNow = quote && quote.currency === currency && fx[currency] && usdPerBaseNow ? fx[base]! / fx[currency] : undefined;
   const { valueLocal, pricePl, fxPl } =
      quote && rateNow !== undefined ? marketValue(open, quote.price, rateNow, toBase) : { valueLocal: 0, pricePl: 0, fxPl: 0 };
   const dividends =
      quote && rateNow !== undefined ? dividendsEarned(positions, quote, rateNow, now) : { amountLocal: 0, flows: [], paid: [] };

   flows.push(...dividends.flows);

   const value = rateNow !== undefined ? valueLocal * rateNow : 0;

   flows.push({ t: now, amount: value });
   const start = Math.min(...trades.map((t) => tradeTime(t.date)));

   Object.assign(holding, {
      valueLocal,
      value,
      pl: value - holding.basis,
      pricePl,
      fxPl,
      returnPct: closed ? undefined : ratio(value - holding.basis, holding.basis),
      annualized: now - start >= MIN_ANNUALIZE_MS ? xirr(flows) : undefined,
      dividendsLocal: dividends.amountLocal,
      dividendsPaid: dividends.paid,
      dividends: rateNow !== undefined ? dividends.amountLocal * rateNow : 0,
   } satisfies Partial<Holding>);

   if (!closed) {
      Object.assign(holding, todaysFigures(quote!, shares, rateNow!, now));
   }

   return { holding, flows };
}

/**
 * Values the portfolio in `base`: cost at each buy's trade-date rate, value at
 * today's, realized gains at the sale-date rate. Holdings without a price or
 * FX rate are left out of every total (value and cost alike) so they cannot
 * fake a loss.
 */
export function summarize(
   portfolio: Portfolio,
   quotes: Record<string, Quote>,
   fx: FxRates,
   base: Reporting = BASE,
   now = Date.now(),
): Summary {
   const bySymbol = new Map<string, Trade[]>();

   for (const t of portfolio.trades) {
      bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
   }

   const allFlows: Flow[] = [];
   const holdings: Holding[] = [];

   for (const [symbol, trades] of bySymbol) {
      const { holding, flows } = valueHolding(symbol, trades, quotes[symbol], fx, base, now);

      holdings.push(holding);
      allFlows.push(...flows);
   }

   const priced = holdings.filter((h) => h.value !== undefined);

   const cash: CashRow[] = Object.entries(portfolio.cash).map(([currency, amount]) => {
      const value = convert(amount, currency, base, fx);

      return value !== undefined ? { currency, amount, value } : { currency, amount };
   });

   const invested = sum(priced, (h) => h.value!);
   const cashValue = sum(cash, (c) => c.value ?? 0);
   const total = invested + cashValue;

   for (const h of priced) {
      h.weight = ratio(h.value!, total);
   }

   for (const c of cash) {
      if (c.value !== undefined) {
         c.weight = ratio(c.value, total);
      }
   }

   const byCurrency = new Map<string, number>();

   for (const h of priced) {
      if (h.value! > 0) {
         byCurrency.set(h.currency, (byCurrency.get(h.currency) ?? 0) + h.value!);
      }
   }

   for (const c of cash) {
      if (c.value !== undefined) {
         byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + c.value);
      }
   }

   const exposure = [...byCurrency]
      .map(([currency, value]) => ({ currency, value, weight: ratio(value, total) ?? 0 }))
      .sort((a, b) => b.value - a.value);

   const ranked = priced.filter((h) => h.shares > 0).sort((a, b) => b.value! - a.value!);
   const costBasis = sum(priced, (h) => h.basis);
   const pl = invested - costBasis;
   // An exchange that hasn't opened yet still reports its previous session's change; that isn't today's.
   const day = ranked
      .map((h) => localDay(h.quote!.marketTime))
      .sort()
      .at(-1);
   const dayChange = sum(
      priced.filter((h) => tradedOn(h, day)),
      (h) => h.dayChange ?? 0,
   );
   const start = Math.min(...priced.flatMap((h) => h.trades.map((t) => tradeTime(t.date))));
   // Realized results stand on trade-date rates alone, so they count even while today's price is missing.
   const sales = holdings.flatMap((h) => h.sales).sort((a, b) => a.trade.date.localeCompare(b.trade.date));

   return {
      base,
      holdings,
      cash,
      invested,
      costBasis,
      fees: sum(priced, (h) => h.fees),
      cashValue,
      total,
      pl,
      pricePl: sum(priced, (h) => h.pricePl!),
      fxPl: sum(priced, (h) => h.fxPl!),
      plPct: ratio(pl, costBasis),
      sales,
      realized: sum(sales, (s) => s.gain),
      dividends: sum(priced, (h) => h.dividends!),
      annualized: now - start >= MIN_ANNUALIZE_MS ? xirr(allFlows) : undefined,
      day,
      dayChange,
      dayPct: ratio(dayChange, invested - dayChange),
      exposure,
      largest: ranked[0] && { symbol: ranked[0].symbol, weight: ranked[0].weight ?? 0 },
      top3Weight: ranked.length >= 4 ? sum(ranked.slice(0, 3), (h) => h.weight ?? 0) : undefined,
      excluded: holdings.filter((h) => h.issue).length + cash.filter((c) => c.value === undefined).length,
   };
}
