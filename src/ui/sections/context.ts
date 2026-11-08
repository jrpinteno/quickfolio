import type { AppState } from '../../app/state';
import type { TaxEstimate } from '../../domain/tax';
import type { Summary } from '../../domain/valuation';
import type { Format } from '../format';

/** Everything a dashboard section renders from; sections read nothing else. */
export interface RenderContext {
   state: AppState;
   /** What is shown: the whole portfolio, or the focused stock alone. */
   s: Summary;
   /** The whole portfolio, whatever is focused. */
   full: Summary;
   focused?: string;
   /** The tax estimate in EUR, when one is chosen and the whole portfolio is shown. */
   tax?: TaxEstimate;
   fmt: Format;
}
