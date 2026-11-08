// The app as a whole, in a simulated browser: what the page shows and does, from startup through the
// controls, with prices from a fake market. Calculations are tested next to their code; these tests
// check the wiring between the sections, the forms, the store and browser storage.
import { afterEach, describe, expect, it } from 'vitest';
import { KEYS } from './persistence/storage';
import { closePage, openPage, type Page, type PageOptions } from './test/page';

/** Friday 6 November 2026, 19:40 UTC: US markets open, European ones closed for the day. */
const NOW = Date.parse('2026-11-06T19:40:00Z');
const TODAY = '2026-11-06';

// Purchases in the original "lots" format, so every start also migrates them. The AAPL lot predates its 4:1 split.
const LOTS = [
   {
      id: 'a1',
      symbol: 'AAPL',
      date: '2019-06-03',
      quantity: 10,
      currency: 'USD',
      cost: 1733,
      fees: 5,
      feeCurrency: 'USD',
      fxRate: 1,
      feeFxRate: 1,
   },
   {
      id: 'a2',
      symbol: 'AAPL',
      date: '2023-02-14',
      quantity: 15,
      currency: 'USD',
      cost: 2296,
      fees: 4.5,
      feeCurrency: 'EUR',
      fxRate: 1,
      feeFxRate: 1.0723,
   },
   {
      id: 'm1',
      symbol: 'MSFT',
      date: '2021-03-15',
      quantity: 8,
      currency: 'USD',
      cost: 1878,
      fees: 4.5,
      feeCurrency: 'EUR',
      fxRate: 1,
      feeFxRate: 1.1925,
   },
   {
      id: 'n1',
      symbol: 'NOKIA.HE',
      date: '2022-05-10',
      quantity: 500,
      currency: 'EUR',
      cost: 2425,
      fees: 9,
      feeCurrency: 'EUR',
      fxRate: 1.0548,
      feeFxRate: 1.0548,
   },
   {
      id: 's1',
      symbol: 'ASML.AS',
      date: '2024-09-02',
      quantity: 3,
      currency: 'EUR',
      cost: 2370,
      fees: 10,
      feeCurrency: 'EUR',
      fxRate: 1.1065,
      feeFxRate: 1.1065,
   },
];
// Sales in the current format: part of AAPL, settled in EUR, and all of MSFT.
const SALES = [
   {
      id: 'x1',
      side: 'sell',
      symbol: 'AAPL',
      date: '2024-07-15',
      quantity: 20,
      currency: 'USD',
      unitPrice: 230,
      gross: 4600,
      settled: 4210,
      settledIn: 'EUR',
      fees: 4.5,
      feeCurrency: 'EUR',
      fxRate: 1,
      feeFxRate: 1.0926,
      eurUsd: 4600 / 4210,
   },
   {
      id: 'x2',
      side: 'sell',
      symbol: 'MSFT',
      date: '2025-02-10',
      quantity: 8,
      currency: 'USD',
      unitPrice: 410,
      gross: 3280,
      settled: 3280,
      settledIn: 'USD',
      fees: 4.5,
      feeCurrency: 'USD',
      fxRate: 1,
      feeFxRate: 1,
      eurUsd: 1.0316,
   },
];
const SAMPLE = JSON.stringify({ trades: [...LOTS, ...SALES], cash: { EUR: 4000 } });

const open = (options: Partial<PageOptions> = {}) =>
   openPage(() => import('./main'), { now: NOW, storage: { [KEYS.portfolio]: SAMPLE }, ...options });

/** Opens the page again on what the last one left in storage, as a reload would. */
const reload = (page: Page, options: Partial<PageOptions> = {}) => open({ storage: stored(page), ...options });

const stored = (page: Page): Record<string, string> =>
   Object.fromEntries(
      Array.from({ length: page.storage.length }, (_, i) => page.storage.key(i)!).map((k) => [k, page.storage.getItem(k)!]),
   );
const storedPortfolio = (page: Page) =>
   JSON.parse(page.storage.getItem(KEYS.portfolio)!) as {
      trades: { id: string; quantity: number }[];
      cash: Record<string, number>;
   };

/** Each holding as [symbol, shares], in table order; cash is left out. */
const holdings = (page: Page) =>
   page
      .$$<HTMLTableRowElement>('#holdings tbody tr:not(.cash)')
      .map((row) => [row.querySelector('.sym-link, .sym b')!.textContent, row.cells[1]!.firstChild!.textContent]);

const warnings = (page: Page) => page.$$('#summary .banner').map((b) => b.textContent.replace(/\s+/g, ' ').trim());

/** Rendering went wrong somewhere if any of these reach the page. */
function expectSoundMarkup(page: Page): void {
   const markup = page.$('body').innerHTML;

   for (const bad of ['NaN', 'undefined', 'Infinity', '[object']) {
      expect(markup, bad).not.toContain(bad);
   }
}

/**
 * Visible text and tooltips that still show an amount of money. Per-share figures are meant to stay, as
 * they say nothing about the portfolio's size: the holdings' price and average cost columns, the trades'
 * unit price, and a single stock's "N shares at <price>".
 */
function visibleAmounts(page: Page): string[] {
   const amount = /[$€£]\s?\d|(?<!per )\b\d[\d,.]*\s?(USD|EUR|GBP)\b/;
   const perShare = '#holdings td:nth-child(3), #holdings td:nth-child(4), #lots td:nth-child(5)';
   const shown = (el: Element) => !el.closest(`[hidden], details:not([open]) > :not(summary), ${perShare}`);
   const found: string[] = [];
   const walk = document.createTreeWalker(page.$('main'), NodeFilter.SHOW_TEXT);

   for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const el = node.parentElement!;
      const sharePrice = /\bshares at $/.test(el.previousSibling?.textContent ?? '');

      if (shown(el) && !sharePrice && amount.test(node.textContent ?? '')) {
         found.push(`${el.closest('section, details')?.id}: ${node.textContent!.trim()}`);
      }
   }

   for (const el of page.$$('main [title]')) {
      if (shown(el) && amount.test(el.title)) {
         found.push(`title: ${el.title}`);
      }
   }

   return found;
}

afterEach(closePage);

describe('the dashboard', () => {
   it('values the stored portfolio, migrating its old format and recording the day', async () => {
      const page = await open();

      // AAPL's first lot is counted in today's shares, after its 4:1 split; MSFT is sold out.
      expect(holdings(page)).toEqual([
         ['AAPL', '35'],
         ['NOKIA.HE', '500'],
         ['ASML.AS', '3'],
      ]);
      expect(page.text('#summary .tile-hero')).toContain('Portfolio value $19,970.04');
      expect(page.text('#holdings tr.cash')).toContain('€4,000.00');
      expect(page.text('#realized')).toContain('MSFT');
      expect(page.text('#status')).toContain(`FX ${TODAY}`);
      expect(page.market.requests.every((url) => url.startsWith('/api/yahoo/') || url.startsWith('/api/fx/'))).toBe(true);

      const saved = JSON.parse(page.storage.getItem(KEYS.portfolio)!) as { lots?: unknown; trades: unknown[] };

      expect(saved.lots).toBeUndefined();
      expect(saved.trades).toHaveLength(7);
      const snapshots = JSON.parse(page.storage.getItem(KEYS.snapshots)!) as { date: string }[];

      expect(snapshots.map((s) => s.date)).toEqual([TODAY]);
      expectSoundMarkup(page);
   });

   it('switches the reporting currency and remembers it', async () => {
      const page = await open();

      await page.click('[data-reporting="EUR"]');

      expect(page.text('#summary .tile-hero')).toMatch(/Portfolio value €[\d,.]+ ≈ \$19,970\.04/);
      expect(page.storage.getItem(KEYS.reporting)).toBe('EUR');
      const again = await reload(page);

      expect(again.text('#summary .tile-hero')).toContain('Portfolio value €');
   });

   it('draws every range of the performance chart', async () => {
      const page = await open();

      for (const range of ['1D', '1W', '1M', '1Y', '5Y', 'All']) {
         await page.click(page.$$('#trend .segmented button').find((b) => b.textContent === range)!);
         expect(page.$('#trend [aria-pressed="true"]').textContent).toBe(range);
         expect(page.$$('#trend svg path').length, range).toBeGreaterThan(0);
         expectSoundMarkup(page);
      }

      expect(page.storage.getItem(KEYS.range)).toBe('All');
   });

   it('narrows to one stock from its symbol, and back', async () => {
      const page = await open();

      await page.click('#holdings [data-focus="AAPL"]');

      expect(holdings(page)).toEqual([['AAPL', '35']]);
      expect(page.$('#viewbar').hidden).toBe(false);
      expect(page.$$('#holdings tr.cash')).toEqual([]);
      expect(page.storage.getItem(KEYS.focus)).toBe('AAPL');
      expectSoundMarkup(page);

      await page.click('#viewbar [data-focus=""]');
      expect(holdings(page).map(([symbol]) => symbol)).toEqual(['AAPL', 'NOKIA.HE', 'ASML.AS']);
      expect(page.storage.getItem(KEYS.focus)).toBeNull();
   });

   it('keeps the last known price of a symbol whose refresh failed, and says so', async () => {
      const first = await open();
      const page = await reload(first, { market: (m) => m.fail('NOKIA.HE') });

      expect(warnings(page).join()).toContain('Refresh failed for NOKIA.HE; showing last known price.');
      expect(page.text('#holdings')).toContain('€5.60');
   });

   it('starts empty, keeping the stored data aside, when it cannot be read', async () => {
      const page = await open({ storage: { [KEYS.portfolio]: '{"trades": "corrupted"}' } });

      expect(warnings(page).join()).toContain('Your saved trades could not be read');
      expect(holdings(page)).toEqual([]);
      expect(page.storage.getItem(KEYS.unreadablePortfolio)).toContain('corrupted');
   });
});

describe('hiding amounts', () => {
   it('leaves no amount of money anywhere, in every view, while percentages stay', async () => {
      const page = await open();

      await page.click('#hide-amounts');
      expect(document.documentElement.hasAttribute('data-amounts-hidden')).toBe(true);
      expect(page.storage.getItem(KEYS.hideAmounts)).toBe('1');

      for (const range of ['1D', '1Y', 'All']) {
         await page.click(page.$$('#trend .segmented button').find((b) => b.textContent === range)!);
         expect(visibleAmounts(page), range).toEqual([]);
      }

      expect(page.text('#summary')).toMatch(/[+-]\d+\.\d+%/);
      // Share counts reveal the size too, though they aren't money.
      expect(holdings(page).map(([, shares]) => shares)).toEqual(['•••', '•••', '•••']);

      await page.click('#holdings [data-focus="NOKIA.HE"]');
      expect(visibleAmounts(page)).toEqual([]);

      // The trade form's preview of a sale.
      await page.click('[data-side="sell"]');
      await page.fill('#lot-form', {
         symbol: 'NOKIA.HE',
         date: '2026-11-02',
         quantity: '200',
         unitPrice: '5.10',
         fees: '9',
      });
      expect(page.text('#lot-preview')).toContain('realized');
      expect(visibleAmounts(page)).toEqual([]);
   });
});

describe('the display menu', () => {
   it('applies and remembers a theme and a layout', async () => {
      const page = await open();

      await page.click('[data-theme-choice="zen"]');
      await page.click('[data-layout-choice="cards"]');

      expect(document.documentElement.dataset.theme).toBe('zen');
      expect(document.documentElement.dataset.layout).toBe('cards');
      expect(page.$('[data-theme-choice="zen"]').getAttribute('aria-pressed')).toBe('true');
      expect([page.storage.getItem(KEYS.theme), page.storage.getItem(KEYS.layout)]).toEqual(['zen', 'cards']);

      await reload(page);
      expect(document.documentElement.dataset.theme).toBe('zen');
   });

   it('closes on Escape and on a click outside it', async () => {
      const page = await open();
      const menu = page.$<HTMLDetailsElement>('#display');

      menu.open = true;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(menu.open).toBe(false);

      menu.open = true;
      await page.click('#summary');
      expect(menu.open).toBe(false);
   });
});

describe('recording trades', () => {
   it('records a sale, previewing the gain against the purchase it is matched with', async () => {
      const page = await open();

      await page.click('[data-side="sell"]');
      await page.fill('#lot-form', {
         symbol: 'NOKIA.HE',
         date: '2026-11-02',
         quantity: '200',
         unitPrice: '5.10',
         fees: '9',
      });

      expect(page.text('#lot-status')).toContain('you hold 500 today');
      expect(page.$<HTMLInputElement>('[name="settled"]').value).toBe('1020.00');
      expect(page.text('#lot-preview')).toMatch(
         /Proceeds €1,020\.00 .* realized [+-]\$[\d,.]+ \([+-][\d.]+%\) against the purchase of 2022-05-10/,
      );

      await page.submit('#lot-form');
      expect(holdings(page)).toContainEqual(['NOKIA.HE', '300']);
      expect(storedPortfolio(page).trades).toHaveLength(8);
      expect(page.text('#lot-form-title')).toBe('Add sale');
      expectSoundMarkup(page);
   });

   it('refuses a sale of more shares than were held', async () => {
      const page = await open();

      await page.click('[data-side="sell"]');
      await page.fill('#lot-form', { symbol: 'NOKIA.HE', date: '2026-11-02', quantity: '600', unitPrice: '5.10' });
      await page.submit('#lot-form');

      expect(page.text('#lot-status')).toBe('On 2026-11-02 you held only 500 NOKIA.HE shares.');
      expect(page.$('#lot-status').classList.contains('error')).toBe(true);
      expect(storedPortfolio(page).trades).toHaveLength(7);
   });

   it('records a purchase of a new stock quoted in pence, then fetches its history', async () => {
      const page = await open();

      await page.fill('#lot-form', {
         symbol: 'VOD.L',
         date: '2026-10-01',
         quantity: '1000',
         unitPrice: '0.70',
         settledIn: 'GBP',
      });
      expect(page.text('#lot-status')).toBe('Vodafone Group Plc · trades in GBP');
      await page.submit('#lot-form');

      expect(holdings(page)).toContainEqual(['VOD.L', '1,000']);
      expect(page.text('#holdings')).toContain('£0.72');
      expect(page.market.requests.some((url) => url.includes('quotes=GBP'))).toBe(true);
      expectSoundMarkup(page);
   });

   it('rejects a symbol that does not exist', async () => {
      const page = await open();

      await page.fill('#lot-form', { symbol: 'NOPE' });
      expect(page.text('#lot-status')).toBe('NOPE: No data found, symbol may be delisted');
   });

   it('edits a trade in place', async () => {
      const page = await open();

      await page.click('[data-edit="x1"]');
      expect(page.text('#lot-form-title')).toBe('Edit AAPL sale of 2024-07-15');
      expect(page.$<HTMLDetailsElement>('#manage').open).toBe(true);

      await page.fill('#lot-form', { quantity: '10', settled: '2105' });
      await page.submit('#lot-form');
      expect(holdings(page)).toContainEqual(['AAPL', '45']);
      expect(storedPortfolio(page).trades.find((t) => t.id === 'x1')?.quantity).toBe(10);
   });

   it('deletes a trade only once confirmed, warning when a later sale would oversell', async () => {
      const declined = await open({ confirm: false });

      await declined.click('[data-delete="a1"]');
      expect(declined.dialogs).toEqual([
         'confirm: Remove the AAPL purchase of 2019-06-03?\n\nThe sale of 2024-07-15 would then sell more shares than were held.',
      ]);
      expect(storedPortfolio(declined).trades).toHaveLength(7);

      const page = await open();

      await page.click('[data-delete="s1"]');
      expect(holdings(page).map(([symbol]) => symbol)).toEqual(['AAPL', 'NOKIA.HE']);
      expect(storedPortfolio(page).trades).toHaveLength(6);
   });

   it('sets the cash balance', async () => {
      const page = await open();

      await page.fill('#cash-form', { amount: '5000' });
      await page.submit('#cash-form');

      expect(page.text('#holdings tr.cash')).toContain('€5,000.00');
      expect(page.$<HTMLInputElement>('#cash-form [name="amount"]').placeholder).toBe('Current: €5,000.00');
      expect(storedPortfolio(page).cash).toEqual({ EUR: 5000 });
   });
});

describe('backups', () => {
   const REMINDER = 'Your trades and cash exist only in this browser. Use Export JSON under Trades & cash to keep a copy.';

   it('exports everything, then stops reminding until something changes', async () => {
      const page = await open();

      expect(warnings(page).join()).toContain(REMINDER);
      expect(page.text('#backup-status')).toBe('Not exported yet.');

      await page.click('#export');
      expect(page.downloads.map((d) => d.name)).toEqual([`quickfolio-${TODAY}.json`]);
      const file = JSON.parse(page.downloads[0]!.text) as {
         app: string;
         trades: unknown[];
         cash: Record<string, number>;
      };

      expect([file.app, file.trades.length, file.cash]).toEqual(['QuickFolio', 7, { EUR: 4000 }]);
      expect(warnings(page).join()).not.toContain('only in this browser');
      expect(page.text('#backup-status')).toBe(`Last exported on ${TODAY}.`);

      // Still backed up after a reload: the mark and the data it describes are both stored.
      const again = await reload(page);

      expect(again.text('#backup-status')).toBe(`Last exported on ${TODAY}.`);

      // A change is noted at once, but only warned about once the export is two weeks old.
      await again.fill('#cash-form', { amount: '4500' });
      await again.submit('#cash-form');
      expect(again.text('#backup-status')).toBe(`Last exported on ${TODAY}. Changes since then are only in this browser.`);
      expect(warnings(again).join()).not.toContain('only in this browser');
   });

   it('warns about changes made since an export that is two weeks old', async () => {
      const mark = JSON.stringify({ date: '2026-10-23', fingerprint: 'stale' });
      const page = await open({ storage: { [KEYS.portfolio]: SAMPLE, [KEYS.lastExport]: mark } });

      expect(warnings(page).join()).toContain('Your changes since 2026-10-23 exist only in this browser.');

      const recent = JSON.stringify({ date: '2026-10-24', fingerprint: 'stale' });
      const fresh = await open({ storage: { [KEYS.portfolio]: SAMPLE, [KEYS.lastExport]: recent } });

      expect(warnings(fresh).join()).not.toContain('only in this browser');
   });

   it('dismisses the reminder for good, while the Backup panel still tells', async () => {
      const page = await open();

      await page.click('[data-dismiss-backup]');
      expect(warnings(page).join()).not.toContain('only in this browser');
      expect(page.text('#backup-status')).toBe('Not exported yet.');

      const later = await reload(page, { now: NOW + 60 * 24 * 3_600_000 });

      expect(warnings(later).join()).not.toContain('only in this browser');
      expect(later.text('#backup-status')).toBe('Not exported yet.');
   });

   it('imports an export after confirming, and counts it as backed up', async () => {
      const source = await open();

      await source.click('#export');
      const { name, text } = source.downloads[0]!;

      const page = await open({ storage: {} });

      expect(holdings(page)).toEqual([]);
      await page.upload('#import', name, text);

      expect(page.dialogs).toEqual([`confirm: Replace current trades and cash with 7 trade(s) and 1 day(s) of history from ${name}?`]);
      expect(holdings(page).map(([symbol]) => symbol)).toEqual(['AAPL', 'NOKIA.HE', 'ASML.AS']);
      expect(page.text('#backup-status')).toBe(`Last exported on ${TODAY}.`);
      expect(warnings(page).join()).not.toContain('only in this browser');
   });

   it('refuses a file that is not an export, keeping the current data', async () => {
      const page = await open();

      await page.upload('#import', 'notes.json', '{"trades": "nope"}');

      expect(page.dialogs).toHaveLength(1);
      expect(page.dialogs[0]).toMatch(/^alert: Import failed: /);
      expect(storedPortfolio(page).trades).toHaveLength(7);
   });
});

describe('the transactions list', () => {
   // A purchase a month through 2024 and 2025, alternating two stocks: 24 in all, 12 of each, over three pages of ten.
   const MANY = JSON.stringify({
      trades: Array.from({ length: 24 }, (_, i) => ({
         id: `b${i + 1}`,
         symbol: i % 2 === 0 ? 'AAPL' : 'MSFT',
         date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-02`,
         quantity: 1,
         currency: 'USD',
         gross: 200,
         fxRate: 1,
      })),
      cash: {},
   });
   const dates = (page: Page) => page.$$<HTMLTableRowElement>('#lots tbody tr').map((row) => row.cells[0]!.textContent);
   const pageSize = async (page: Page, size: string) => {
      const select = page.$<HTMLSelectElement>('#lots select[name="page-size"]');

      select.value = size;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await page.settle();
   };

   it('is open from the start, and needs no pages for a short list', async () => {
      const page = await open();

      expect(page.$<HTMLDetailsElement>('#manage').open).toBe(true);
      expect(dates(page)).toHaveLength(7);
      expect(page.$$('#lots .pager')).toEqual([]);
   });

   it('shows ten at a time, newest first, and pages back through the rest', async () => {
      const page = await open({ storage: { [KEYS.portfolio]: MANY } });

      expect(dates(page)).toHaveLength(10);
      expect(dates(page)[0]).toBe('2025-12-02');
      expect(page.text('#lots .pager')).toContain('1–10 of 24');
      expect(page.$<HTMLButtonElement>('[data-page="prev"]').disabled).toBe(true);

      await page.click('[data-page="next"]');
      await page.click('[data-page="next"]');
      expect(dates(page)).toEqual(['2024-04-02', '2024-03-02', '2024-02-02', '2024-01-02']);
      expect(page.text('#lots .pager')).toContain('21–24 of 24');
      expect(page.$<HTMLButtonElement>('[data-page="next"]').disabled).toBe(true);

      await page.click('[data-page="prev"]');
      expect(page.text('#lots .pager')).toContain('11–20 of 24');

      // Narrowing to a stock starts again from its newest trades.
      await page.click('#holdings [data-focus="AAPL"]');
      expect(page.text('#lots .pager')).toContain('1–10 of 12');
      expect(dates(page)[0]).toBe('2025-11-02');
   });

   it('remembers 25 per page', async () => {
      const page = await open({ storage: { [KEYS.portfolio]: MANY } });

      await pageSize(page, '25');
      expect(dates(page)).toHaveLength(24);
      expect(page.text('#lots .pager')).toContain('1–24 of 24');

      const again = await reload(page);

      expect(dates(again)).toHaveLength(24);
      expect(again.$<HTMLSelectElement>('#lots select[name="page-size"]').value).toBe('25');
   });

   it('stays on a page that exists as trades are deleted', async () => {
      const page = await open({ storage: { [KEYS.portfolio]: MANY } });

      await page.click('[data-page="next"]');
      await page.click('[data-page="next"]');

      for (const id of ['b1', 'b2', 'b3']) {
         await page.click(`[data-delete="${id}"]`);
      }

      expect(dates(page)).toEqual(['2024-04-02']);

      // The last one on the page: the page before it is shown.
      await page.click('[data-delete="b4"]');
      expect(page.text('#lots .pager')).toContain('11–20 of 20');
   });
});

describe('browser storage', () => {
   it('asks the browser to keep it once there is something to lose', async () => {
      expect((await open()).persistRequested()).toBe(true);

      const empty = await open({ storage: {} });

      expect(empty.persistRequested()).toBe(false);
      await empty.fill('#cash-form', { amount: '100' });
      await empty.submit('#cash-form');
      expect(empty.persistRequested()).toBe(true);
   });
});

describe('another tab', () => {
   /** The sample as another tab would save it, with `change` applied to its trades. */
   const sampleWith = (change: (trades: { id: string }[]) => object[], cash = { EUR: 4000 }) =>
      JSON.stringify({ trades: change([...LOTS, ...SALES]), cash }, null, 1);
   const VODAFONE = {
      id: 'v1',
      symbol: 'VOD.L',
      date: '2026-10-01',
      quantity: 1000,
      currency: 'GBP',
      cost: 700,
      fees: 0,
      feeCurrency: 'GBP',
      fxRate: 1.3,
      feeFxRate: 1.3,
   };

   it('shows what another tab saved, and keeps it when this tab saves next', async () => {
      const page = await open();
      const theirs = sampleWith((trades) => trades.filter((t) => t.id !== 's1'));

      await page.saveInOtherTab(KEYS.portfolio, theirs);
      expect(holdings(page).map(([symbol]) => symbol)).toEqual(['AAPL', 'NOKIA.HE']);
      // Adopted as stored: writing it back would only repeat the other tab's save.
      expect(page.storage.getItem(KEYS.portfolio)).toBe(theirs);

      await page.fill('#cash-form', { amount: '5000' });
      await page.submit('#cash-form');
      expect(storedPortfolio(page).trades.map((t) => t.id)).not.toContain('s1');
      expect(storedPortfolio(page).cash).toEqual({ EUR: 5000 });
   });

   it('fetches the price of a stock another tab added', async () => {
      const page = await open();

      await page.saveInOtherTab(
         KEYS.portfolio,
         sampleWith((trades) => [...trades, VODAFONE]),
      );
      expect(holdings(page)).toContainEqual(['VOD.L', '1,000']);
      expect(page.text('#holdings')).toContain('£0.72');
      expectSoundMarkup(page);
   });

   it('ignores trades it cannot read, leaving them to the next start', async () => {
      const page = await open();

      await page.saveInOtherTab(KEYS.portfolio, '{"trades": 5}');
      expect(holdings(page)).toHaveLength(3);
      expect(page.storage.getItem(KEYS.unreadablePortfolio)).toBeNull();
      expect(warnings(page).join()).not.toContain('could not be read');
   });

   it('abandons an edit of a trade the other tab removed', async () => {
      const page = await open();

      await page.click('[data-edit="x1"]');
      await page.saveInOtherTab(
         KEYS.portfolio,
         sampleWith((trades) => trades.filter((t) => t.id !== 'x1')),
      );
      expect(page.text('#lot-status')).toBe('The trade being edited was removed in another tab.');
      expect(page.text('#lot-form-title')).toBe('Add sale');
      expect(page.$<HTMLInputElement>('#lot-form [name="symbol"]').value).toBe('');
   });

   it('follows a backup reminder dismissed in another tab', async () => {
      const page = await open();

      expect(warnings(page).join()).toContain('only in this browser');
      await page.saveInOtherTab(KEYS.backupReminderDismissed, 'true');
      expect(warnings(page).join()).not.toContain('only in this browser');
   });
});
