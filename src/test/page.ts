// The whole app in a simulated browser (happy-dom): the real index.html and main.ts, with browser storage
// and a fake market behind fetch. Every page gets a fresh window, so no listener, storage or module state
// carries over from the page before.
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { vi } from 'vitest';
import { fakeMarket, type FakeMarket } from './market-fake';

// The app shows local dates ("today"); pages are opened in UTC so they show the same ones on every machine.
process.env.TZ = 'UTC';

/** The page shell without its scripts: the test starts the app itself, and the theme script only avoids a flash. */
const SHELL = readFileSync(new URL('../../index.html', import.meta.url), 'utf8').replace(/<script\b[^>]*><\/script>/g, '');

export interface PageOptions {
   /** The instant the page is opened at; `Date` stays frozen there. */
   now: number;
   /** Browser storage before the app starts, by key. */
   storage?: Record<string, string>;
   /** What every confirm() answers. */
   confirm?: boolean;
   /** Called before the app starts, to adjust the market (an outage, say). */
   market?: (market: FakeMarket) => void;
}

export interface Download {
   name: string;
   text: string;
}

export interface Page {
   $<T extends Element = HTMLElement>(selector: string): T;
   $$<T extends Element = HTMLElement>(selector: string): T[];
   /** The element's text with whitespace collapsed, as a reader would see it. */
   text(selector: string): string;
   /** Clicks, then waits for whatever the click started. */
   click(target: string | Element): Promise<void>;
   /** Types into the named fields of a form, in order, firing the events typing would. */
   fill(form: string, fields: Record<string, string>): Promise<void>;
   /** Submits a form the way its submit button would. */
   submit(form: string): Promise<void>;
   /** Chooses a file in a file input. */
   upload(input: string, name: string, text: string): Promise<void>;
   /** Stores a value as another tab of the app would, which the browser announces to this one. */
   saveInOtherTab(key: string, value: string): Promise<void>;
   /** Waits until no request is in flight and the page has stopped changing. */
   settle(): Promise<void>;
   storage: Storage;
   market: FakeMarket;
   /** Every confirm() and alert() message, in order. */
   dialogs: string[];
   /** Files the page offered to download. */
   downloads: Download[];
   /** Whether the app asked the browser to keep its storage. */
   persistRequested(): boolean;
}

let open = false;

/**
 * Opens the app as a browser would; close it with `closePage` (an afterEach does).
 *
 * - Parameter start: Imports the app's entry module, which then runs afresh.
 */
export async function openPage(start: () => Promise<unknown>, options: PageOptions): Promise<Page> {
   await closePage();
   GlobalRegistrator.register({ url: 'http://localhost:41753/', width: 1280, height: 2400 });
   open = true;
   // happy-dom lacks the legacy Option constructor that every browser has.
   (globalThis as { Option?: typeof Option }).Option ??= function (text = '', value?: string) {
      const option = document.createElement('option');

      option.text = text;
      option.value = value ?? text;

      return option;
   } as unknown as typeof Option;
   vi.useFakeTimers({ toFake: ['Date'], now: options.now });
   document.write(SHELL);
   // happy-dom does no layout, so elements are 0px wide; without a stated padding the chart's width sum is NaN.
   document.head.insertAdjacentHTML('beforeend', '<style>.card { padding: 0; }</style>');

   for (const [key, value] of Object.entries(options.storage ?? {})) {
      localStorage.setItem(key, value);
   }

   const market = fakeMarket(options.now);

   options.market?.(market);
   globalThis.fetch = market.fetch as unknown as typeof fetch;

   const dialogs: string[] = [];

   globalThis.confirm = (text?: string) => (dialogs.push(`confirm: ${text}`), options.confirm ?? true);
   globalThis.alert = (text?: string) => void dialogs.push(`alert: ${text}`);

   const downloads: Download[] = [];
   const blobs = new Map<string, Blob>();

   URL.createObjectURL = (blob: Blob) => {
      const url = `blob:test/${blobs.size + 1}`;

      blobs.set(url, blob);

      return url;
   };

   URL.revokeObjectURL = () => undefined;
   let reading: Promise<void> = Promise.resolve();

   HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);

      if (blob) {
         reading = reading.then(async () => void downloads.push({ name: this.download, text: await blob.text() }));
      }
   };

   let persistRequested = false;

   Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: async () => ((persistRequested = true), true), persisted: async () => persistRequested },
   });

   const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

   async function settle(): Promise<void> {
      // Answers arrive on timer ticks and the app handles them in microtasks, so a tick with nothing in flight
      // and no new request means the page is done; a few in a row allow for chained work.
      for (let quiet = 0, seen = -1; quiet < 3;) {
         await tick();
         await reading;
         quiet = market.pending === 0 && market.requests.length === seen ? quiet + 1 : 0;
         seen = market.requests.length;
      }
   }

   const $ = <T extends Element = HTMLElement>(selector: string): T => {
      const el = document.querySelector<T>(selector);

      if (!el) {
         throw new Error(`Nothing matches ${selector}`);
      }

      return el;
   };

   vi.resetModules();
   await start();
   await settle();

   return {
      $,
      $$: (selector) => [...document.querySelectorAll(selector)] as never,
      text: (selector) => $(selector).textContent.replace(/\s+/g, ' ').trim(),
      async click(target) {
         (typeof target === 'string' ? $(target) : (target as HTMLElement)).click();
         await settle();
      },
      async fill(form, fields) {
         const f = $<HTMLFormElement>(form);

         for (const [name, value] of Object.entries(fields)) {
            const field = f.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;

            field.value = value;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
            await settle();
         }
      },
      async submit(form) {
         $<HTMLFormElement>(form).requestSubmit();
         await settle();
      },
      async upload(selector, name, text) {
         const input = $<HTMLInputElement>(selector);

         Object.defineProperty(input, 'files', {
            configurable: true,
            value: [new File([text], name, { type: 'application/json' })],
         });
         input.dispatchEvent(new Event('change', { bubbles: true }));
         await settle();
      },
      async saveInOtherTab(key, value) {
         const oldValue = localStorage.getItem(key);

         // Browsers announce a write only to the other tabs, never to the tab that made it.
         localStorage.setItem(key, value);
         window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: value, storageArea: localStorage }));
         await settle();
      },
      settle,
      storage: localStorage,
      market,
      dialogs,
      downloads,
      persistRequested: () => persistRequested,
   };
}

export async function closePage(): Promise<void> {
   if (!open) {
      return;
   }

   open = false;
   vi.useRealTimers();
   await GlobalRegistrator.unregister();
}
