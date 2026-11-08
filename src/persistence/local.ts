// The browser-storage implementation of the app's storage ports (`PortfolioRepository` and `MarketCache` in
// app/ports.ts). Both share one storage quota, so they are made together: the portfolio can take the market
// cache's room when storage is full, and write back as much of the cache as still fits. Storage answers at
// once, so every promise is already settled, and writes happen in the order they were asked for.
import type { Stored, StoredChange } from '../backup/stored';
import type { MarketData } from '../domain/market';
import type { Portfolio } from '../domain/types';
import {
   createSave,
   loadBackupReminderDismissed,
   loadLastExport,
   loadMarket,
   loadPortfolio,
   loadSavedElsewhere,
   loadSnapshots,
   saveBackupReminderDismissed,
   saveLastExport,
   saveMarket,
   type Save,
   type SaveOutcome,
} from './repositories';

export function createLocalPersistence() {
   // The market data last loaded or saved, to write back after the portfolio took the cache's room.
   let market: MarketData | undefined;
   // Made by `load`, which finds out whether the stored portfolio must be protected.
   let save: Save = createSave({ market: () => market });
   let keepAsked = false;

   // Browsers may clear a site's storage when the disk runs low. Once there is something to lose, ask for
   // it to be kept; the browser decides, and may ask the user.
   function keepStorage(portfolio: Portfolio): void {
      if (keepAsked || (portfolio.trades.length === 0 && Object.keys(portfolio.cash).length === 0)) {
         return;
      }

      keepAsked = true;
      // Missing in older browsers and outside secure contexts, whatever the DOM types say.
      (navigator.storage as Partial<StorageManager> | undefined)?.persist?.().catch(() => undefined);
   }

   const repository = {
      load(): Promise<Stored & { warning?: string }> {
         const { portfolio, error, protect } = loadPortfolio();

         save = createSave({ protectPortfolio: protect, market: () => market });
         keepStorage(portfolio);

         return Promise.resolve({
            portfolio,
            snapshots: loadSnapshots(),
            lastExport: loadLastExport(),
            backupReminderDismissed: loadBackupReminderDismissed(),
            warning: error,
         });
      },

      save(change: StoredChange): Promise<SaveOutcome> {
         const outcome = save(change);

         // The backup state is a convenience: without room it is skipped, and the reminder shows again after a reload.
         if ('lastExport' in change) {
            saveLastExport(change.lastExport);
         }

         if (change.backupReminderDismissed !== undefined) {
            saveBackupReminderDismissed(change.backupReminderDismissed);
         }

         if (change.portfolio) {
            keepStorage(change.portfolio);
         }

         return Promise.resolve(outcome);
      },

      /** The browser announces a write to every other tab of the same address, never to the tab that made it. */
      onSavedElsewhere(listener: (change: StoredChange) => void): () => void {
         const announced = (event: StorageEvent) => {
            const change = loadSavedElsewhere(event.key);

            if (change) {
               listener(change);
            }
         };

         window.addEventListener('storage', announced);

         return () => window.removeEventListener('storage', announced);
      },
   };

   const cache = {
      load(): Promise<MarketData> {
         market = loadMarket();

         return Promise.resolve(market);
      },

      save(next: MarketData): Promise<void> {
         market = next;
         saveMarket(next);

         return Promise.resolve();
      },
   };

   return { repository, cache };
}
