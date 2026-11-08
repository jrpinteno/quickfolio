import type { Quote } from './market';
import { DAY, tradeTime } from './time';
import { BASE, type Reporting, type Side, type Trade } from './types';

/** What the trade form collects, before any rate is derived. */
export interface TradeInput {
   side: Side;
   /** Trading currency of the instrument; `unitPrice` is in it. */
   currency: string;
   quantity: number;
   unitPrice: number;
   /** Amount paid or received before fees, in `settledIn`. */
   settled: number;
   /** The instrument's currency, EUR or USD. */
   settledIn: string;
   fees: number;
   /** The instrument's currency, EUR or USD. */
   feeCurrency: string;
}

/** ECB reference rates for the trade date, used for any leg the amounts don't imply. */
export interface ReferenceRates {
   /** USD per 1 EUR. */
   eurUsd: number;
   /** USD per 1 unit of the instrument's currency; 1 for USD. */
   usdPerUnit: number;
}

export type DerivedTrade = Pick<Trade, 'gross' | 'fxRate' | 'eurUsd' | 'feeFxRate'>;

/**
 * Turns the form's amounts into the trade's gross amount and trade-date rates.
 * Buys and sells derive identically: only the direction the money moves differs.
 *
 * When `settledIn` differs from the instrument's currency, the conversion the
 * broker actually applied is `settled` ÷ (quantity × `unitPrice`), and that
 * replaces the reference rate for that leg. Otherwise `settled` is the gross
 * amount and every rate is the reference.
 *
 * - Precondition: `settledIn` is the instrument's currency, EUR or USD; quantity, unit price and settled are positive.
 */
export function deriveTrade(input: TradeInput, ref: ReferenceRates): DerivedTrade {
   const { currency, settledIn } = input;
   const gross = input.quantity * input.unitPrice;
   let amount: number;
   let fxRate: number;
   let eurUsd: number;

   if (settledIn === currency) {
      amount = input.settled;
      fxRate = currency === BASE ? 1 : currency === 'EUR' ? ref.eurUsd : ref.usdPerUnit;
      eurUsd = ref.eurUsd;
   } else {
      amount = gross;
      // `settledIn` per unit of the instrument's currency, as the broker converted it.
      const impliedRate = input.settled / gross;

      if (settledIn === BASE) {
         fxRate = impliedRate;
         eurUsd = currency === 'EUR' ? impliedRate : ref.eurUsd;
      } else {
         // Settled in EUR: the implied rate is EUR per instrument unit.
         eurUsd = currency === BASE ? 1 / impliedRate : ref.eurUsd;
         fxRate = currency === BASE ? 1 : impliedRate * eurUsd;
      }
   }

   const feeFxRate = input.feeCurrency === BASE ? 1 : input.feeCurrency === 'EUR' ? eurUsd : fxRate;

   return { gross: amount, fxRate, eurUsd, feeFxRate };
}

/** EUR/USD implied by the amounts; undefined unless the trade converted between EUR and USD. */
export function impliedEurUsd(input: TradeInput): number | undefined {
   const gross = input.quantity * input.unitPrice;

   if (input.currency === BASE && input.settledIn === 'EUR') {
      return gross / input.settled;
   }

   if (input.currency === 'EUR' && input.settledIn === BASE) {
      return input.settled / gross;
   }

   return undefined;
}

/**
 * The amount settled before fees, from a total that includes them: what a buy cost in all, or what a sale
 * left after fees. Brokers that convert currency often print only that total, with the fees in the
 * instrument's currency (Bankinter: "Total líquido"). `input.settled` is that total.
 *
 * Fees are converted the way `deriveTrade` will convert them, so the trade it builds adds back up to the
 * total: at par in the settlement currency, at the rate the amounts imply when charged in the
 * instrument's currency, and at the reference rate otherwise.
 *
 * - Returns: undefined when the fees would take the total to zero or below, or when the
 *   fees need a reference rate and `ref` is absent.
 */
export function settledBeforeFees(input: TradeInput, ref?: ReferenceRates): number | undefined {
   const { settled: total, fees, feeCurrency, settledIn, currency } = input;
   // A buy's total paid includes the fees; a sale's total received has them deducted.
   const sign = input.side === 'buy' ? 1 : -1;
   let settled: number;

   if (fees === 0 || feeCurrency === settledIn) {
      settled = total - sign * fees;
   } else if (feeCurrency === currency) {
      // The implied rate converts both: total = rate × (gross ± fees), and settled = rate × gross.
      const gross = input.quantity * input.unitPrice;

      settled = (total * gross) / (gross + sign * fees);
   } else if (ref) {
      const usdPer = (c: string) => (c === BASE ? 1 : c === 'EUR' ? ref.eurUsd : ref.usdPerUnit);

      settled = total - (sign * fees * usdPer(feeCurrency)) / usdPer(settledIn);
   } else {
      return undefined;
   }

   return settled > 0 && Number.isFinite(settled) ? settled : undefined;
}

/**
 * What the broker's conversion cost relative to the reference EUR/USD, as a
 * fraction: positive when you paid more, or received less, than at the
 * reference rate; negative when the conversion was in your favour.
 */
export function conversionCost(input: TradeInput, implied: number, refEurUsd: number): number {
   // Buying a USD stock with EUR, a lower implied EUR/USD means more EUR paid.
   // Selling one for EUR, a higher implied EUR/USD means fewer EUR received.
   // EUR stocks settled in USD mirror both.
   const eurLeg = input.settledIn === 'EUR';
   const higherIsWorse = (input.side === 'sell') === eurLeg;

   return higherIsWorse ? implied / refEurUsd - 1 : refEurUsd / implied - 1;
}

/** The trade the form's amounts describe, with its derived rates. */
export function buildTrade(input: TradeInput, ref: ReferenceRates, symbol: string, date: string, id: string): Trade {
   const derived = deriveTrade(input, ref);

   return {
      id,
      side: input.side,
      symbol,
      date,
      quantity: input.quantity,
      currency: input.currency,
      unitPrice: input.unitPrice,
      gross: derived.gross,
      settled: input.settled,
      settledIn: input.settledIn,
      fees: input.fees,
      feeCurrency: input.feeCurrency,
      fxRate: derived.fxRate,
      feeFxRate: derived.feeFxRate,
      eurUsd: derived.eurUsd,
   };
}

// Corporate events are stamped at the session open on their effective date, so
// a trade only interacts with events from the day after its trade date onwards:
// buying on the ex-date earns no dividend, selling on it keeps the dividend,
// and shares traded on a split date are already post-split shares.
export const affectedFrom = (t: Trade) => tradeTime(t.date) + DAY;

/** A trade's fees in USD at the trade-date rate of the currency they were charged in. */
export const tradeFeesUsd = (t: Trade) => t.fees * t.feeFxRate;
/** A trade's fees in the instrument's currency, crossed through USD at trade-date rates. */
export const tradeFeesLocal = (t: Trade) => (t.feeCurrency === t.currency ? t.fees : tradeFeesUsd(t) / t.fxRate);
/**
 * Money that left (buy: cost basis, fees included) or arrived (sell: proceeds
 * net of fees) with the trade, in USD at trade-date rates.
 */
export const tradeAmountUsd = (t: Trade) => t.gross * t.fxRate + (t.side === 'buy' ? 1 : -1) * tradeFeesUsd(t);
/** `tradeAmountUsd` in the instrument's currency. */
export const tradeAmountLocal = (t: Trade) => t.gross + (t.side === 'buy' ? 1 : -1) * tradeFeesLocal(t);

/**
 * USD per unit of the reporting currency on the trade date. `fallback`
 * (today's rate) covers only legacy USD trades whose EUR/USD has not been backfilled yet.
 */
export function usdPerBaseAt(t: Trade, base: Reporting, fallback: number): number {
   if (base === BASE) {
      return 1;
   }

   return t.eurUsd ?? fallback;
}

/** Shares a trade represents today, after the splits that followed its trade date. */
export function currentShares(t: Trade, quote: Quote): number {
   const from = affectedFrom(t);

   return quote.splits.reduce((n, s) => (s.date >= from ? n * s.ratio : n), t.quantity);
}
