// The shapes identifiers must have wherever they enter the app (an import, browser storage, a price
// source, the trade form). They are interpolated into markup and used as object keys, so anything
// else is rejected at the boundary rather than escaped case by case.

/** An ISO 4217-style currency code: three capital letters. */
export const isCurrencyCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);

/**
 * A Yahoo symbol as stored: capitals, digits and `. ^ = -` (`NOKIA.HE`, `BRK-B`, `^GSPC`, `EURUSD=X`).
 * Being uppercase, it never collides with a built-in object property such as `constructor`.
 */
export const isSymbol = (v: unknown): v is string => typeof v === 'string' && /^[A-Z0-9.^=-]{1,32}$/.test(v);

/** A calendar date as `YYYY-MM-DD`. */
export const isYear = (v: unknown): v is string => typeof v === 'string' && /^(19|20)\d{2}$/.test(v);
export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** A number that survives a round trip through JSON (no NaN or Infinity). */
export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A finite number above zero: a price, rate or amount. */
export const isPositive = (v: unknown): v is number => isFiniteNumber(v) && v > 0;
