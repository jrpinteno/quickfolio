import { updateView, type AppStore } from '../../app/state';
import { TAX_REGIMES } from '../../domain/tax';
import { $ } from '../dom';
import { THEMES, type Display, type Layout, type ThemeKey } from './themes';

/**
 * The ◐ menu: theme, layout and the hide-amounts switch. Theme and layout are
 * presentation only and stay here; hiding amounts is a view option in the
 * store, since every section formats differently with it.
 *
 * - Parameters:
 *   - initial: The theme and layout to apply now.
 *   - changed: Called after the user picks a theme or layout, with the new choice. Themes change fonts
 *     and padding, so whatever measures its width should re-render then.
 */
export function mountDisplayMenu(store: AppStore, initial: Display, changed: (display: Display) => void): void {
   let display = initial;
   const menu = $<HTMLDetailsElement>('#display');
   const hideInput = $<HTMLInputElement>('#hide-amounts');

   /** Applies the theme and layout. Charts take their colours from CSS, so only width-dependent output changes. */
   function apply(): void {
      const root = document.documentElement;

      root.dataset.theme = display.theme;
      root.dataset.layout = display.layout;

      for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')) {
         b.setAttribute('aria-pressed', String(b.dataset.themeChoice === display.theme));
      }

      for (const b of document.querySelectorAll<HTMLButtonElement>('[data-layout-choice]')) {
         const selected = b.dataset.layoutChoice === display.layout;

         b.classList.toggle('selected', selected);
         b.setAttribute('aria-pressed', String(selected));
      }

      for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tax-choice]')) {
         const selected = b.dataset.taxChoice === (store.get().view.tax ?? '');

         b.classList.toggle('selected', selected);
         b.setAttribute('aria-pressed', String(selected));
      }

      const hidden = store.get().view.hideAmounts;

      hideInput.checked = hidden;
      // Visible from the closed menu too, so a screenshot is never taken in the wrong mode by surprise.
      root.toggleAttribute('data-amounts-hidden', hidden);
   }

   $('#themes').innerHTML = THEMES.map(
      ({ key, label, swatch: [page, card, accent, line] }) => `
  <button type="button" class="theme-choice" data-theme-choice="${key}">
    <span class="swatch-preview" style="background:${page}" aria-hidden="true">
      <i class="sw-card" style="background:${card}"></i>
      <i class="sw-line" style="background:${line}"></i>
      <i class="sw-line2" style="background:${accent}"></i>
    </span>
    ${label}
  </button>`,
   ).join('');

   menu.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const theme = target.closest<HTMLElement>('[data-theme-choice]')?.dataset.themeChoice as ThemeKey | undefined;
      const layout = target.closest<HTMLElement>('[data-layout-choice]')?.dataset.layoutChoice as Layout | undefined;
      const tax = target.closest<HTMLElement>('[data-tax-choice]')?.dataset.taxChoice;

      // The tax estimate changes what the dashboard computes, so it is a view option in the store.
      if (tax !== undefined) {
         updateView(store, { tax: TAX_REGIMES.find((r) => r === tax) });

         return;
      }

      if (theme) {
         display = { ...display, theme };
      } else if (layout) {
         display = { ...display, layout };
      } else {
         return;
      }

      apply();
      changed(display);
   });
   hideInput.addEventListener('change', () => updateView(store, { hideAmounts: hideInput.checked }));
   store.subscribe((s, prev) => {
      if (s.view.hideAmounts !== prev.view.hideAmounts || s.view.tax !== prev.view.tax) {
         apply();
      }
   });

   // Close the menu on an outside click or Escape, as a menu would.
   document.addEventListener('click', (event) => {
      if (menu.open && !menu.contains(event.target as Node)) {
         menu.open = false;
      }
   });
   document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.open) {
         menu.open = false;
         menu.querySelector('summary')!.focus();
      }
   });

   apply();
}
