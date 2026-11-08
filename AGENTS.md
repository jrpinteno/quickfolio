# Working on QuickFolio

Read [ARCHITECTURE.md](ARCHITECTURE.md) first: layers, data flow and the rules worth keeping. This file is how to change the code safely.

## Commands

- `npm run dev`: the app on http://localhost:41753. Never change the port: users' data is stored under that address.
- `npm run fix`: braces, blank lines and formatting (ESLint, then Prettier, then a lint report).
- `npm run check`: type-check, lint, format check and tests. A change is done when this passes. `npm test` alone doesn't check types.

## Before you call it done

- Run `npm run fix`, then `npm run check`.
- UI wiring changed: add or extend a page test in `src/main.test.ts` (simulated browser, fake market, frozen clock).
- Anything visible changed: look at it in a real browser. Page tests can't see layout or CSS.
- Behaviour changed: update README.md and ARCHITECTURE.md in the same change. Prettier doesn't touch Markdown.

## Easy to get wrong

- **"Unnecessary condition" on untrusted data:** fix the type (`Unchecked<T>`, `T | null`), never delete the guard. Imports, storage and API responses can be anything.
- **Amounts on screen:** go through `fmt.money` / `fmt.qty`, or they won't hide with "Hide amounts".
- **Storage keys** (`persistence/storage.ts`) are permanent. A format change gets a new key plus a migration in `backup/schema.ts`.
- **Side effects stay in their layer:** `fetch` only in `market/`, `localStorage` only in `persistence/`, `document`/`window` only in `ui/` and `main.ts` (`persistence/` may listen for the window's `storage` event). `architecture.test.ts` enforces this.
- **Storage goes through the ports** (`PortfolioRepository`, `MarketCache` in `app/ports.ts`). Save rules belong in `app/persist.ts`, not in an implementation or `main.ts`. The ports are async: don't rely on the browser implementation answering at once.
- **Content security policy:** no inline scripts, no outside hosts. A new data source goes through the proxy in `vite.config.ts`. Dev-only allowances go in `devPolicy`, not in `index.html`.
- **Long lines (137 max):** Prettier won't break strings, comments or HTML templates. Wrap them by hand: split text with `+`, and break templates only between attributes. Never put a line break inside an attribute value (a tooltip would show it).
- **Editing `vite.config.ts`** restarts a running dev server.
- **Allocation ring colours** are validated only for neighbouring palette slots (see `styles/allocation.css`); don't reorder slots casually.

## Data

- Tests, screenshots and examples use made-up portfolios only. Never commit an export file (`quickfolio-*.json` is ignored for that reason).
