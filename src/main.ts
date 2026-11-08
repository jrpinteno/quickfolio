// Composition root: loads what is stored, wires the app to its data sources and the page, and starts it.
import './styles/index.css';
import { loadKept, persistChanges, type Persistence } from './app/persist';
import { refresh as runRefresh, type RefreshDeps } from './app/refresh';
import { initialView, type AppState } from './app/state';
import { createStore } from './app/store';
import { getReferenceRates, getUsdRateHistory, getUsdRates } from './market/frankfurter';
import { yahoo } from './market/yahoo';
import { createLocalPersistence } from './persistence/local';
import { loadPreferences, savePreferences } from './persistence/preferences';
import { mountDashboard } from './ui/dashboard';
import { mountDisplayMenu } from './ui/display/display-menu';
import { initialDisplay } from './ui/display/themes';
import { mountBackupControls } from './ui/forms/backup-controls';
import { mountCashForm } from './ui/forms/cash-form';
import { mountTradeForm } from './ui/forms/trade-form';

/** Refresh again on tab focus if the last refresh is older than this. */
const STALE_AFTER_MS = 5 * 60 * 1000;

// Trades, cash and history are kept behind the storage ports; display choices stay in this browser, as the
// theme has to be read before the page first paints (public/theme-boot.js).
const persistence: Persistence = createLocalPersistence();
const preferences = loadPreferences();
const store = createStore<AppState>({
   ...(await loadKept(persistence)),
   status: { refreshing: false, failed: new Map() },
   view: initialView(preferences),
});

store.subscribe((s, prev) => {
   if (s.view !== prev.view) {
      savePreferences(s.view, prev.view);
   }
});

const deps: RefreshDeps = { prices: yahoo, rates: { getUsdRates, getUsdRateHistory, getReferenceRates } };
const refresh = () => void runRefresh(store, deps);

persistChanges(store, persistence, refresh);

let display = initialDisplay(preferences);

mountDisplayMenu(store, display, (next) => {
   savePreferences(next, display);
   display = next;
   dashboard.renderTrend();
});
const cashForm = mountCashForm(store, refresh);
const backupControls = mountBackupControls(store, () => {
   tradeForm.reset();
   refresh();
});
const dashboard = mountDashboard(store, {
   refresh,
   extra: (ctx) => {
      cashForm.render(ctx);
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

// Fresh prices replace a cached value that fails to render, so the refresh runs whatever happens.
try {
   dashboard.render();
} finally {
   refresh();
}
