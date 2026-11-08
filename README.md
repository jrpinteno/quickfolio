# QuickFolio

A quick-glance tracker for a small stock portfolio. Prices come from Yahoo Finance and exchange rates from the ECB. Gains are worked out the way a tax return needs them, and every number stays in your browser.

![Dashboard: portfolio value, unrealized P/L, annualized return, dividends, performance chart, allocation ring and holdings table](docs/screenshots/dashboard.png)

<sub>All screenshots use a made-up sample portfolio.</sub>

## What it does

- **Holdings at a glance:**
  - Value and unrealized P/L, split into the part from the share price and the part from the currency.
  - Money-weighted annual return, including dividends.
  - Today's change, gross dividends and trailing yield.
  - Distance from the 52-week high, and each holding's weight.
- **Two reporting currencies.** Switch between USD and EUR at any time. Every cost is converted at its own trade-date rate.
- **Sales with realized gains.** Sales are matched to purchases first-in, first-out (FIFO), fees included. In the reporting currency, the gain includes the FX effect between purchase and sale. Totals are shown per year.
- **Performance chart** over 1D, 1W, 1M, 1Y, 5Y and All. It shows value against cost basis, so new money never looks like a gain. The 1D view follows today's session and runs on to the market close.
- **Single-stock view.** Click a symbol to narrow the whole dashboard to that one stock.
- **Themes and layouts:** six themes (Modern, Broadsheet, Terminal, Neon, Brutalist, Zen), and the holdings shown as a table or as cards.
- **Hide amounts** for sharing screenshots. Every amount and share count becomes `•••`, and percentages and per-share prices stay.
- **Full export.** One JSON file holds your trades, cash and history, plus every computed figure in both currencies.

## Getting started

You need Node.js 20.19+, 22.13+ or 24+ (the minimum for Vite 7 and ESLint 10).

```sh
npm install
npm run dev        # http://localhost:41753
```

Scroll down to **Trades & cash** at the bottom of the page and record your first purchase. Prices refresh when the page loads, when you press ↻, and when you return to the tab after more than five minutes.

| Command | What it does |
|---|---|
| `npm run dev` | Development server, with hot reload |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the built app (on the same port, so it finds the same data) |
| `npm test` | Run the test suites with Vitest, including the whole app in a simulated browser |
| `npm run typecheck` | Type-check everything, tests included (Vitest itself doesn't check types) |
| `npm run lint` | ESLint with typescript-eslint's type-aware rules |
| `npm run format` | Format the code with Prettier (`format:check` only reports) |
| `npm run fix` | Add missing braces and blank lines (ESLint), format (Prettier), then report anything left to fix by hand |
| `npm run check` | Type-check, lint, format check and tests in one go: run it before committing |

The app has to run through `npm run dev` or `npm run preview`. Those servers relay the price and FX requests, because Yahoo's API can't be called directly from a browser. A plain static host would serve the page, but nothing would load.

## Where your data lives

Trades, cash, the daily history and your display choices are stored in the browser's `localStorage`, under the address `localhost:41753`. Nothing is sent anywhere except the price and FX lookups.

Once there's something to lose, the app asks the browser to keep its storage even when the disk runs low. The browser decides, and Firefox may ask you. Nothing protects it from **Clear site data** or a profile reset, so the export is your backup. The Backup panel shows when you last exported and whether anything changed since. If changes have gone unexported for two weeks, or you've never exported, a banner says so. Once dismissed it doesn't come back; the Backup panel keeps showing the state.

The app can be open in several tabs at once. A change made in one shows up in the others, so none of them saves an older copy over it.

Data saved under one address isn't visible under another. That's why the port is fixed and the server won't start on a different one. To move to another machine or browser, or just to keep a backup, use **Export JSON** there and **Import JSON** on the other side. Imports read every file version the app has ever written.

### Coming from an older version (port 5173)

Versions before the port change ran on `localhost:5173`, so their data is stored under that address and the new one starts empty.
1. **Export:** on the old version, use **Export JSON**.
2. **Import:** on `localhost:41753`, use **Import JSON**.
3. **Clear the old copy:** once everything is there, open DevTools on `localhost:5173` and use **Application → Storage → Clear site data**.

Display choices (currency, theme, layout, chart range, hide amounts, transactions per page) aren't in the file, so pick them again.

## Using it

### Recording trades

<img src="docs/screenshots/record-sale.png" alt="The trade form recording a sale, with a live preview of proceeds, fees and the realized gain against the purchase it is matched with" />

Enter each trade as it appears on the broker's confirmation:
- **Units and price per unit**, in the instrument's own currency.
- **The amount that actually settled**, which can be in that currency, EUR or USD.
- **Fees**, in whichever currency they were charged.

When the settled amount is in another currency, the rate it implies is recorded as that trade's FX rate. The preview then shows how far it was from the ECB rate. For a sale, the preview also shows the realized gain and which purchases it's matched with. A sale of more shares than you held is refused.

Editing or deleting a trade recalculates everything that depends on it. Deleting a purchase warns you if a later sale would then sell more shares than you held.

The transactions list under the forms runs newest first, 10 or 25 to a page.

**Cash** is entered by hand in EUR. Trades never change it, because the cash balance is whatever your broker account shows.

### The performance chart

<img src="docs/screenshots/intraday.png" alt="One-day performance: holdings value through today's session against the previous close, with the time axis running to the market close" />

For the multi-day ranges, the reference line is cost basis. It steps up with each purchase and down with each sale, so the gap between the two lines is unrealized P/L. For 1D, the reference line is the previous close, and the axis runs from the earliest market open to the latest close. Hover or use the arrow keys to read exact values. The chart also has a table view.

### One stock at a time

![The dashboard narrowed to AAPL: its value, P/L, return, its own trades and sales](docs/screenshots/single-stock.png)

Pick a stock from **View**, or click its symbol in the holdings table. Every section then covers only that stock's trades. Cash is left out, and the stock's weight is still its share of the whole portfolio.

### Themes, layout and hiding amounts

<p>
  <img src="docs/screenshots/display-menu.png" width="300" alt="The display menu: six themes, table or cards layout, and the Hide amounts switch" />
  <img src="docs/screenshots/phone.png" width="300" alt="The dashboard on a phone, with the one-day chart" />
</p>

The ◐ button opens the theme and layout picker. Your choice is remembered, and the page works at phone width too.

![The six themes: Modern, Broadsheet and Terminal on the first row; Neon, Brutalist and Zen on the second](docs/screenshots/themes.png)

<sub>Modern · Broadsheet · Terminal / Neon · Brutalist · Zen</sub>

**Hide amounts** replaces every figure that would reveal the portfolio's size with `•••`. That includes values, costs, cash, dividends, share counts, the chart's money axis and scale, and amounts typed into the forms. Returns, weights and per-share prices stay visible. The ◐ button stays highlighted while amounts are hidden, so a screenshot is never taken in the wrong mode by accident.

![Hidden amounts: every value is •••, while returns, weights and prices stay visible](docs/screenshots/hidden-amounts.png)

## How the numbers are worked out

- **Cost basis** is what each purchase cost, fees included, at the rate on its trade date. The average cost is per share as it trades today, adjusted for later splits.
- **Value** uses the latest price and the latest daily ECB rate. FX rates are daily: there are no intraday rates.
- **Unrealized P/L** is value minus the cost of the shares still held. It splits into a price part and a currency part that add up exactly.
- **Realized gain** is net proceeds at the sale-date rate, minus the matched purchases' cost at their own rates. Matching is first-in, first-out.
- **Annualized return** is money-weighted, so the timing of purchases, sales and dividends counts. It appears once the oldest purchase is a year old.
- **Dividends** are gross, before withholding tax, and come from the price source's history. They count only for shares held going into the ex-date. They aren't added to the portfolio value, because dividends you received are already in your cash.
- **Daily history.** Each day, the last refresh with a complete valuation is saved as that day's snapshot. A partial or stale total is never recorded.

## Data sources and limits

- **Prices, dividends and splits:** Yahoo Finance's chart API, the same endpoint finance.yahoo.com uses. It's unofficial, undocumented and rate-limited, and could change without notice. Use symbols as Yahoo writes them, such as `NOKIA.HE` or `ASML.AS`. Stocks quoted in pence and similar minor units (London's `GBp`) are converted to the main currency (GBP).
- **Exchange rates:** [Frankfurter](https://frankfurter.dev), which serves the ECB's daily reference rates.
- **Supported currencies:** a trade can be in any currency, but it can only be settled in its own currency, EUR or USD. Reporting is in USD or EUR.

## Security and privacy

- **No account and no server-side storage.** Your trades never leave the browser. They go nowhere except into the export files you create.
- **Imported files and API responses are validated before use.** Symbols and currencies must have the shape the app expects, and amounts follow the trade form's rules; anything else is rejected. If stored data ever fails these checks, it's kept aside rather than overwritten.
- **Price and FX lookups carry no credentials.** The dev server removes cookies, auth headers and the page address before passing a request on to Yahoo or Frankfurter. Their answers come back marked as plain data that can never run as a page, and any cookies they try to set are dropped.
- **Full storage is handled.** When the browser's storage fills up, the price cache gives up space first, because it can be fetched again. If even that isn't enough, a banner says what couldn't be saved; a change is never dropped without a warning.
- **No third-party requests on load.** The theme fonts ship with the app, so opening it contacts no font host and works offline. The only outside requests are the price and FX lookups, relayed by the dev server.
- **A content security policy** stops the page from running injected scripts or sending data anywhere other than its own address. The server also forbids other sites from showing the app in a frame.
- **Export files are plain JSON** with your complete financial history, so store them accordingly. Passphrase-protected exports are on the [roadmap](#roadmap).
- **A port of its own.** Storage belongs to an address, so any other project served on the same port could read the portfolio. The app uses 41753 rather than a tool's default, and won't start if something else holds it.

## Roadmap

- **Passphrase-protected exports.** An optional passphrase when exporting, so a backup that ends up in Downloads, cloud sync or an email can't be read without it.
  - **Encryption:** AES-GCM with a 256-bit key, derived from the passphrase with PBKDF2-SHA-256 and a random salt and IV for each file.
  - **Importing:** a protected file asks for its passphrase, then goes through the same validation as any other import. Unprotected files keep importing as they do now.
  - **No recovery:** a backup is only useful if it can be opened, and a forgotten passphrase can't be recovered. So the passphrase stays optional, and plain export stays available.

  Browser storage itself stays unencrypted. A key the app stores itself would sit next to the data it protects, and a passphrase on every load doesn't suit a quick-glance app. For a lost or stolen machine, full-disk encryption (FileVault on macOS) is what protects it.

- **Importing from a broker.** Read the trade history from a broker's CSV export, so years of trades don't have to be typed in one at a time.
- **Deposits and withdrawals.** Record money moving in and out of the account, so the cash balance follows from them. A time-weighted return could then sit next to the money-weighted one, showing performance regardless of when money was added.
- **Net dividends.** Record dividends as received, after withholding tax, alongside the gross figure estimated from the price source.

## Project structure

Plain TypeScript and the DOM, with no framework. It's built with Vite, tested with Vitest, linted with ESLint and formatted with Prettier (code only: the Markdown docs are left as written). [ARCHITECTURE.md](ARCHITECTURE.md) covers the layers, how data flows and the rules worth keeping. In short:

```
src/
  domain/       calculations: ledger, FIFO, valuation, returns, history, allocation
  market/       Yahoo and Frankfurter clients
  backup/       data format: validation, migration, export
  persistence/  localStorage
  app/          state store and actions (refresh, trades, cash, backup)
  ui/           sections, forms, display menu, formatting
  styles/       components, themes, layouts, and the theme fonts
  test/         test builders, a fake market and the simulated page
```

Tests sit next to the code they cover (`*.test.ts`). `architecture.test.ts` checks that each layer imports only what it's allowed to. `main.test.ts` starts the whole app in a simulated browser ([happy-dom](https://github.com/capricorn86/happy-dom)) against a fake market, and uses it the way a person would: it switches views, hides amounts, records and edits trades, exports and imports. The simulated browser has no layout or CSS, so these tests check what the page says and does, not how it looks.

The theme fonts (Fraunces, Inter, JetBrains Mono, Space Grotesk) are under the SIL Open Font License; their licences are in `src/styles/fonts/`.
