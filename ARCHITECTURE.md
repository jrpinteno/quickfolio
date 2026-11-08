# Architecture

QuickFolio is a single page with no framework. Code is split into layers, and
dependencies only point inward. `src/architecture.test.ts` enforces this.

```
ui ──────────► app ──────► domain ◄── market
                │             ▲
                └─► backup ───┘
persistence ──► backup, domain
main.ts: wires everything together
```

| Directory | Holds | May import |
|---|---|---|
| `domain/` | The ledger and every calculation: FIFO matching, valuation, returns, history, intraday curve, allocation. Pure functions over plain data. | `domain` |
| `market/` | Yahoo and Frankfurter clients plus their response parsing. The only `fetch` calls. | `domain` |
| `backup/` | The data format: validation and migration of stored or imported data (`schema.ts`) and the export file (`export.ts`). | `domain` |
| `persistence/` | localStorage: every key lives in `storage.ts`, and nothing else touches storage. | `backup`, `domain` |
| `app/` | State (`AppState` in one store), use cases (refresh, save/delete trade, cash, backup) and ports (`PriceProvider`, `RateProvider`). No DOM, storage or network: those are injected. | `backup`, `domain` |
| `ui/` | Rendering and event wiring. Sections render from a `RenderContext` and read nothing global. | `app`, `domain` |
| `styles/` | `index.css` imports everything in cascade order: components, then themes (one file each), then layouts. | |
| `test/` | Shared builders for the colocated `*.test.ts` suites, a fake market answering as Yahoo and Frankfurter would, and the simulated page `main.test.ts` runs the app in. | `domain` |

## How data flows

1. **Loading the store.** `main.ts` loads the portfolio, market cache, snapshots, preferences and backup state (latest export, dismissed reminder) into one store.
2. **Writing back.** Subscribers write whatever changed back to storage. What another tab saves comes back in through the browser's `storage` event (see **Several tabs** below).
3. **Rendering.** The dashboard re-renders every section on each change.
4. **Handling user actions.** The UI calls `app/` functions such as `updateView`, `commitTrade` and `refresh`. Those functions replace state, and nothing mutates it.
5. **Formatting amounts.** Every amount goes through `ui/format.ts` `createFormat`. "Hide amounts" is therefore decided in one place: `money` and `qty` mask, while `perShare` and percentages stay visible.
6. **Local-only state.** The trade form keeps its draft to itself; only a saved trade reaches the store. The transactions list keeps its current page the same way, while the page size is a remembered view option. Theme and layout are presentation only and live in `ui/display/`.

## Rules worth keeping

- **Saving never throws.** `persistence/repositories.ts` `createSave` writes what can't be fetched again first (trades, cash, daily history), and shrinks the market cache when storage is full. Whatever still doesn't fit becomes `saveError`, which shows as a banner. A subscriber that throws no longer stops the others (`app/store.ts`).
- **Several tabs.** Every tab holds the whole portfolio in memory and saves all of it on a change, so a tab that missed another's save would write its older copy over it. `main.ts` therefore adopts what another tab saves (trades and cash, daily history, the backup state; `loadSavedElsewhere` in `persistence/repositories.ts`), and doesn't write it back. A portfolio it can't read is ignored rather than replacing this tab's trades with an empty list. The market cache and display choices stay per tab. Two consequences for new code: a change computed across an `await` must apply to the state as it is afterwards (`commitTrade` adds the trade to the current ledger, not to the ledger it was prepared against), and UI holding a reference to a trade must cope with it disappearing (the trade form drops an edit whose trade was removed).
- **Storage keys are permanent.** The keys in `persistence/storage.ts` locate data already saved in users' browsers. A format change gets a new key plus a migration in `backup/schema.ts`; an existing key is never renamed.
- **Validate untrusted data where it enters.** Imports, browser storage, Yahoo and Frankfurter responses and the trade form go through `domain/codes.ts`: currencies must be three capital letters, and symbols must be capital letters, digits and `.^=-`. These values are put into markup and used as object keys, so the check is what keeps them safe. Every other string is escaped with `esc`. Until it's checked, untrusted JSON is typed as what it might be (`Unchecked<T>` in `backup/schema.ts`, or `T | null`), never as the type it should become: otherwise the type checker and the linter call the guards unnecessary, and a missing one goes unnoticed.
- **Content security policy.** The policy in `index.html` allows scripts only from this origin and never inline, so `public/theme-boot.js` is a file. Requests and fonts go only to this origin: the fonts are bundled from `styles/fonts/`. A new external service goes through the dev server's proxy in `vite.config.ts`, as Yahoo and Frankfurter do, so the page still only talks to its own address. That is the built app's policy: the dev server adds its hot-reload socket and the worker its client uses to wait for a restart (`devPolicy` in `vite.config.ts`).
- **Backups are tracked by content.** An export or import stores `KEYS.lastExport`: its date and a fingerprint of the trades and cash. `app/backup.ts` `backupStatus` compares the fingerprint with what is loaded now, so a change since the last export is noticed even across reloads. Dismissing the reminder sets `KEYS.backupReminderDismissed`, and it doesn't show again.
- **Page tests.** `main.test.ts` opens the real `index.html` and `main.ts` in a fresh simulated window per test (`test/page.ts`), with `fetch` answered by `test/market-fake.ts`. It covers the wiring, which unit tests don't. It doesn't cover layout, CSS or how anything looks, so check a visual change in a browser.
- **Before committing:** `npm run fix` applies the code style (braces on every block, blank lines between steps, 3-space indentation, 137-column lines), and `npm run check` runs the type check, lint, format check and tests. Tests alone don't check types.
- **New themes:** add `styles/themes/<key>.css`, scoped to `html[data-theme='<key>']`. Then add an entry to `ui/display/themes.ts` and an `@import` to `styles/index.css`.
- **Ring order and colors.** `domain/allocation.ts` orders segments largest first; colors follow the holding (by first purchase), so they don't change as prices move. The palette is validated only for consecutive slots, so some neighbours are hard to tell apart with color blindness: the legend's labels and the gaps between segments carry identity.
- **New amounts on screen:** format them with `fmt.money` or `fmt.qty` so they hide with the rest.
