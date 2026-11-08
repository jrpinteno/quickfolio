// Composition root: loads what is stored, wires the app to its data sources and the page, and starts it.
import './styles/index.css';
import { refresh as runRefresh, type RefreshDeps } from './app/refresh';
import { initialView, type AppState } from './app/state';
import { createStore } from './app/store';
import { getReferenceRates, getUsdRateHistory, getUsdRates } from './market/frankfurter';
import { yahoo } from './market/yahoo';
import { loadPreferences, savePreferences } from './persistence/preferences';
import {
   createSave,
   loadBackupReminderDismissed,
   loadLastExport,
   loadMarket,
   loadPortfolio,
   loadSnapshots,
   saveBackupReminderDismissed,
   saveLastExport,
} from './persistence/repositories';
import { mountDashboard } from './ui/dashboard';
import { mountDisplayMenu } from './ui/display/display-menu';
import { initialDisplay } from './ui/display/themes';
import { mountBackupControls } from './ui/forms/backup-controls';
import { mountCashForm } from './ui/forms/cash-form';
import { mountTaxForm } from './ui/forms/tax-form';
import { mountTradeForm } from './ui/forms/trade-form';

/** Refresh again on tab focus if the last refresh is older than this. */
const STALE_AFTER_MS = 5 * 60 * 1000;

const preferences = loadPreferences();
const stored = loadPortfolio();
const store = createStore<AppState>({
   portfolio: stored.portfolio,
   storageWarning: stored.error,
   market: loadMarket(),
   snapshots: loadSnapshots(),
   status: { refreshing: false, failed: new Map() },
   view: initialView(preferences),
   lastExport: loadLastExport(),
   backupReminderDismissed: loadBackupReminderDismissed(),
});

// Persistence follows the state: whatever changed is written back.
const save = createSave({ protectPortfolio: stored.protect });

store.subscribe((s, prev) => {
   const changed = {
      portfolio: s.portfolio !== prev.portfolio,
      market: s.market !== prev.market,
      snapshots: s.snapshots !== prev.snapshots,
   };

   if (changed.portfolio || changed.market || changed.snapshots) {
      const saveError = save(s, changed);

      // Reported in a later update, so every subscriber sees this one first.
      if (saveError !== s.saveError) {
         queueMicrotask(() => store.update((x) => (x.saveError === saveError ? x : { ...x, saveError })));
      }
   }

   if (s.view !== prev.view) {
      savePreferences(s.view, prev.view);
   }

   if (s.lastExport !== prev.lastExport) {
      saveLastExport(s.lastExport);
   }

   if (s.backupReminderDismissed !== prev.backupReminderDismissed) {
      saveBackupReminderDismissed(s.backupReminderDismissed === true);
   }

   keepStorage(s);
});

// Browsers may clear a site's storage when the disk runs low. Once there is something to lose, ask for
// it to be kept; the browser decides, and may ask the user.
let keepAsked = false;

function keepStorage({ portfolio }: AppState): void {
   if (keepAsked || (portfolio.trades.length === 0 && Object.keys(portfolio.cash).length === 0)) {
      return;
   }

   keepAsked = true;
   // Missing in older browsers and outside secure contexts, whatever the DOM types say.
   (navigator.storage as Partial<StorageManager> | undefined)?.persist?.().catch(() => undefined);
}

const deps: RefreshDeps = { prices: yahoo, rates: { getUsdRates, getUsdRateHistory, getReferenceRates } };
const refresh = () => void runRefresh(store, deps);

let display = initialDisplay(preferences);

mountDisplayMenu(store, display, (next) => {
   savePreferences(next, display);
   display = next;
   dashboard.renderTrend();
});
const cashForm = mountCashForm(store, refresh);
const taxForm = mountTaxForm(store);
const backupControls = mountBackupControls(store, () => {
   tradeForm.reset();
   refresh();
});
const dashboard = mountDashboard(store, {
   refresh,
   extra: (ctx) => {
      cashForm.render(ctx);
      taxForm.render(ctx);
      backupControls.render(ctx);
   },
});
const tradeForm = mountTradeForm(store, { prices: yahoo, rates: deps.rates, refresh });

document.addEventListener('visibilitychange', () => {
   if (document.visibilityState === 'visible' && Date.now() - (store.get().market.refreshedAt ?? 0) > STALE_AFTER_MS) {
      refresh();
   }
});

let resizeTimer: ReturnType<typeof setTimeout> | undefined;

window.addEventListener('resize', () => {
   clearTimeout(resizeTimer);
   resizeTimer = setTimeout(() => dashboard.renderTrend(), 150);
});

tradeForm.reset();
keepStorage(store.get());

// Fresh prices replace a cached value that fails to render, so the refresh runs whatever happens.
try {
   dashboard.render();
} finally {
   refresh();
}
