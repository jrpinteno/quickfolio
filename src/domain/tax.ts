// Spanish income tax on savings (IRPF, "base imponible del ahorro"), as an estimate.
// Pure functions over EUR amounts per calendar year; nothing here knows about trades or quotes.

/** Tax systems the dashboard can estimate. */
export const TAX_REGIMES = ['ES'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

/** A bracket: the rate applies to the part of the base up to `upTo` (EUR) above the previous bracket. */
interface Bracket {
   upTo: number;
   rate: number;
}

/**
 * Savings-base brackets, state and regional parts combined, by the first year they applied.
 * 2016: Ley 26/2014. 2021: Ley 11/2020 (26% above 200,000). 2023: Ley 31/2022 (27% and 28%).
 * 2025: Ley 7/2024 (30% above 300,000).
 */
const SPAIN_BRACKETS: { from: number; brackets: Bracket[] }[] = [
   {
      from: 2016,
      brackets: [
         { upTo: 6_000, rate: 0.19 },
         { upTo: 50_000, rate: 0.21 },
         { upTo: Infinity, rate: 0.23 },
      ],
   },
   {
      from: 2021,
      brackets: [
         { upTo: 6_000, rate: 0.19 },
         { upTo: 50_000, rate: 0.21 },
         { upTo: 200_000, rate: 0.23 },
         { upTo: Infinity, rate: 0.26 },
      ],
   },
   {
      from: 2023,
      brackets: [
         { upTo: 6_000, rate: 0.19 },
         { upTo: 50_000, rate: 0.21 },
         { upTo: 200_000, rate: 0.23 },
         { upTo: 300_000, rate: 0.27 },
         { upTo: Infinity, rate: 0.28 },
      ],
   },
   {
      from: 2025,
      brackets: [
         { upTo: 6_000, rate: 0.19 },
         { upTo: 50_000, rate: 0.21 },
         { upTo: 200_000, rate: 0.23 },
         { upTo: 300_000, rate: 0.27 },
         { upTo: Infinity, rate: 0.3 },
      ],
   },
];

/** Years a loss on selling can still be set against later gains, after the year it was made. */
const LOSS_CARRY_YEARS = 4;
/** Share of the year's dividends and interest that losses on selling may reduce. */
const CROSS_OFFSET = 0.25;

/**
 * Tax on a savings base in a year, through that year's brackets. Years before
 * 2016 use the 2016 brackets, and later years the latest ones known.
 */
export function spainSavingsTax(year: number, base: number): number {
   const { brackets } = [...SPAIN_BRACKETS].reverse().find((b) => year >= b.from) ?? SPAIN_BRACKETS[0]!;
   let tax = 0;
   let lower = 0;

   for (const { upTo, rate } of brackets) {
      if (base <= lower) {
         break;
      }

      tax += (Math.min(base, upTo) - lower) * rate;
      lower = upTo;
   }

   return tax;
}

/** One calendar year of the estimate. Amounts in EUR. */
export interface TaxYear {
   year: number;
   /** Net result of the year's sales: gains less losses. */
   gains: number;
   /** Gross dividends with an ex-date in the year. */
   dividends: number;
   /** Losses from earlier years set against this year's gains and dividends. */
   carriedIn: number;
   /** What was taxed after setting losses off. */
   base: number;
   /** The tax these rules give. */
   estimate: number;
   /** The tax paid as filed, when it was entered. */
   paid?: number;
   /** `paid` when known, else `estimate`. */
   tax: number;
   /** What was left after tax: gains plus dividends less tax. */
   kept: number;
}

export interface TaxEstimate {
   years: TaxYear[];
   /** Losses not yet set off, still usable in later years. */
   lossesLeft: number;
   /** What selling every holding today would add: the unrealized result and its tax on top of this year's. */
   ifSoldToday: { gains: number; tax: number; kept: number };
   /** Totals over every year, and today's unrealized result after its tax. */
   total: { gains: number; dividends: number; tax: number; kept: number };
}

/** A loss on selling still waiting to be set off, with the year it was made. */
interface CarriedLoss {
   year: number;
   amount: number;
}

/**
 * One year under the savings-base rules: the year's gains and losses net out; earlier losses (up to four
 * years old, oldest first) reduce a net gain; a net loss, and earlier losses left over, reduce the year's
 * dividends by up to 25% of them; what is still left carries forward. Returns the year and the losses
 * carried out of it.
 */
function taxYear(year: number, gains: number, dividends: number, carried: CarriedLoss[]): [TaxYear, CarriedLoss[]] {
   const pending = carried.filter((l) => year - l.year <= LOSS_CARRY_YEARS).map((l) => ({ ...l }));
   let gainsBase = gains;
   let dividendBase = dividends;
   let crossLeft = Math.max(dividends, 0) * CROSS_OFFSET;
   let carriedIn = 0;

   for (const loss of pending) {
      const used = Math.min(loss.amount, Math.max(gainsBase, 0));

      loss.amount -= used;
      gainsBase -= used;
      carriedIn += used;
   }

   if (gainsBase < 0) {
      const used = Math.min(-gainsBase, crossLeft);

      dividendBase -= used;
      crossLeft -= used;
      pending.push({ year, amount: -gainsBase - used });
      gainsBase = 0;
   }

   for (const loss of pending.filter((l) => l.year < year)) {
      const used = Math.min(loss.amount, crossLeft);

      loss.amount -= used;
      dividendBase -= used;
      crossLeft -= used;
      carriedIn += used;
   }

   const base = gainsBase + Math.max(dividendBase, 0);
   const estimate = spainSavingsTax(year, base);
   const kept = gains + dividends - estimate;

   return [{ year, gains, dividends, carriedIn, base, estimate, tax: estimate, kept }, pending.filter((l) => l.amount > 0.005)];
}

/**
 * Estimates the savings tax on a portfolio's results year by year, and what selling everything today would add.
 * It assumes these are the only savings income: bank interest, funds or crypto taxed in the same base would
 * raise the brackets reached and use up losses differently.
 *
 * - Parameters:
 *   - gains: Net realized result per calendar year, EUR.
 *   - dividends: Gross dividends per calendar year, EUR.
 *   - unrealized: Today's unrealized result of the holdings, EUR.
 *   - thisYear: The current year, taxed with `unrealized` added for the "if sold today" figure.
 *   - paid: Tax paid per year as filed, EUR; it replaces that year's estimate. Losses carried between years
 *     still follow the rules, since a return doesn't say which of its losses came from this portfolio.
 */
export function estimateSpainTax(
   gains: Record<number, number>,
   dividends: Record<number, number>,
   unrealized: number,
   thisYear: number,
   paid: Record<number, number> = {},
): TaxEstimate {
   const known = [...Object.keys(gains), ...Object.keys(dividends), ...Object.keys(paid)].map(Number);
   const first = Math.min(thisYear, ...known);
   const years: TaxYear[] = [];
   let carried: CarriedLoss[] = [];
   let before: CarriedLoss[] = [];

   for (let year = first; year <= thisYear; year++) {
      before = carried;
      const [y, out] = taxYear(year, gains[year] ?? 0, dividends[year] ?? 0, carried);

      carried = out;
      const filed = paid[year];

      if (filed !== undefined) {
         Object.assign(y, { paid: filed, tax: filed, kept: y.gains + y.dividends - filed });
      }

      if (y.gains !== 0 || y.dividends !== 0 || filed !== undefined) {
         years.push(y);
      }
   }

   // Selling today adds to this year's result; the tax it costs is the difference it makes.
   const current = years.find((y) => y.year === thisYear);
   const [withSale] = taxYear(thisYear, (gains[thisYear] ?? 0) + unrealized, dividends[thisYear] ?? 0, before);
   const saleTax = withSale.estimate - (current?.estimate ?? 0);
   const sum = (f: (y: TaxYear) => number) => years.reduce((n, y) => n + f(y), 0);
   const ifSoldToday = { gains: unrealized, tax: saleTax, kept: unrealized - saleTax };

   return {
      years,
      lossesLeft: carried.reduce((n, l) => n + l.amount, 0),
      ifSoldToday,
      total: {
         gains: sum((y) => y.gains),
         dividends: sum((y) => y.dividends),
         tax: sum((y) => y.tax),
         kept: sum((y) => y.kept) + ifSoldToday.kept,
      },
   };
}
