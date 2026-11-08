import { message } from '../../domain/errors';
import type { PriceProvider, RateProvider } from '../../app/ports';
import { lookupQuote } from '../../app/refresh';
import type { AppStore } from '../../app/state';
import {
   commitTrades,
   deleteTrade,
   deletionConflict,
   PAY_CURRENCIES,
   prepareTrade,
   previewSale,
   ratesFor,
   type TradeProblem,
} from '../../app/trades';
import { isSymbol } from '../../domain/codes';
import { sharesHeld, type Match } from '../../domain/ledger';
import type { Quote } from '../../domain/market';
import { today } from '../../domain/time';
import { conversionCost, impliedEurUsd, settledBeforeFees, type TradeInput } from '../../domain/trade';
import { BASE, CASH_CURRENCY, type Side, type Trade } from '../../domain/types';
import { $, field } from '../dom';
import { createFormat, pct, share, type Format } from '../format';

const DEFAULT_STATUS: Record<Side, string> = {
   buy: 'One entry per purchase, as on the trade confirmation.',
   sell: 'Matched against your oldest purchases first (FIFO). Cash is not changed: update it yourself.',
};

/** The total's label with fees excluded or included, and the checkbox that switches between them. */
const SETTLED_LABEL: Record<Side, { excl: string; incl: string; checkbox: string }> = {
   buy: { excl: 'Total paid, excl. fees', incl: 'Total paid, incl. fees', checkbox: 'The total includes the fees' },
   sell: {
      excl: 'Total received, before fees',
      incl: 'Total received, after fees',
      checkbox: 'The total is what was left after the fees',
   },
};

export interface TradeFormDeps {
   prices: PriceProvider;
   rates: Pick<RateProvider, 'getReferenceRates'>;
   /** Called after a trade is saved, to fetch history back to its date and FX for new currencies. */
   refresh: () => void;
}

export interface TradeForm {
   /** Clears the form for a new trade, keeping the buy/sell choice so several sales can be entered in a row. */
   reset(): void;
}

/**
 * Wires the buy/sell form and the edit and delete buttons of the
 * transactions table. The form keeps its draft to itself; only a saved trade
 * reaches the store.
 */
export function mountTradeForm(store: AppStore, deps: TradeFormDeps): TradeForm {
   const form = $<HTMLFormElement>('#lot-form');
   const status = $('#lot-status');
   const preview = $('#lot-preview');
   const symbolInput = field(form, 'symbol');
   const dateInput = field(form, 'date');
   const quantityInput = field(form, 'quantity');
   const unitPriceInput = field(form, 'unitPrice');
   const feesInput = field(form, 'fees');
   const settledInput = field(form, 'settled');
   const settledInInput = field<HTMLSelectElement>(form, 'settledIn');
   const feeCurrencyInput = field<HTMLSelectElement>(form, 'feeCurrency');
   /** Checked when the total is the broker's all-in figure, fees included (paid) or deducted (received). */
   const inclFeesInput = field(form, 'settledInclFees');

   let side: Side = 'buy';
   let editingId: string | undefined;
   /** Quote resolved for the symbol currently typed in the form. */
   let draftQuote: Quote | undefined;
   /** Set once the user types the total, so it is no longer filled from units × price. */
   let settledTouched = false;
   /** Set once the user picks a currency, so a symbol lookup never overrides it. */
   let settledInTouched = false;
   let feeCurrencyTouched = false;
   /** Guards against an older preview landing after a newer one. */
   let previewRequest = 0;

   const fmt = (): Format => {
      const { view, market } = store.get();

      return createFormat({ hideAmounts: view.hideAmounts, fx: market.fx, reporting: view.reporting });
   };

   function setStatus(text: string, isError = false): void {
      status.textContent = text;
      status.classList.toggle('error', isError);
   }

   /** Switches the form between recording a purchase and a sale, keeping what was typed. */
   function setSide(next: Side): void {
      side = next;

      for (const b of document.querySelectorAll<HTMLButtonElement>('[data-side]')) {
         const selected = b.dataset.side === next;

         b.classList.toggle('selected', selected);
         b.setAttribute('aria-pressed', String(selected));
      }

      const noun = next === 'buy' ? 'purchase' : 'sale';

      setSettledLabels();
      $('#lot-submit').textContent = `Save ${noun}`;

      if (!editingId) {
         $('#lot-form-title').textContent = `Add ${noun}`;
      }

      setStatus(holdingNote() || DEFAULT_STATUS[next]);
      void updatePreview();
   }

   function setSettledLabels(): void {
      const incl = inclFeesInput.checked;

      $('#settled-label').textContent = SETTLED_LABEL[side][incl ? 'incl' : 'excl'];
      $('#settled-incl-label').textContent = SETTLED_LABEL[side].checkbox;
   }

   /**
    * The form's amounts with the total taken back to before fees when it includes them, as the trade is stored.
    * A string says why that isn't possible.
    */
   async function beforeFees(input: TradeInput, date: string): Promise<TradeInput | string> {
      if (!inclFeesInput.checked) {
         return input;
      }

      // Fees in a third currency are converted at the ECB rate; the others need no rate.
      const needsRate = input.fees > 0 && input.feeCurrency !== input.settledIn && input.feeCurrency !== input.currency;
      const ref = needsRate ? await ratesFor(input, date, deps.rates).catch(() => undefined) : undefined;

      if (needsRate && !ref) {
         return `Could not get the ECB rates for ${date} to convert the fees.`;
      }

      const settled = settledBeforeFees(input, ref);

      return settled === undefined ? `The fees are more than the total ${side === 'buy' ? 'paid' : 'received'}.` : { ...input, settled };
   }

   /** What the symbol lookup found, plus the shares held when recording a sale. */
   function holdingNote(): string {
      if (!draftQuote) {
         return '';
      }

      const found = `${draftQuote.name ?? draftQuote.symbol} · trades in ${draftQuote.currency}`;

      if (side === 'buy') {
         return found;
      }

      const { portfolio, market } = store.get();
      const others = portfolio.trades.filter((t) => t.id !== editingId);
      const held = sharesHeld(others, draftQuote.symbol, market.quotes[draftQuote.symbol] ?? draftQuote);

      return `${found} · you hold ${fmt().qty(held)} today`;
   }

   function setOptions(select: HTMLSelectElement, options: string[], value: string): void {
      select.replaceChildren(...options.map((c) => new Option(c, c)));
      select.value = options.includes(value) ? value : options[0]!;
   }

   function applyCurrency(currency: string | undefined): void {
      $('#price-label').textContent = currency ? `Price per unit (${currency})` : 'Price per unit';
      const options = [...new Set([...(currency ? [currency] : []), ...PAY_CURRENCIES])];

      // Cash is EUR, so trades default to settling in EUR; fees to the instrument's currency.
      setOptions(settledInInput, options, settledInTouched ? settledInInput.value : CASH_CURRENCY);
      setOptions(feeCurrencyInput, options, feeCurrencyTouched ? feeCurrencyInput.value : (currency ?? BASE));
   }

   /** The form's amounts, or undefined while any required one is missing. */
   function readInput(): TradeInput | undefined {
      const currency = draftQuote?.currency;
      const input = {
         side,
         currency: currency ?? '',
         quantity: Number(quantityInput.value),
         unitPrice: Number(unitPriceInput.value),
         settled: Number(settledInput.value),
         settledIn: settledInInput.value,
         fees: Number(feesInput.value || 0),
         feeCurrency: feeCurrencyInput.value,
      };

      return currency && input.quantity > 0 && input.unitPrice > 0 && input.settled > 0 && input.fees >= 0 ? input : undefined;
   }

   /** Explains an oversold sale in the units of its own date. */
   function oversoldMessage(m: Match, changed: Trade): string {
      const held = ((m.shares - m.unmatched) * m.sale.quantity) / m.shares;
      const { qty } = fmt();

      return m.sale.id === changed.id
         ? `On ${m.sale.date} you held only ${qty(+held.toFixed(6))} ${m.sale.symbol} shares.`
         : `This leaves the sale of ${m.sale.date} selling more ${m.sale.symbol} shares than were held (${qty(+held.toFixed(6))}).`;
   }

   function problemMessage(problem: TradeProblem, symbol: string, input: TradeInput, date: string): string {
      switch (problem.kind) {
         case 'currency':
            return `Earlier ${symbol} trades are in ${problem.recorded}, but it now trades in ${input.currency}.`;
         case 'rates':
            return `Could not get the ECB rates for ${date}: ${message(problem.error)}`;
         case 'rate':
            return (
               `The amounts imply EUR/USD ${problem.implied.toFixed(4)}, ` +
               `${pct(problem.implied / problem.reference - 1)} away from the ECB rate ${problem.reference.toFixed(4)} on ${date}. ` +
               'Check units, price and total.'
            );
         case 'oversold':
            return oversoldMessage(problem.match, problem.trade);
         case 'invalid':
            // The reason names the check that failed ("Trade #1 has an invalid amount"); the advice is the same.
            return 'This trade can’t be saved: its amounts or the rates for its date are out of range. Check units, price and total.';
      }
   }

   /** Shows amounts, the rate they imply and, for a sale, the realized gain while the user types. */
   async function updatePreview(): Promise<void> {
      const currency = draftQuote?.currency;
      const quantity = Number(quantityInput.value);
      const unitPrice = Number(unitPriceInput.value);

      // Settled in the instrument's own currency: the total is normally just units × price.
      if (currency && !settledTouched && !inclFeesInput.checked && settledInInput.value === currency && quantity > 0 && unitPrice > 0) {
         settledInput.value = (quantity * unitPrice).toFixed(2);
      }

      const entered = readInput();
      const date = dateInput.value;

      if (!entered || !date || !draftQuote) {
         preview.hidden = true;

         return;
      }

      const quote = draftQuote;
      const request = ++previewRequest;
      const input = await beforeFees(entered, date);

      if (request !== previewRequest) {
         return;
      }

      if (typeof input === 'string') {
         preview.textContent = input;
         preview.hidden = false;

         return;
      }

      const ref = await ratesFor(input, date, deps.rates).catch(() => undefined);

      if (request !== previewRequest) {
         return;
      }

      const { money, signedMoney } = fmt();
      const gross = input.quantity * input.unitPrice;
      const parts = [`${input.side === 'buy' ? 'Cost' : 'Proceeds'} ${money(gross, input.currency)}`];

      if (inclFeesInput.checked) {
         parts.push(`${money(input.settled, input.settledIn)} before fees`);
      } else if (input.settledIn !== input.currency) {
         parts.push(`${input.side === 'buy' ? 'paid' : 'received'} ${money(input.settled, input.settledIn)}`);
      }

      const implied = impliedEurUsd(input);

      if (implied !== undefined) {
         const cost = ref && ref.eurUsd !== implied ? conversionCost(input, implied, ref.eurUsd) : undefined;
         const vsRef =
            cost !== undefined
               ? ` (ECB ${ref!.eurUsd.toFixed(4)}; conversion ${cost >= 0 ? 'cost' : 'gain'} ${share(Math.abs(cost))} vs ECB)`
               : '';

         parts.push(`EUR/USD ${implied.toFixed(4)}${vsRef}`);
      } else if (input.settledIn === input.currency && Math.abs(input.settled / gross - 1) > 0.005) {
         parts.push(`total differs from units × price by ${pct(input.settled / gross - 1)}; the total is used`);
      }

      if (input.fees > 0) {
         parts.push(`fees ${money(input.fees, input.feeCurrency)}`);
      }

      if (input.side === 'sell' && ref) {
         const result = previewSale(store.get(), { input, quote, date, replacing: editingId }, ref);

         if ('oversold' in result) {
            parts.push(oversoldMessage(result.oversold, result.trade));
         } else if (result.sale && Number.isFinite(result.sale.gain)) {
            const { sale } = result;

            parts.push(
               `realized ${signedMoney(sale.gain, store.get().view.reporting)} (${pct(sale.returnPct)}) against ` +
                  `${sale.lots.length === 1 ? `the purchase of ${sale.lots[0]!.buy.date}` : `${sale.lots.length} purchases`}`,
            );
         }
      }

      preview.textContent = parts.join(' · ');
      preview.hidden = false;
   }

   async function resolveSymbol(): Promise<Quote | undefined> {
      const symbol = symbolInput.value.trim().toUpperCase();

      if (!symbol) {
         return undefined;
      }

      if (draftQuote?.symbol === symbol) {
         return draftQuote;
      }

      const fail = (text: string) => {
         draftQuote = undefined;
         applyCurrency(undefined);
         preview.hidden = true;
         setStatus(text, true);

         return undefined;
      };

      if (!isSymbol(symbol)) {
         return fail('Symbols use letters, digits and . ^ = - only, as on Yahoo Finance (e.g. NOKIA.HE).');
      }

      setStatus(`Looking up ${symbol}…`);

      try {
         draftQuote = await lookupQuote(deps.prices, symbol);
         setStatus(holdingNote());
         applyCurrency(draftQuote.currency);
         void updatePreview();

         return draftQuote;
      } catch (e) {
         return fail(`${symbol}: ${message(e)}`);
      }
   }

   function reset(): void {
      form.reset();
      dateInput.value = today();
      dateInput.max = today();
      editingId = undefined;
      draftQuote = undefined;
      settledTouched = false;
      settledInTouched = false;
      feeCurrencyTouched = false;
      applyCurrency(undefined);
      preview.hidden = true;
      $('#lot-cancel').hidden = true;
      setSide(side);
   }

   function startEdit(id: string): void {
      const { portfolio, market } = store.get();
      const t = portfolio.trades.find((x) => x.id === id);

      if (!t) {
         return;
      }

      editingId = id;
      draftQuote = market.quotes[t.symbol];
      // Keep everything as recorded unless the user changes it.
      settledTouched = true;
      settledInTouched = true;
      feeCurrencyTouched = true;
      symbolInput.value = t.symbol;
      dateInput.value = t.date;
      quantityInput.value = String(t.quantity);
      unitPriceInput.value = String(t.unitPrice);
      settledInput.value = String(t.settled);
      feesInput.value = String(t.fees);
      // Trades store the total before fees.
      inclFeesInput.checked = false;
      const options = [...new Set([t.currency, ...PAY_CURRENCIES])];

      setOptions(settledInInput, options, t.settledIn);
      setOptions(feeCurrencyInput, options, t.feeCurrency);
      applyCurrency(t.currency);
      $('#lot-form-title').textContent = `Edit ${t.symbol} ${t.side === 'buy' ? 'purchase' : 'sale'} of ${t.date}`;
      $('#lot-cancel').hidden = false;
      setSide(t.side);
      $<HTMLDetailsElement>('#manage').open = true;
      quantityInput.focus();
   }

   for (const b of document.querySelectorAll<HTMLButtonElement>('[data-side]')) {
      b.addEventListener('click', () => setSide(b.dataset.side as Side));
   }

   symbolInput.addEventListener('change', () => void resolveSymbol());

   for (const input of [dateInput, quantityInput, unitPriceInput, feesInput]) {
      input.addEventListener('input', () => void updatePreview());
   }

   settledInput.addEventListener('input', () => {
      settledTouched = settledInput.value !== '';
      void updatePreview();
   });
   settledInInput.addEventListener('change', () => {
      settledInTouched = true;
      settledTouched = false; // a new currency means a new total; refill it if it's the instrument's

      if (settledInInput.value !== draftQuote?.currency) {
         settledInput.value = '';
      }

      void updatePreview();
   });
   feeCurrencyInput.addEventListener('change', () => {
      feeCurrencyTouched = true;
      void updatePreview();
   });
   inclFeesInput.addEventListener('change', () => {
      setSettledLabels();
      void updatePreview();
   });
   $('#lot-cancel').addEventListener('click', reset);

   /** Saves the trade, or says why it can't be saved. */
   async function submit(): Promise<void> {
      const quote = await resolveSymbol();

      if (!quote) {
         return;
      }

      const entered = readInput();

      if (!entered) {
         return setStatus(`Enter units, price per unit and the total ${side === 'buy' ? 'paid' : 'received'}.`, true);
      }

      const date = dateInput.value;
      const input = await beforeFees(entered, date);

      if (typeof input === 'string') {
         return setStatus(input, true);
      }

      const result = await prepareTrade(
         store.get(),
         { input, quote, date, replacing: editingId },
         editingId ?? crypto.randomUUID(),
         deps.rates,
      );

      if ('problem' in result) {
         return setStatus(problemMessage(result.problem, quote.symbol, input, date), true);
      }

      commitTrades(store, result.trades, quote);
      reset();
      deps.refresh();
   }

   form.addEventListener('submit', (event) => {
      event.preventDefault();
      void submit();
   });

   $('#lots').addEventListener('click', (event) => {
      const { edit, delete: del } = (event.target as HTMLElement).dataset;

      if (edit) {
         startEdit(edit);
      }

      if (del) {
         const t = store.get().portfolio.trades.find((x) => x.id === del);

         if (!t) {
            return;
         }

         const conflict = deletionConflict(store.get(), del);
         const warning = conflict ? `\n\nThe sale of ${conflict.sale.date} would then sell more shares than were held.` : '';

         if (confirm(`Remove the ${t.symbol} ${t.side === 'buy' ? 'purchase' : 'sale'} of ${t.date}?${warning}`)) {
            deleteTrade(store, del);

            if (editingId === del) {
               reset();
            }
         }
      }
   });

   // Amounts in the preview follow the hide switch and the reporting currency.
   store.subscribe((s, prev) => {
      if (s.view.hideAmounts !== prev.view.hideAmounts || s.view.reporting !== prev.view.reporting) {
         void updatePreview();
      }
   });

   return { reset };
}
