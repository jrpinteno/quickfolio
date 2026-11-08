import { describe, expect, it } from 'vitest';
import type { StoredChange } from '../backup/stored';
import type { MarketData } from '../domain/market';
import { lot, quote } from '../test/fixtures';
import { loadKept, persistChanges, saveErrorText } from './persist';
import type { MarketCache, PortfolioRepository, SaveResult } from './ports';
import { initialView, type AppState } from './state';
import { createStore } from './store';

const aaa = lot({ symbol: 'AAA', quantity: 10, gross: 500 });
const market: MarketData = { quotes: { AAA: quote('AAA', 'USD', 60) }, fx: { USD: 1 } };

const state = (): AppState => ({
   portfolio: { trades: [aaa], cash: {} },
   market,
   snapshots: [],
   status: { refreshing: false, failed: new Map() },
   view: initialView({ hideAmounts: false }),
});

/** Storage that records every save and answers with `results` in turn, then with success. */
function fakeStorage(results: SaveResult[] = []) {
   const saves: StoredChange[] = [];
   const cached: MarketData[] = [];
   let announce: (change: StoredChange) => void = () => undefined;
   const repository: PortfolioRepository = {
      load: async () => ({
         portfolio: { trades: [aaa], cash: {} },
         snapshots: [],
         backupReminderDismissed: false,
         warning: 'unreadable',
      }),
      save: async (change) => (saves.push(change), results.shift() ?? { ok: true }),
      onSavedElsewhere: (listener) => ((announce = listener), () => undefined),
   };
   const cache: MarketCache = { load: async () => market, save: async (m) => void cached.push(m) };

   return { persistence: { repository, cache }, saves, cached, saveElsewhere: (change: StoredChange) => announce(change) };
}

/** Lets settled saves report back. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('loadKept', () => {
   it('starts the store from what the repository and the cache kept', async () => {
      const { persistence } = fakeStorage();

      expect(await loadKept(persistence)).toEqual({
         portfolio: { trades: [aaa], cash: {} },
         snapshots: [],
         backupReminderDismissed: false,
         market,
         storageWarning: 'unreadable',
      });
   });
});

describe('persistChanges', () => {
   it('saves only what changed, and the market to the cache', () => {
      const store = createStore(state());
      const { persistence, saves, cached } = fakeStorage();

      persistChanges(store, persistence, () => undefined);
      store.update((s) => ({ ...s, view: { ...s.view, range: '1M' } }));
      expect(saves).toEqual([]);

      store.update((s) => ({ ...s, portfolio: { ...s.portfolio, cash: { EUR: 5 } }, backupReminderDismissed: true }));
      expect(saves).toEqual([{ portfolio: { trades: [aaa], cash: { EUR: 5 } }, backupReminderDismissed: true }]);
      expect(cached).toEqual([]);

      const next = { ...market, refreshedAt: 1 };

      store.update((s) => ({ ...s, market: next }));
      // A market change alone still retries what an earlier save couldn't store.
      expect(saves.at(-1)).toEqual({});
      expect(cached).toEqual([next]);
   });

   it('reports what could not be saved until a save stores it', async () => {
      const store = createStore(state());
      const { persistence } = fakeStorage([{ ok: false, reason: 'full', unsaved: ['portfolio'] }]);

      persistChanges(store, persistence, () => undefined);
      store.update((s) => ({ ...s, portfolio: { ...s.portfolio, cash: { EUR: 5 } } }));
      await flush();
      expect(store.get().saveError).toContain('trades and cash could not be saved');

      store.update((s) => ({ ...s, snapshots: [] }));
      await flush();
      expect(store.get().saveError).toBeUndefined();
   });

   it('adopts what is saved elsewhere without saving it back, and fetches a stock it has no price for', () => {
      const store = createStore(state());
      const { persistence, saves, saveElsewhere } = fakeStorage();
      let refreshes = 0;

      persistChanges(store, persistence, () => refreshes++);
      saveElsewhere({ portfolio: { trades: [aaa], cash: { EUR: 7 } } });
      expect(store.get().portfolio.cash).toEqual({ EUR: 7 });
      expect(saves).toEqual([]);
      expect(refreshes).toBe(0);

      const bbb = lot({ symbol: 'BBB', quantity: 1, gross: 10 });

      saveElsewhere({ portfolio: { trades: [aaa, bbb], cash: {} } });
      expect(refreshes).toBe(1);

      // The next change made here is saved as usual.
      store.update((s) => ({ ...s, portfolio: { ...s.portfolio, cash: { EUR: 1 } } }));
      expect(saves).toEqual([{ portfolio: { trades: [aaa, bbb], cash: { EUR: 1 } } }]);
   });
});

describe('saveErrorText', () => {
   it('names everything that could not be saved', () => {
      expect(saveErrorText({ ok: true })).toBeUndefined();
      expect(saveErrorText({ ok: false, reason: 'full', unsaved: ['portfolio', 'snapshots'] })).toContain(
         'your latest trades and cash and daily history could not be saved',
      );
      expect(saveErrorText({ ok: false, reason: 'protected' })).toContain('not being saved');
   });
});
