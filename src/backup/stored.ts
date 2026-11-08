import type { Snapshot } from '../domain/snapshots';
import type { Portfolio } from '../domain/types';
import type { ExportMark } from './export';

/** What is kept between visits because it can't be fetched again, whatever storage keeps it. */
export interface Stored {
   portfolio: Portfolio;
   snapshots: Snapshot[];
   /** The latest export or import, for the backup reminder. */
   lastExport?: ExportMark;
   backupReminderDismissed: boolean;
}

/** Part of what is kept: what changed and needs saving, or what was saved elsewhere and needs adopting. */
export type StoredChange = Partial<Stored>;
