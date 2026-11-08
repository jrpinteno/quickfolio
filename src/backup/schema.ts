// Validation and upgrade of untrusted data: what the browser has stored and what an export file contains.
// Every format version ever written must keep parsing here.
import { isCurrencyCode, isFiniteNumber, isIsoDate, isSymbol, isYear } from '../domain/codes';
import type { Snapshot } from '../domain/snapshots';
import type { Portfolio, Side, Trade } from '../domain/types';

/** An object read from untrusted JSON: any field may be missing or of any type until it is checked. */
type Unchecked<T> = { [K in keyof T]?: unknown };

/** Stored or exported trades, including fields from older versions of the format. */
type RawTrade = Unchecked<Trade> & {
   // Before sales existed: trades were "lots", every one a buy.
   cost?: unknown;
   paid?: unknown;
   paidIn?: unknown;
};

/**
 * Validates untrusted JSON (stored in the browser or an imported file) as a portfolio.
 * Accepts every earlier format: `lots` (buys only) as well as `trades`.
 * Amounts follow the trade form's rules. A trade whose id is missing or
 * repeats an earlier one gets a new id, since edits and deletes act by id.
 */
export function parsePortfolio(data: unknown): Portfolio {
   const d = data as { trades?: unknown; lots?: unknown; cash?: unknown; taxPaid?: unknown } | null;
   const list = d?.trades ?? d?.lots;

   if (!d || !Array.isArray(list) || typeof d.cash !== 'object' || d.cash === null) {
      throw new Error('Not a QuickFolio export');
   }

   const ids = new Set<string>();
   const trades: Trade[] = (list as unknown[]).map((item, i) => {
      if (typeof item !== 'object' || item === null) {
         throw new Error(`Trade #${i + 1} is malformed`);
      }

      const t = item as RawTrade;
      const gross = isFiniteNumber(t.gross) ? t.gross : t.cost;
      const side: Side | undefined = t.side === undefined ? 'buy' : t.side === 'buy' || t.side === 'sell' ? t.side : undefined;

      if (
         !side ||
         typeof t.symbol !== 'string' ||
         typeof t.currency !== 'string' ||
         !isIsoDate(t.date) ||
         !isFiniteNumber(t.quantity) ||
         t.quantity <= 0 ||
         !isFiniteNumber(gross) ||
         !isFiniteNumber(t.fxRate) ||
         t.fxRate <= 0
      ) {
         throw new Error(`Trade #${i + 1} is malformed`);
      }

      if (!isSymbol(t.symbol)) {
         throw new Error(`Trade #${i + 1} has an invalid symbol`);
      }

      // Fee and settlement currencies may be absent (older formats) but never malformed.
      const currencies = [t.currency, t.feeCurrency, t.settledIn, t.paidIn].filter((c) => c != null);

      if (!currencies.every(isCurrencyCode)) {
         throw new Error(`Trade #${i + 1} has an invalid currency`);
      }

      // The same rules as the trade form: positive amounts, fees zero or more. Absent ones are recovered below.
      const positive = (v: unknown) => !isFiniteNumber(v) || v > 0;

      if (gross <= 0 || !positive(t.unitPrice) || !positive(t.settled) || !positive(t.paid) || (isFiniteNumber(t.fees) && t.fees < 0)) {
         throw new Error(`Trade #${i + 1} has an invalid amount`);
      }

      const id = typeof t.id === 'string' && t.id !== '' && !ids.has(t.id) ? t.id : crypto.randomUUID();

      ids.add(id);
      const trade: Omit<Trade, 'unitPrice' | 'settled'> = {
         id,
         side,
         symbol: t.symbol,
         date: t.date,
         quantity: t.quantity,
         currency: t.currency,
         gross,
         fees: isFiniteNumber(t.fees) ? t.fees : 0,
         fxRate: t.fxRate,
         // Trades saved before fee currencies existed had fees in the instrument's currency.
         ...(isCurrencyCode(t.feeCurrency) && isFiniteNumber(t.feeFxRate) && t.feeFxRate > 0
            ? { feeCurrency: t.feeCurrency, feeFxRate: t.feeFxRate }
            : { feeCurrency: t.currency, feeFxRate: t.fxRate }),
         // Older trades: assume settled in their own currency; a EUR trade's rate is its EUR/USD.
         settledIn: isCurrencyCode(t.settledIn) ? t.settledIn : isCurrencyCode(t.paidIn) ? t.paidIn : t.currency,
         eurUsd: isFiniteNumber(t.eurUsd) && t.eurUsd > 0 ? t.eurUsd : t.currency === 'EUR' ? t.fxRate : undefined,
      };
      // Older trades stored only the total; recover price per share and the settled amount.
      const usdPerSettled = trade.settledIn === 'USD' ? 1 : trade.settledIn === trade.currency ? trade.fxRate : trade.eurUsd;
      const settled = isFiniteNumber(t.settled) ? t.settled : isFiniteNumber(t.paid) ? t.paid : undefined;

      return {
         ...trade,
         unitPrice: isFiniteNumber(t.unitPrice) ? t.unitPrice : trade.gross / trade.quantity,
         settled: settled ?? (usdPerSettled ? (trade.gross * trade.fxRate) / usdPerSettled : trade.gross),
      };
   });
   const cash: Record<string, number> = {};

   for (const [currency, amount] of Object.entries(d.cash)) {
      if (!isCurrencyCode(currency)) {
         throw new Error('A cash balance has an invalid currency');
      }

      if (!isFiniteNumber(amount)) {
         throw new Error(`Cash balance for ${currency} is malformed`);
      }

      cash[currency] = amount;
   }

   const taxPaid = parseTaxPaid(d.taxPaid);

   return taxPaid ? { trades, cash, taxPaid } : { trades, cash };
}

/** Tax paid per year: absent in files written before it existed; never malformed in those that have it. */
function parseTaxPaid(data: unknown): Record<string, number> | undefined {
   if (data === undefined) {
      return undefined;
   }

   if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('The tax paid per year is malformed');
   }

   const out: Record<string, number> = {};

   for (const [year, amount] of Object.entries(data)) {
      if (!isYear(year) || !isFiniteNumber(amount) || amount < 0) {
         throw new Error(`The tax paid for ${isYear(year) ? year : 'a year'} is malformed`);
      }

      out[year] = amount;
   }

   return Object.keys(out).length ? out : undefined;
}

/**
 * Validates untrusted JSON as snapshots, dropping malformed entries. Only the
 * known fields are copied, so nothing else in a file is stored or exported again.
 */
export function parseSnapshots(data: unknown): Snapshot[] {
   if (!Array.isArray(data)) {
      return [];
   }

   return (data as (Unchecked<Snapshot> | null)[])
      .filter(
         (s): s is Snapshot =>
            isIsoDate(s?.date) &&
            isFiniteNumber(s.totalUsd) &&
            isFiniteNumber(s.investedUsd) &&
            isFiniteNumber(s.cashUsd) &&
            isFiniteNumber(s.costUsd),
      )
      .map((s) => ({
         date: s.date,
         totalUsd: s.totalUsd,
         investedUsd: s.investedUsd,
         cashUsd: s.cashUsd,
         costUsd: s.costUsd,
         ...(isFiniteNumber(s.costEur) ? { costEur: s.costEur } : {}),
         ...(isFiniteNumber(s.eurUsd) && s.eurUsd > 0 ? { eurUsd: s.eurUsd } : {}),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
}
