import { describe, expect, it } from 'vitest';
import { estimateSpainTax, spainSavingsTax } from './tax';

describe('spainSavingsTax', () => {
   it('taxes each slice of the base at its own rate', () => {
      // 6,000 at 19% + 4,000 at 21%.
      expect(spainSavingsTax(2024, 10_000)).toBeCloseTo(1_980);
      expect(spainSavingsTax(2024, 0)).toBe(0);
   });

   it("uses the brackets of the base's year", () => {
      // Up to 50,000: 1,140 + 9,240; then 23% to 200,000, and the top brackets differ by year.
      expect(spainSavingsTax(2020, 400_000)).toBeCloseTo(1_140 + 9_240 + 80_500);
      expect(spainSavingsTax(2022, 400_000)).toBeCloseTo(1_140 + 9_240 + 34_500 + 52_000);
      expect(spainSavingsTax(2024, 400_000)).toBeCloseTo(1_140 + 9_240 + 34_500 + 27_000 + 28_000);
      expect(spainSavingsTax(2025, 400_000)).toBeCloseTo(1_140 + 9_240 + 34_500 + 27_000 + 30_000);
      expect(spainSavingsTax(2010, 10_000)).toBeCloseTo(spainSavingsTax(2016, 10_000));
   });
});

describe('estimateSpainTax', () => {
   it('sets a loss against a quarter of the dividends, then carries the rest to later gains', () => {
      const e = estimateSpainTax({ 2024: -5_000, 2025: 10_000 }, { 2024: 1_000 }, 0, 2025);
      const [y2024, y2025] = e.years;

      // 2024: 250 of the loss reduces the dividends; 4,750 carries forward.
      expect(y2024).toMatchObject({ year: 2024, base: 750, carriedIn: 0 });
      expect(y2024!.tax).toBeCloseTo(142.5);
      expect(y2024!.kept).toBeCloseTo(-5_000 + 1_000 - 142.5);
      // 2025: 10,000 less the 4,750 carried.
      expect(y2025).toMatchObject({ year: 2025, base: 5_250, carriedIn: 4_750 });
      expect(y2025!.tax).toBeCloseTo(997.5);
      expect(e.lossesLeft).toBe(0);
   });

   it('lets an earlier loss reduce a later year of dividends only', () => {
      const e = estimateSpainTax({ 2024: -2_000 }, { 2025: 4_000 }, 0, 2025);

      expect(e.years[1]).toMatchObject({ year: 2025, base: 3_000, carriedIn: 1_000 });
      expect(e.lossesLeft).toBe(1_000);
   });

   it('drops losses more than four years old', () => {
      expect(estimateSpainTax({ 2019: -1_000, 2023: 1_000 }, {}, 0, 2023).years[1]!.tax).toBe(0);
      expect(estimateSpainTax({ 2019: -1_000, 2024: 1_000 }, {}, 0, 2024).years[1]!.tax).toBeCloseTo(190);
   });

   it("prices selling today on top of this year's result", () => {
      // 5,000 realized this year costs 950; 15,000 would cost 1,140 + 1,890.
      const e = estimateSpainTax({ 2026: 5_000 }, {}, 10_000, 2026);

      expect(e.years[0]!.tax).toBeCloseTo(950);
      expect(e.ifSoldToday.tax).toBeCloseTo(3_030 - 950);
      expect(e.ifSoldToday.kept).toBeCloseTo(10_000 - 2_080);
      expect(e.total.kept).toBeCloseTo(5_000 - 950 + 10_000 - 2_080);
   });

   it('uses the tax paid as filed in place of the estimate, keeping the estimate to compare', () => {
      // A return's savings base can hold more than this portfolio: what was filed wins.
      const e = estimateSpainTax({ 2024: 10_000, 2025: 2_000 }, {}, 0, 2026, { 2024: 2_300, 2023: 0 });
      const y2024 = e.years.find((y) => y.year === 2024)!;

      expect(y2024).toMatchObject({ paid: 2_300, tax: 2_300, kept: 7_700 });
      expect(y2024.estimate).toBeCloseTo(1_980);
      const y2025 = e.years.find((y) => y.year === 2025)!;

      expect(y2025.paid).toBeUndefined();
      expect(y2025.tax).toBeCloseTo(380);
      // A year filed with nothing from the portfolio still shows, so the entry can be seen and removed.
      expect(e.years.find((y) => y.year === 2023)).toMatchObject({ gains: 0, paid: 0 });
      expect(e.total.tax).toBeCloseTo(2_300 + 380);
   });

   it('counts an unrealized loss as tax saved against this year', () => {
      const e = estimateSpainTax({ 2026: 5_000 }, {}, -2_000, 2026);

      expect(e.ifSoldToday.tax).toBeCloseTo(-380);
   });
});
