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
 *   would be fabrication. That one (BM Checklist) is built by the operator
 *   with the same editor.
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
  /** Group label; items sharing one render together. Omitted renders flat. */
  section?: string;
  /** PHOTO items: how many photos it takes. Omitted = the default (5). */
  max_photos?: number;
}

export interface ReferenceChecklist {
  key: string;
  name: string;
  description: string;
  items: ReferenceChecklistItem[];
}

const req = (
  label: string,
  kind: ChecklistItemKindName = 'CHECK',
  section?: string,
): ReferenceChecklistItem => ({
  label,
  kind,
  is_required: true,
  ...(section ? { section } : {}),
});
const opt = (
  label: string,
  kind: ChecklistItemKindName = 'TEXT',
  section?: string,
): ReferenceChecklistItem => ({
  label,
  kind,
  is_required: false,
  ...(section ? { section } : {}),
});

export const REFERENCE_CHECKLISTS: readonly ReferenceChecklist[] = [
  {
    key: 'eod-report',
    name: 'EOD Report',
    description: "Day close: today's summary, electricity board reading and tomorrow's operational info.",
    items: [
      opt('Review for the day', 'TEXT', "Today's Summary"),
      opt('Food Complaint', 'TEXT', "Today's Summary"),
      opt('Food Complaint Images', 'PHOTO', "Today's Summary"),
      opt('Service Complaints', 'TEXT', "Today's Summary"),
      opt('Activity Calendar task', 'TEXT', "Today's Summary"),
      opt('Remarks', 'TEXT', "Today's Summary"),
      opt('Report Photos', 'PHOTO', "Today's Summary"),
      opt('EB Reading', 'NUMBER', 'EB'),
      req('EB Photos', 'PHOTO', 'EB'),
      opt('EB Comments', 'TEXT', 'EB'),
      opt('Banquets Function', 'TEXT', "Tomorrow's Operational Info"),
      opt('Banquets Staff requirement', 'TEXT', "Tomorrow's Operational Info"),
      opt('Restaurant staff Needed', 'TEXT', "Tomorrow's Operational Info"),
      opt('Table Reservation', 'TEXT', "Tomorrow's Operational Info"),
      opt('Weekly off/leave/BM/Asst Manager', 'TEXT', "Tomorrow's Operational Info"),
      req('Your name', 'TEXT', 'Submitted By'),
    ],
  },
  {
    key: 'operational-checklist',
    name: 'Operational Checklist',
    description: 'Daily audit of security, parking, reception, restrooms, service and banquets.',
    items: [
      opt('Was security present at the entrance?', 'CHECK', 'Security'),
      opt('Grooming of the security?', 'TEXT', 'Security'),
      opt('Was the guest greeted by the security?', 'CHECK', 'Security'),
      opt('Does the security have basic knowledge of operations?', 'CHECK', 'Security'),
      opt('Overall Rating for security (scale 1-5)', 'RATING', 'Security'),

      opt('Is the parking area kept clean and in good condition?', 'TEXT', 'Parking / Driver'),
      opt('In the parking area, were the vehicles parked properly?', 'TEXT', 'Parking / Driver'),
      opt('Valet drivers available to assist the guest vehicles?', 'TEXT', 'Parking / Driver'),
      opt('Grooming of the driver?', 'TEXT', 'Parking / Driver'),
      opt('Picture of the parking area', 'PHOTO', 'Parking / Driver'),
      opt('Overall Rating for driver (scale 1-5)', 'RATING', 'Parking / Driver'),

      opt('Is the reception area clean, tidy, and efficiently organized?', 'TEXT', 'Reception'),
      opt('Did the guest receive a warm welcome upon arrival?', 'TEXT', 'Reception'),
      opt('Are take-away and delivery orders handled promptly and correctly?', 'TEXT', 'Reception'),
      opt('Did the cashier & GRE maintain neat and professional grooming?', 'TEXT', 'Reception'),
      opt('Are guest phone calls attended professionally and promptly?', 'TEXT', 'Reception'),
      opt('Is a proper farewell extended to guests as they leave?', 'TEXT', 'Reception'),
      opt('Was the music on / TV playing the Samco playlist?', 'TEXT', 'Reception'),
      opt('Was the reception area ready to welcome guests?', 'TEXT', 'Reception'),
      opt('Picture of the reception', 'PHOTO', 'Reception'),

      opt('Name of Branch Manager / Asst Manager', 'TEXT', 'Lift & Manager Info'),
      opt('Was the lift clean and ready for the guest?', 'TEXT', 'Lift & Manager Info'),
      opt('Photo of the lift', 'PHOTO', 'Lift & Manager Info'),

      opt('Restaurant restrooms is clean and the consumables are refilled?', 'TEXT', 'Restrooms & Restaurant Readiness'),
      opt('In restroom taps, toilet flushes, and hand dryers are working properly?', 'TEXT', 'Restrooms & Restaurant Readiness'),
      opt('Is the overall freshness of the toilet maintained?', 'TEXT', 'Restrooms & Restaurant Readiness'),
      opt('Was the restaurant ready for service?', 'TEXT', 'Restrooms & Restaurant Readiness'),
      opt('Were the dust bins cleaned and fresh covers placed?', 'TEXT', 'Restrooms & Restaurant Readiness'),
      opt('Lights and air conditioning were functioning properly?', 'TEXT', 'Restrooms & Restaurant Readiness'),
      opt('Was the back area of the restaurant clean and organized?', 'TEXT', 'Restrooms & Restaurant Readiness'),
      opt('Rate the overall Readiness of the Restaurant', 'RATING', 'Restrooms & Restaurant Readiness'),

      opt('Did all staff report on time according to the roster?', 'TEXT', 'Staff & Service'),
      opt('Were the guests received at the entrance?', 'TEXT', 'Staff & Service'),
      opt('Did staff accompany guests to their assigned tables?', 'TEXT', 'Staff & Service'),
      opt('Were orders taken in a timely manner by the staff?', 'TEXT', 'Staff & Service'),
      opt('Does the staff have the menu knowledge?', 'TEXT', 'Staff & Service'),
      opt('Is the food delivered in a timely manner?', 'TEXT', 'Staff & Service'),
      opt('Did the captain or manager interact with the guests?', 'TEXT', 'Staff & Service'),
      opt('Were the bills brought to tables promptly on request?', 'TEXT', 'Staff & Service'),
      opt('Did the staff ask the guest for reviews politely?', 'TEXT', 'Staff & Service'),
      opt('Did the staff thank the guest and give a proper farewell?', 'TEXT', 'Staff & Service'),
      opt('Does the branch manager interact with guests?', 'TEXT', 'Staff & Service'),
      opt('Does the branch manager regularly inspect the floor?', 'TEXT', 'Staff & Service'),
      opt('Was the activity calendar available and being followed?', 'TEXT', 'Staff & Service'),
      opt('Picture of the restaurant', 'PHOTO', 'Staff & Service'),
      opt('Picture of the restroom area', 'PHOTO', 'Staff & Service'),
      opt('Rate the overall operation of the restaurant', 'RATING', 'Staff & Service'),

      opt('Is the banquets hall clean and tidy to show guests?', 'TEXT', 'Banquets'),
      opt('Rooms inside banquet hall cleaned and ready?', 'TEXT', 'Banquets'),
      opt('Are all equipment (Mike, TV, Speakers) working properly?', 'TEXT', 'Banquets'),
      opt('Is the banquets restrooms clean? (if no, mention the issue)', 'TEXT', 'Banquets'),
      opt('Are table cloths, frills clean and chairs set properly?', 'TEXT', 'Banquets'),
      opt('Is the banquets store room organized properly?', 'TEXT', 'Banquets'),
      opt('Was the back area of the banquets clean and organized?', 'TEXT', 'Banquets'),
      opt('Picture of the banquets', 'PHOTO', 'Banquets'),

      opt('Remarks', 'TEXT', 'Remarks'),
    ],
  },
  {
    key: 'kitchen-checklist',
    name: 'Kitchen Checklist',
    description: 'Daily kitchen round: supplies and readiness, cleanliness and storage, compliance, and photos.',
    items: [
      opt('Have you received the meat, vegetables, dairy products and other supplies on time?', 'TEXT', 'Supplies & Readiness'),
      opt('Has all the central kitchen items reached as per your indent?', 'TEXT', 'Supplies & Readiness'),
      opt('Does all the kitchen equipment (Burners, refrigerators, exhaust) work properly?', 'TEXT', 'Supplies & Readiness'),
      opt('Are all the departments ready for service (Chinese, Tandoor, Indian, etc.)?', 'TEXT', 'Supplies & Readiness'),
      opt('Are we ready with the special menu of the day?', 'TEXT', 'Supplies & Readiness'),
      opt('Not available items of the day?', 'TEXT', 'Supplies & Readiness'),

      opt('Are the refrigerators, chillers & deep freezers clean and at the right temperature?', 'TEXT', 'Cleanliness & Storage'),
      opt('Are storage areas, shelves, and racks cleaned and organized?', 'TEXT', 'Cleanliness & Storage'),
      opt("Have you got all the groceries for today's party orders?", 'TEXT', 'Cleanliness & Storage'),

      opt('Was the activity for the day followed as per the monthly activity calendar?', 'TEXT', 'Compliance & Audits'),
      opt('Is deep cleaning of the kitchen, including floors, walls and exhaust, done as scheduled?', 'TEXT', 'Compliance & Audits'),
      opt('Has the kitchen been cleaned & hygiene maintained after service?', 'TEXT', 'Compliance & Audits'),
      opt('When was the last hygiene audit conducted? (mention the date)', 'TEXT', 'Compliance & Audits'),
      opt('Are all the staff properly groomed and wearing uniforms, caps and gloves?', 'TEXT', 'Compliance & Audits'),
      opt('Are raw and cooked foods stored separately to avoid cross-contamination?', 'TEXT', 'Compliance & Audits'),
      opt('Is the FIFO process being followed for short-expiry items?', 'TEXT', 'Compliance & Audits'),
      opt('When was the last pest control Service done in the kitchen?', 'TEXT', 'Compliance & Audits'),

      { ...opt('Pictures of the kitchen area (pot wash, plate wash, vegetable storage area)', 'PHOTO', 'Images'), max_photos: 10 },
      { ...opt('Pictures of the kitchen area inside the fridge', 'PHOTO', 'Images'), max_photos: 10 },
      { ...req('Pictures of the kitchen staff with head caps', 'PHOTO', 'Images'), max_photos: 5 },
      { ...req('Upload couple of food label photos', 'PHOTO', 'Images'), max_photos: 10 },
      { ...req('Pictures of the Food Packing area', 'PHOTO', 'Images'), max_photos: 10 },
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
  { name: 'BM Checklist', reason: 'The source names its purpose but not its items.' },
];
