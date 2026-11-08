import { dismissBackupReminder } from '../app/backup';
import { updateView, type AppState, type AppStore } from '../app/state';
import { viewSummary } from '../app/view';
import type { Reporting } from '../domain/types';
import { $ } from './dom';
import { createFormat } from './format';
import { renderAllocationSection } from './sections/allocation';
import type { RenderContext } from './sections/context';
import { renderHoldings } from './sections/holdings';
import { renderRealized } from './sections/realized';
import { renderStatus } from './sections/status';
import { renderSummary } from './sections/summary';
import { renderTax } from './sections/tax';
import { mountTransactions } from './sections/transactions';
import { renderTrendSection } from './sections/trend/trend';
import { renderViewbar } from './sections/viewbar';

export interface Dashboard {
   /** Redraws everything from the current state. */
   render(): void;
   /** Redraws only the performance chart, whose geometry depends on the card's width. */
   renderTrend(): void;
}

/**
 * Renders every section from the store's state on each change, and turns the
 * sections' clicks into view changes. `extra` renders alongside, for
 * controls outside the dashboard that show state (the cash form).
 */
export function mountDashboard(store: AppStore, actions: { refresh: () => void; extra?: (ctx: RenderContext) => void }): Dashboard {
   const context = (state: AppState): RenderContext => {
      const { s, full, focused, tax } = viewSummary(state);
      const fmt = createFormat({
         hideAmounts: state.view.hideAmounts,
         fx: state.market.fx,
         reporting: state.view.reporting,
      });

      return { state, s, full, focused, tax, fmt };
   };
   const transactions = mountTransactions($('#lots'), store);
   const trend = (ctx: RenderContext) => renderTrendSection($('#trend'), ctx, (range) => updateView(store, { range }));

   function render(): void {
      const ctx = context(store.get());

      renderViewbar($('#viewbar'), ctx);
      renderSummary($('#summary'), ctx);
      renderStatus($('#status'), ctx);
      // Allocation first: whether it shows decides the width the trend chart measures.
      renderAllocationSection($('#allocation'), ctx);
      trend(ctx);
      renderHoldings($('#holdings'), ctx);
      renderTax($('#tax'), ctx);
      renderRealized($('#realized'), ctx);
      transactions.render(ctx);
      actions.extra?.(ctx);
   }

   $('#status').addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const reporting = target.closest<HTMLElement>('[data-reporting]')?.dataset.reporting;

      if (reporting) {
         updateView(store, { reporting: reporting as Reporting });
      } else if (target.closest('#refresh')) {
         actions.refresh();
      }
   });

   $('#summary').addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-dismiss-backup]')) {
         dismissBackupReminder(store);
      }
   });

   const setFocus = (symbol: string | undefined) => updateView(store, { focus: symbol || undefined });

   $('#viewbar').addEventListener('change', (event) => setFocus((event.target as HTMLSelectElement).value));
   // Symbol buttons in the holdings table and "Show all" share one attribute.
   document.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-focus]');

      if (!target) {
         return;
      }

      setFocus(target.dataset.focus);

      if (target.dataset.focus) {
         window.scrollTo({ top: 0, behavior: 'smooth' });
      }
   });

   store.subscribe(render);

   return { render, renderTrend: () => trend(context(store.get())) };
}
