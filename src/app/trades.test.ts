import { describe, expect, it } from 'vitest';
import type { TradeInput } from '../domain/trade';
import { lot, quote, sell } from '../test/fixtures';
import { initialView, type AppState, type AppStore } from './state';
import { createStore } from './store';
import { commitTrade, prepareTrade, previewSale, type TradeDraft } from './trades';

const rates = { getReferenceRates: async () => ({ eurUsd: 1.25, usdPerUnit: 1 }) };
const aaa = quote('AAA', 'USD', 60);

const state = (trades = [lot({ symbol: 'AAA', quantity: 10, gross: 500, date: '2026-01-02' })]): AppState => ({
   portfolio: { trades, cash: {} },
   market: { quotes: { AAA: aaa }, fx: { USD: 1, EUR: 0.8 } },
   snapshots: [],
   status: { refreshing: false, failed: new Map() },
   view: initialView({ hideAmounts: false }),
});

const input = (extra: Partial<TradeInput> = {}): TradeInput => ({
   side: 'sell',
   currency: 'USD',
   quantity: 4,
   unitPrice: 60,
   settled: 240,
   settledIn: 'USD',
   fees: 0,
   feeCurrency: 'USD',
   ...extra,
});
const draft = (extra: Partial<TradeInput> = {}, date = '2026-03-02'): TradeDraft => ({
   input: input(extra),
   quote: aaa,
   date,
});

describe('commitTrade', () => {
   const prepared = async (store: AppStore, d: TradeDraft, id: string) => {
      const result = await prepareTrade(store.get(), d, id, rates);

      if (!('trade' in result)) {
         throw new Error(`Not prepared: ${result.problem.kind}`);
      }

      return result.trade;
   };
   const ids = (store: AppStore) => store.get().portfolio.trades.map((t) => t.id);

   it('keeps trades saved while the trade was being prepared', async () => {
      const store = createStore(state());
      const trade = await prepared(store, draft(), 'new');
      const elsewhere = lot({ symbol: 'AAA', quantity: 1, gross: 50, date: '2026-02-02' });

      store.update((s) => ({ ...s, portfolio: { ...s.portfolio, trades: [...s.portfolio.trades, elsewhere] } }));
      commitTrade(store, trade, undefined, aaa);
      expect(ids(store)).toEqual(['buy-AAA-2026-01-02', 'buy-AAA-2026-02-02', 'new']);
   });

   it('keeps an edit of a trade removed meanwhile as a new trade', async () => {
      const trades = [
         lot({ symbol: 'AAA', quantity: 10, gross: 500, date: '2026-01-02' }),
         sell({ symbol: 'AAA', quantity: 2, gross: 120, date: '2026-02-02' }),
      ];
      const store = createStore(state(trades));
      const edit = await prepared(
         store,
         { ...draft({ quantity: 3, settled: 180 }), replacing: 'sell-AAA-2026-02-02' },
         'sell-AAA-2026-02-02',
      );

      store.update((s) => ({ ...s, portfolio: { ...s.portfolio, trades: [trades[0]!] } }));
      commitTrade(store, edit, 'sell-AAA-2026-02-02', aaa);
      expect(store.get().portfolio.trades.map((t) => [t.id, t.quantity])).toEqual([
         ['buy-AAA-2026-01-02', 10],
         ['sell-AAA-2026-02-02', 3],
      ]);
   });
});

describe('prepareTrade', () => {
   it('adds a valid sale to the ledger', async () => {
      const result = await prepareTrade(state(), draft(), 'new', rates);

      expect('trades' in result && result.trades.map((t) => t.id)).toEqual(['buy-AAA-2026-01-02', 'new']);
   });

   it('refuses a sale of more shares than were held', async () => {
      const result = await prepareTrade(state(), draft({ quantity: 11, settled: 660 }), 'new', rates);

      expect('problem' in result && result.problem.kind).toBe('oversold');
   });

   it('refuses an edit to a purchase that leaves a later sale short', async () => {
      const trades = [
         lot({ symbol: 'AAA', quantity: 10, gross: 500, date: '2026-01-02' }),
         sell({ symbol: 'AAA', quantity: 8, gross: 480, date: '2026-02-02' }),
      ];
      const edit: TradeDraft = {
         ...draft({ side: 'buy', quantity: 5, settled: 250 }, '2026-01-02'),
         replacing: 'buy-AAA-2026-01-02',
      };
      const result = await prepareTrade(state(trades), edit, 'buy-AAA-2026-01-02', rates);

      expect('problem' in result && result.problem.kind).toBe('oversold');
   });

   it('refuses a symbol whose currency differs from its earlier trades', async () => {
      const result = await prepareTrade(state(), { ...draft({ currency: 'EUR', settledIn: 'EUR' }) }, 'new', rates);

      expect('problem' in result && result.problem).toEqual({ kind: 'currency', recorded: 'USD' });
   });

   it('refuses amounts that imply an implausible EUR/USD', async () => {
      // $240 settled for €100 implies 2.40 USD per EUR against the reference 1.25.
      const result = await prepareTrade(state(), draft({ settledIn: 'EUR', settled: 100 }), 'new', rates);

      expect('problem' in result && result.problem.kind).toBe('rate');
   });

   it('refuses a trade that would not load again, such as one whose rates are not numbers', async () => {
      const eur = quote('EUR1', 'EUR', 5);
      const badRates = { getReferenceRates: async () => ({ eurUsd: '1.25' as unknown as number, usdPerUnit: 1.25 }) };
      const d: TradeDraft = {
         input: input({
            side: 'buy',
            currency: 'EUR',
            settledIn: 'EUR',
            feeCurrency: 'EUR',
            quantity: 1,
            unitPrice: 5,
            settled: 5,
         }),
         quote: eur,
         date: '2026-03-02',
      };
      const result = await prepareTrade(state([]), d, 'new', badRates);

      expect('problem' in result && result.problem.kind).toBe('invalid');
   });
});

describe('previewSale', () => {
   it('shows the gain the sale would realize against the oldest purchase', () => {
      const result = previewSale(state(), draft(), { eurUsd: 1.25, usdPerUnit: 1 });

      // 4 shares bought at $50 and sold at $60.
      expect('sale' in result && result.sale?.gain).toBeCloseTo(40);
   });
});
