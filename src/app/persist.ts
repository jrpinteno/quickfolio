// Keeps storage in step with the store: what is kept is loaded once, every change is saved, and what is saved
// elsewhere is adopted. The storage itself is behind the ports, so this works the same whatever keeps the data.
import type { StoredChange } from '../backup/stored';
import type { MarketCache, PortfolioRepository, SaveResult } from './ports';
import type { AppState, AppStore } from './state';

export interface Persistence {
   repository: PortfolioRepository;
   cache: MarketCache;
}

/** The part of the store's state that comes from storage; the rest starts from defaults. */
type Loaded = Pick<AppState, 'portfolio' | 'snapshots' | 'market' | 'lastExport' | 'backupReminderDismissed' | 'storageWarning'>;

/** The store's first state from what is kept. */
export async function loadKept({ repository, cache }: Persistence): Promise<Loaded> {
   const [{ warning, ...kept }, market] = await Promise.all([repository.load(), cache.load()]);

   return { ...kept, market, storageWarning: warning };
}

/** The banner for a save that didn't store everything; undefined once everything is stored. */
export function saveErrorText(result: SaveResult): string | undefined {
   if (result.ok) {
      return undefined;
   }

   switch (result.reason) {
      case 'protected':
         return (
            'Changes to trades and cash are not being saved: your earlier saved trades could not be read, ' +
            'and there is no room to keep a copy of them. Free up space in this browser’s storage and reload.'
         );

      case 'full': {
         const lost = result.unsaved.map((w) => (w === 'portfolio' ? 'trades and cash' : 'daily history'));

         return (
            `Browser storage is full, so your latest ${lost.join(' and ')} could not be saved and will be lost when the page reloads. ` +
            'Export a backup now.'
         );
      }
   }
}

/**
 * Saves every change to what is kept, and adopts what is saved elsewhere.
 *
 * Every tab holds the data in memory and saves all of it on a change, so a tab that missed another's save
 * would write its older copy over it; adopting it instead avoids that. What is adopted is already stored,
 * so it isn't saved back. The market cache isn't shared: each tab refreshes its own.
 *
 * - Parameter refresh: Called when adopted trades include a stock this tab has no price for.
 */
export function persistChanges(store: AppStore, { repository, cache }: Persistence, refresh: () => void): void {
   // The state an adoption produced; an update made while subscribers react to it is still saved.
   let adopted: AppState | undefined;

   store.subscribe((s, prev) => {
      if (s === adopted) {
         return;
      }

      const change: StoredChange = {};

      if (s.portfolio !== prev.portfolio) {
         change.portfolio = s.portfolio;
      }

      if (s.snapshots !== prev.snapshots) {
         change.snapshots = s.snapshots;
      }

      if (s.lastExport !== prev.lastExport) {
         change.lastExport = s.lastExport;
      }

      if (s.backupReminderDismissed !== prev.backupReminderDismissed) {
         change.backupReminderDismissed = s.backupReminderDismissed === true;
      }

      const marketChanged = s.market !== prev.market;

      if (Object.keys(change).length === 0 && !marketChanged) {
         return;
      }

      // Saved first, as it can't be fetched again; a market change alone still retries what an earlier save couldn't store.
      // The outcome is reported in a later update, so every subscriber sees this one first.
      void repository.save(change).then((result) => {
         const saveError = saveErrorText(result);

         store.update((x) => (x.saveError === saveError ? x : { ...x, saveError }));
      });

      if (marketChanged) {
         void cache.save(s.market);
      }
   });

   repository.onSavedElsewhere((change) => {
      store.update((s) => (adopted = { ...s, ...change }));

      const { portfolio, market } = store.get();

      if (change.portfolio && portfolio.trades.some((t) => !market.quotes[t.symbol])) {
         refresh();
      }
   });
}
