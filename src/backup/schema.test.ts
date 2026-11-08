import { describe, expect, it } from 'vitest';
import { parsePortfolio, parseSnapshots } from './schema';

describe('parseSnapshots', () => {
   const day = (date: string, totalUsd: number) => ({ date, totalUsd, investedUsd: totalUsd, cashUsd: 0, costUsd: 0 });

   it('drops malformed entries and sorts by date', () => {
      const all = parseSnapshots([day('2026-11-05', 3), { date: 'bad' }, null, day('2026-08-07', 2)]);

      expect(all.map((x) => x.date)).toEqual(['2026-08-07', '2026-11-05']);
   });

   it('keeps only the known fields, so nothing else in a file is stored', () => {
      const [s] = parseSnapshots([
         {
            date: '2026-11-05',
            totalUsd: 1,
            investedUsd: 1,
            cashUsd: 0,
            costUsd: 1,
            eurUsd: 1.1,
            padding: 'x'.repeat(1000),
         },
      ]);

      expect(Object.keys(s!).sort()).toEqual(['cashUsd', 'costUsd', 'date', 'eurUsd', 'investedUsd', 'totalUsd']);
   });
});

describe('parsePortfolio', () => {
   it('names an entry that is not a trade at all', () => {
      for (const entry of [null, 'AAPL', 7]) {
         expect(() => parsePortfolio({ trades: [entry], cash: {} })).toThrow('Trade #1 is malformed');
      }
   });

   describe('migration', () => {
      it('recovers unit price and amount paid on lots saved before they existed', () => {
         const p = parsePortfolio({
            lots: [
               {
                  id: 'u',
                  symbol: 'U',
                  date: '2024-01-02',
                  quantity: 4,
                  currency: 'USD',
                  cost: 400,
                  fees: 0,
                  fxRate: 1,
                  paidIn: 'EUR',
                  eurUsd: 1.25,
               },
               { id: 'e', symbol: 'E', date: '2024-01-02', quantity: 2, currency: 'EUR', cost: 50, fees: 0, fxRate: 1.1 },
            ],
            cash: {},
         });

         expect(p.trades[0]).toMatchObject({ side: 'buy', gross: 400, unitPrice: 100, settled: 320, settledIn: 'EUR' });
         expect(p.trades[1]).toMatchObject({
            side: 'buy',
            gross: 50,
            unitPrice: 25,
            settled: 50,
            settledIn: 'EUR',
            eurUsd: 1.1,
         });
      });
   });

   describe('identifiers', () => {
      const trade = {
         id: 'a',
         side: 'buy',
         symbol: 'NOKIA.HE',
         date: '2024-01-02',
         currency: 'EUR',
         quantity: 1,
         unitPrice: 4,
         gross: 4,
         settled: 4,
         settledIn: 'EUR',
         fees: 1,
         feeCurrency: 'EUR',
         fxRate: 1.1,
         feeFxRate: 1.1,
      };
      const markup = '<img src=x onerror="alert(1)">';

      it('accepts the symbols and currencies Yahoo uses', () => {
         for (const symbol of ['AAPL', 'BRK-B', '^GSPC', 'EURUSD=X', '7203.T']) {
            expect(parsePortfolio({ trades: [{ ...trade, symbol }], cash: { EUR: 1 } }).trades[0]!.symbol).toBe(symbol);
         }
      });

      it('rejects markup in any currency field or cash balance', () => {
         for (const field of ['currency', 'settledIn', 'feeCurrency']) {
            expect(() => parsePortfolio({ trades: [{ ...trade, [field]: markup }], cash: {} })).toThrow(
               'Trade #1 has an invalid currency',
            );
         }

         expect(() => parsePortfolio({ trades: [{ ...trade, paidIn: markup, settledIn: undefined }], cash: {} })).toThrow(
            'invalid currency',
         );
         expect(() => parsePortfolio({ trades: [], cash: { [markup]: 5 } })).toThrow('A cash balance has an invalid currency');
      });

      it('rejects symbols with markup or that name a built-in object property', () => {
         for (const symbol of [markup, 'constructor', '__proto__', 'toString', 'aapl', '']) {
            expect(() => parsePortfolio({ trades: [{ ...trade, symbol }], cash: {} })).toThrow('Trade #1 has an invalid symbol');
         }
      });
   });

   describe('amounts and ids', () => {
      const trade = {
         id: 'a',
         side: 'buy',
         symbol: 'AAA',
         date: '2024-01-02',
         currency: 'USD',
         quantity: 1,
         unitPrice: 4,
         gross: 4,
         settled: 4,
         settledIn: 'USD',
         fees: 1,
         feeCurrency: 'USD',
         fxRate: 1,
         feeFxRate: 1,
      };

      it('applies the trade form’s rules to amounts', () => {
         for (const bad of [
            { gross: 0 },
            { gross: -4 },
            { unitPrice: -1 },
            { settled: 0 },
            { fees: -1 },
            { cost: -1, gross: undefined },
         ]) {
            expect(() => parsePortfolio({ trades: [{ ...trade, ...bad }], cash: {} })).toThrow('Trade #1 has an invalid amount');
         }

         expect(parsePortfolio({ trades: [{ ...trade, fees: 0 }], cash: {} }).trades[0]!.fees).toBe(0);
      });

      it('gives a repeated or missing id a new one, keeping the first', () => {
         const { trades } = parsePortfolio({
            trades: [trade, { ...trade, date: '2024-02-02' }, { ...trade, id: '' }],
            cash: {},
         });

         expect(trades[0]!.id).toBe('a');
         expect(new Set(trades.map((t) => t.id)).size).toBe(3);
      });
   });

   describe('sides', () => {
      it('accepts buy and sell, and rejects any other side', () => {
         const trade = { id: 'a', symbol: 'AAA', date: '2024-01-02', currency: 'USD', quantity: 1, gross: 4, fxRate: 1 };

         expect(parsePortfolio({ trades: [{ ...trade, side: 'sell' }], cash: {} }).trades[0]!.side).toBe('sell');
         expect(() => parsePortfolio({ trades: [{ ...trade, side: 'short' }], cash: {} })).toThrow('Trade #1 is malformed');
      });
   });

   describe('tax paid', () => {
      it('keeps the tax paid per year, and leaves it out of files without it', () => {
         expect(parsePortfolio({ trades: [], cash: {}, taxPaid: { 2024: 812.5, 2025: 0 } }).taxPaid).toEqual({ 2024: 812.5, 2025: 0 });
         expect(parsePortfolio({ trades: [], cash: {} })).not.toHaveProperty('taxPaid');
         expect(parsePortfolio({ trades: [], cash: {}, taxPaid: {} })).not.toHaveProperty('taxPaid');
      });

      it('rejects a year or amount that is not one', () => {
         expect(() => parsePortfolio({ trades: [], cash: {}, taxPaid: { '<b>': 1 } })).toThrow('The tax paid for a year is malformed');
         expect(() => parsePortfolio({ trades: [], cash: {}, taxPaid: { 2024: -1 } })).toThrow('The tax paid for 2024 is malformed');
         expect(() => parsePortfolio({ trades: [], cash: {}, taxPaid: [1] })).toThrow('The tax paid per year is malformed');
      });
   });
});
