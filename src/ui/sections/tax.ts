import { share, tone } from '../format';
import { sub } from './common';
import type { RenderContext } from './context';

const EUR = 'EUR';

/**
 * What the portfolio has made after tax: each year's realized gains and dividends with the estimated
 * Spanish savings tax on them, and what selling everything today would leave. Always in EUR, the currency
 * the tax is worked out in. Shown only when a tax estimate is chosen and the whole portfolio is in view.
 */
export function renderTax(section: HTMLElement, { tax, fmt }: RenderContext): void {
   section.hidden = !tax || tax.years.length + (tax.ifSoldToday.gains ? 1 : 0) === 0;

   if (!tax || section.hidden) {
      return;
   }

   const { money, signedMoney } = fmt;
   const thisYear = new Date().getFullYear();
   const amount = (v: number) => (v ? signedMoney(v, EUR) : '—');
   const rate = (taxed: number, base: number) => (base > 0 ? share(taxed / base) : '—');
   const rows = [...tax.years].reverse().map(
      (y) => `
      <tr>
        <td><b>${y.year}</b>${y.year === thisYear ? ' <span class="muted">so far</span>' : ''}</td>
        <td class="${tone(y.gains)}">${amount(y.gains)}</td>
        <td>${amount(y.dividends)}</td>
        <td>${y.carriedIn ? money(y.carriedIn, EUR) : '—'}</td>
        <td>${money(y.tax, EUR)}${sub(y.paid === undefined ? 'est.' : `filed · est. ${money(y.estimate, EUR)}`)}</td>
        <td>${rate(y.tax, y.paid === undefined ? y.base : y.gains + y.dividends)}</td>
        <td class="${tone(y.kept)}"><b>${signedMoney(y.kept, EUR)}</b></td>
      </tr>`,
   );
   const filedYears = tax.years.filter((y) => y.paid !== undefined).length;
   const filed = filedYears === 0 ? 'estimate' : `${filedYears} of ${tax.years.length} years as filed, the rest estimated`;
   const sold = tax.ifSoldToday;
   const takenOut = tax.total.kept - sold.kept;
   const tile = (label: string, v: number, note: string) =>
      `<div class="chip"><b>${label}</b> <span class="${tone(v)}">${signedMoney(v, EUR, 0)}</span> ` +
      `<span class="muted">${note}</span></div>`;
   const lossesLeft = tax.lossesLeft > 0.5 ? ` Losses still to set off: ${money(tax.lossesLeft, EUR)}.` : '';

   section.innerHTML = `
    <div class="card-header"><h2>After tax</h2><span class="muted">Spain, savings income (IRPF) · in EUR · ${filed}</span></div>
    <div class="chips tax-totals">
      ${tile('Made so far', takenOut, 'sales and dividends, after tax')}
      ${tile('If sold today', sold.kept, `unrealized ${signedMoney(sold.gains, EUR, 0)}, after tax`)}
      ${tile('Total', tax.total.kept, 'after tax')}
    </div>
    <div class="table-wrap">
      <table class="tax">
        <thead><tr>
          <th>Year</th>
          <th title="Realized gains less losses, FIFO, after fees, in EUR at each trade's rate">Sales</th>
          <th title="Gross, at the ECB rate of each ex-date">Dividends</th>
          <th title="Losses from earlier years set against this year's gains and dividends">Earlier losses</th>
          <th>Tax</th>
          <th title="Tax over what was taxed">Rate</th>
          <th title="Sales and dividends less tax">Kept</th>
        </tr></thead>
        <tbody>${rows.join('')}
          <tr class="tax-sell">
            <td><b>Sell all today</b></td>
            <td class="${tone(sold.gains)}">${amount(sold.gains)}</td>
            <td>—</td><td>—</td>
            <td>${signedMoney(sold.tax, EUR)}</td>
            <td>${sold.gains > 0 ? share(sold.tax / sold.gains) : '—'}</td>
            <td class="${tone(sold.kept)}"><b>${signedMoney(sold.kept, EUR)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="hint">
      Each year uses that year's savings brackets (19% to 30%), as if these were your only savings income: interest,
      funds or crypto sold in the same year reach higher brackets and change how losses are used. Dividends are gross;
      tax withheld abroad counts towards the Spanish tax up to the Spanish rate. A loss offsets gains of the same year,
      then up to 25% of the dividends, and carries forward four years. The two-month rule on buying back is not applied.${lossesLeft}
    </p>`;
}
