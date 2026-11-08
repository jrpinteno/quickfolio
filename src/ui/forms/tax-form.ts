import type { AppStore } from '../../app/state';
import { setTaxPaid } from '../../app/trades';
import { isYear } from '../../domain/codes';
import { $, field } from '../dom';
import type { RenderContext } from '../sections/context';

export interface TaxForm {
   /** Shows the form while a tax estimate is chosen, with the year's current figure as the placeholder. */
   render(ctx: RenderContext): void;
}

/**
 * The form for the tax paid in a year as filed. It replaces that year's estimate in the After tax card;
 * an empty amount removes it, and the estimate shows again.
 */
export function mountTaxForm(store: AppStore): TaxForm {
   const form = $<HTMLFormElement>('#tax-form');
   const yearInput = field(form, 'year');
   const amountInput = field(form, 'taxPaid');
   const status = $('#tax-status');
   let last: RenderContext | undefined;

   /** The selected year's figure: what was filed, else the estimate, else nothing. */
   function showCurrent(): void {
      const year = Number(yearInput.value);
      const row = last?.tax?.years.find((y) => y.year === year);
      const { money } = last?.fmt ?? { money: (v: number) => String(v) };

      amountInput.placeholder = !row
         ? ' '
         : row.paid !== undefined
           ? `Filed: ${money(row.paid, 'EUR')}`
           : `Estimate: ${money(row.estimate, 'EUR')}`;
   }

   yearInput.addEventListener('input', showCurrent);

   form.addEventListener('submit', (event) => {
      event.preventDefault();
      const year = yearInput.value.trim();

      if (!isYear(year)) {
         status.textContent = 'Enter the year of the tax return, such as 2024.';
         status.classList.add('error');

         return;
      }

      const amount = amountInput.value === '' ? undefined : Number(amountInput.value);

      if (amount !== undefined && !(amount >= 0)) {
         status.textContent = 'Enter the tax paid as an amount of zero or more, or leave it empty to remove it.';
         status.classList.add('error');

         return;
      }

      setTaxPaid(store, year, amount);
      status.textContent = amount === undefined ? `${year} is back to the estimate.` : `Saved the tax filed for ${year}.`;
      status.classList.remove('error');
      amountInput.value = '';
      showCurrent();
   });

   return {
      render(ctx) {
         last = ctx;
         form.hidden = !ctx.state.view.tax;
         showCurrent();
      },
   };
}
