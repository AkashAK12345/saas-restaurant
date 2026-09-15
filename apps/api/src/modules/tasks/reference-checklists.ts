import type { ChecklistItemKindName } from './checklist-values.js';

/**
 * Starter definitions for the reference system's structured daily routines
 * (Module Logic §4.2), expressed on SAMCO's ONE checklist + routine engine —
 * not eleven separate implementations.
 *
 * WHAT IS HERE, AND WHAT IS NOT
 *   Items are taken from what the source document names for each routine.
 *   Where it names only a purpose ("Kitchen hygiene and operations") and no
 *   items, no definition is offered: inventing a company's hygiene standard
 *   would be fabrication. Those three (Kitchen Checklist, BM Checklist,
 *   Operational Checklist) are built by the operator with the same editor.
 *   Photo evidence is omitted everywhere — SAMCO has no object storage yet.
 *   Stock-ledger routines (balance, wastage, indent) capture the figures as
 *   answers only; they do not post to an inventory, which is a future module.
 *
 * Installing one creates an ordinary company checklist template the operator
 * can edit, attach to a branch routine with a deadline, and retire.
 */
export interface ReferenceChecklistItem {
  label: string;
  kind: ChecklistItemKindName;
  is_required: boolean;
}

export interface ReferenceChecklist {
  key: string;
  name: string;
  description: string;
  items: ReferenceChecklistItem[];
}

const req = (label: string, kind: ChecklistItemKindName = 'CHECK'): ReferenceChecklistItem => ({
  label,
  kind,
  is_required: true,
});
const opt = (label: string, kind: ChecklistItemKindName = 'TEXT'): ReferenceChecklistItem => ({
  label,
  kind,
  is_required: false,
});

export const REFERENCE_CHECKLISTS: readonly ReferenceChecklist[] = [
  {
    key: 'eod-report',
    name: 'EOD Report',
    description: 'Day close: sales, petty cash, electricity meter readings, food complaints and a closing note.',
    items: [
      req('Morning sales', 'NUMBER'),
      req('Evening sales', 'NUMBER'),
      req('Petty cash balance', 'NUMBER'),
      req('Electricity meter reading', 'NUMBER'),
      opt('Food complaints'),
      opt('Closing note'),
    ],
  },
  {
    key: 'opening-checklist',
    name: 'Branch Head / Admin Opening Checklist',
    description: 'Pre-opening round of the premises.',
    items: [
      req('Parking'),
      req('Public area'),
      req('Reception', 'RATING'),
      req('Lift'),
      req('Gas bank'),
      req('Kitchen'),
      req('Food display counter'),
      opt('Remarks'),
    ],
  },
  {
    key: 'banquet-opening',
    name: 'Banquet Opening Checklist',
    description: 'Hall readiness before an event.',
    items: [
      req('Hall cleanliness'),
      req('Air conditioners'),
      req('Lights'),
      req('Restrooms'),
      req('Store'),
      req('Linen'),
      req('Equipment'),
      req('TV / music'),
      req('Generators'),
      opt('Remarks'),
    ],
  },
  {
    key: 'biryani-sales',
    name: 'Biryani Sales',
    description: 'Daily capture for the highest-volume product line.',
    items: [req('Biryani portions sold', 'NUMBER'), opt('Remarks')],
  },
  {
    key: 'kitchen-balance',
    name: 'Kitchen Balance Report',
    description: 'Physical stock balance in KG. Figures only — no inventory posting.',
    items: [req('Physical stock balance (KG)', 'NUMBER'), opt('Items counted')],
  },
  {
    key: 'kitchen-wastage',
    name: 'Kitchen Wastage Report',
    description: 'Wastage quantity and reason. Figures only — no inventory posting.',
    items: [req('Wastage quantity (KG)', 'NUMBER'), req('Reason', 'TEXT')],
  },
  {
    key: 'kitchen-stock-request',
    name: 'Kitchen Stock Request',
    description: 'Daily indent to the store or central kitchen. A request note — not a procurement order.',
    items: [req('Items requested', 'TEXT'), opt('Needed by', 'DATE')],
  },
  {
    key: 'corporate-branch-visit',
    name: 'Corporate Branch Visit',
    description: "Head-office auditor's scorecard.",
    items: [
      req('Staff', 'RATING'),
      req('Manager', 'RATING'),
      req('Cashiers', 'RATING'),
      req('Hygiene', 'RATING'),
      opt('Last hygiene audit', 'DATE'),
      opt('Auditor notes'),
    ],
  },
];

/** The reference routines deliberately NOT offered, and why. */
export const REFERENCE_NOT_OFFERED: ReadonlyArray<{ name: string; reason: string }> = [
  { name: 'Kitchen Checklist', reason: 'The source names its purpose but not its items.' },
  { name: 'BM Checklist', reason: 'The source names its purpose but not its items.' },
  { name: 'Operational Checklist', reason: 'The source names its purpose but not its items.' },
];
