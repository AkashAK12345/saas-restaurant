import type { ChecklistItemKindName } from './checklist-values.js';

/**
 * Starter definitions for the reference system's structured daily routines
 * (Module Logic §4.2), expressed on SAMCO's ONE checklist + routine engine —
 * not eleven separate implementations.
 *
 * WHAT IS HERE, AND WHAT IS NOT
 *   Items are taken from what the source document or the reference app's own
 *   screens name for each routine; nothing is invented beyond finishing a
 *   question the screenshots cut off.
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
  /**
   * Branch-local "HH:MM" the daily task is due by when its routine is set up
   * from the Quick Access tile. Omitted = end of day (23:59).
   */
  due_time?: string;
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
    name: 'Branch Head Opening Checklist',
    description: 'Pre-opening round of the premises. Should ideally be filled before 11:45 AM.',
    due_time: '11:45',
    items: [
      { ...req('Parking area pictures', 'PHOTO', 'Parking & Security'), max_photos: 5 },
      { ...opt('Public area pictures', 'PHOTO', 'Parking & Security'), max_photos: 5 },
      opt('Security present as per roster?', 'TEXT', 'Parking & Security'),
      opt('Valet drivers present as per roster?', 'TEXT', 'Parking & Security'),
      opt('Security & valet staff grooming standard?', 'TEXT', 'Parking & Security'),

      { ...req('Food Display Counter', 'PHOTO', 'Reception & Front Area'), max_photos: 1 },
      { ...opt('Reception area pictures', 'PHOTO', 'Reception & Front Area'), max_photos: 5 },
      opt('Cashiers proper grooming?', 'TEXT', 'Reception & Front Area'),
      opt('Cashiers present on time?', 'TEXT', 'Reception & Front Area'),
      { ...req('Lift working & clean', 'PHOTO', 'Reception & Front Area'), max_photos: 1 },

      opt('Have you received meat, vegetables, dairy products and other supplies?', 'TEXT', 'Kitchen & Supplies'),
      opt('Central kitchen items arrived (Briyani, Masala, Gravies)?', 'TEXT', 'Kitchen & Supplies'),
      opt('All departments ready for service (Chinese, Tandoor, Indian)?', 'TEXT', 'Kitchen & Supplies'),
      { ...req('Kitchen area pictures', 'PHOTO', 'Kitchen & Supplies'), max_photos: 10 },
      { ...req('Gas Bank', 'PHOTO', 'Kitchen & Supplies'), max_photos: 1 },

      opt('Restaurant ready for service?', 'TEXT', 'Restaurant Readiness'),
      opt('Manager present on time?', 'TEXT', 'Restaurant Readiness'),
      opt('Back area clean & tidy?', 'TEXT', 'Restaurant Readiness'),

      opt('Banquet bookings details for today?', 'TEXT', 'Operations & Compliance'),
      opt('CCTV cameras working?', 'TEXT', 'Operations & Compliance'),
      opt('Generators working & fuel status?', 'TEXT', 'Operations & Compliance'),
      opt('Monthly calendar activity followed?', 'TEXT', 'Operations & Compliance'),
      opt('Staff using biometrics?', 'TEXT', 'Operations & Compliance'),

      opt('Any additional remarks or observations', 'TEXT', 'Remarks'),
    ],
  },
  {
    key: 'banquet-opening',
    name: 'Banquet Opening Checklist',
    description: "Hall readiness for the day's events. Please complete this checklist after your duty starts.",
    items: [
      opt('Number of parties (L/D), Pax guarantee & Hall name', 'TEXT', "Today's Bookings"),

      opt('Q1. Is the hall clean and tidy?', 'YES_NO', 'Hall Cleanliness'),
      opt('Q2. Are the toilets neat and clean?', 'YES_NO', 'Hall Cleanliness'),
      opt('Q3. Are chair covers, table cloths & frills clean?', 'YES_NO', 'Hall Cleanliness'),

      opt('Q4. Are all Banquet Hall ACs working?', 'YES_NO', 'Climate & Lighting'),
      opt('Q5. Are all Banquet Hall Room ACs working?', 'YES_NO', 'Climate & Lighting'),
      opt('Q6. Are all Banquet Hall lights working?', 'YES_NO', 'Climate & Lighting'),

      opt('Q7. Are all TVs in the Banquet Halls working?', 'YES_NO', 'AV Equipment'),
      opt('Q8. Are all Speakers in the Banquet Halls working?', 'YES_NO', 'AV Equipment'),
      opt('Q9. Are all Amplifiers in the Banquet Halls working?', 'YES_NO', 'AV Equipment'),
      opt('Q10. Are all Projectors in the Banquet Halls working?', 'YES_NO', 'AV Equipment'),

      opt('Any additional remarks (optional)', 'TEXT', 'Remarks'),
    ],
  },
  {
    key: 'biryani-sales',
    name: 'Biryani Sales Report',
    description: "The day's purchase, morning and evening sales and order quantity, per product line.",
    items: [
      ...['Chicken Biryani (Non-Veg)', 'Mutton Biryani (Non-Veg)', 'Chicken Mandi (Non-Veg)', 'Mutton Mandi (Non-Veg)', 'Appam (Veg)'].flatMap(
        (product) => [
          opt('Purchase (KG)', 'NUMBER', product),
          opt('Morning (KG)', 'NUMBER', product),
          opt('Evening (KG)', 'NUMBER', product),
          opt('Order Qty (KG)', 'NUMBER', product),
        ],
      ),
      opt('Remarks', 'TEXT', 'Remarks'),
    ],
  },
  {
    key: 'kitchen-balance',
    name: 'Kitchen Balance Report',
    description: 'Closing balance per item, by kitchen section. Figures only — no inventory posting.',
    items: [
      opt('Chicken Biryani Rice', 'NUMBER', 'Biryani'),
      opt('Mutton Biryani Rice', 'NUMBER', 'Biryani'),
      opt('Mutton Biryani Pieces', 'NUMBER', 'Biryani'),
      opt('Chicken Biryani Pieces', 'NUMBER', 'Biryani'),

      opt('Chicken Mandi Pc', 'NUMBER', 'Mandi'),
      opt('Mutton Mandi Pc', 'NUMBER', 'Mandi'),
      opt('Mandi Rice', 'NUMBER', 'Mandi'),
      opt('Ribs', 'NUMBER', 'Mandi'),
      opt('Ribs — last supplied date', 'DATE', 'Mandi'),
      opt('Raan', 'NUMBER', 'Mandi'),
      opt('Raan — last supplied date', 'DATE', 'Mandi'),

      opt('Idiyappam', 'NUMBER', 'Breads'),
      opt('Khubus', 'NUMBER', 'Breads'),

      opt('Kurma Gravy', 'NUMBER', 'Indian'),
      opt('Kurma Pieces', 'NUMBER', 'Indian'),
      opt('Paya Gravy', 'NUMBER', 'Indian'),
      opt('Paya Pieces', 'NUMBER', 'Indian'),
      opt('Fish Fry', 'NUMBER', 'Indian'),
      opt('Fish Fry — last supplied date', 'DATE', 'Indian'),
      opt('Fish', 'NUMBER', 'Indian'),
      opt('Fish — last supplied date', 'DATE', 'Indian'),

      opt('Fish Tikka', 'NUMBER', 'Tandoor'),
      opt('Mahi Mahi', 'NUMBER', 'Tandoor'),
      opt('Tandoor Chicken', 'NUMBER', 'Tandoor'),
      opt('Chicken Tikka', 'NUMBER', 'Tandoor'),
      opt('Malai Kabab', 'NUMBER', 'Tandoor'),
      opt('Tangdi Kabab', 'NUMBER', 'Tandoor'),
      opt('Hariyali', 'NUMBER', 'Tandoor'),

      opt('Pomfret Black', 'NUMBER', 'Fish'),
      opt('Pomfret Black — last supplied date', 'DATE', 'Fish'),
      opt('Pomfret White', 'NUMBER', 'Fish'),
      opt('Pomfret White — last supplied date', 'DATE', 'Fish'),
      opt('Karimeen', 'NUMBER', 'Fish'),
      opt('Karimeen — last supplied date', 'DATE', 'Fish'),
      opt('Valameen', 'NUMBER', 'Fish'),
      opt('Valameen — last supplied date', 'DATE', 'Fish'),
      opt('Crab Meat (KG)', 'NUMBER', 'Fish'),
      opt('Crab Meat (KG) — last supplied date', 'DATE', 'Fish'),
      opt('Red Snapper', 'NUMBER', 'Fish'),
      opt('Red Snapper — last supplied date', 'DATE', 'Fish'),
      opt('Sea Bass / Koduva', 'NUMBER', 'Fish'),
      opt('Sea Bass / Koduva — last supplied date', 'DATE', 'Fish'),

      opt('P.P.B.B.Q', 'NUMBER', 'BBQ'),
      opt('Alfaham', 'NUMBER', 'BBQ'),
      opt('Habibi', 'NUMBER', 'BBQ'),
      opt('Grilled Chicken', 'NUMBER', 'BBQ'),
      opt('B.B.Q', 'NUMBER', 'BBQ'),
      opt('SBC', 'NUMBER', 'BBQ'),
      opt('Shawarma', 'NUMBER', 'BBQ'),
    ],
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
  {
    key: 'branch-manager-checklist',
    name: 'BM Checklist',
    description: "The branch manager's daily round: staff, premises, equipment and the day's briefing.",
    items: [
      req('Manager Name', 'TEXT', 'Checklist Information'),

      opt(
        'Are all the staff well-groomed as per the Samco standards? (clean and ironed uniform, with name badge, well-polished shoes)',
        'YES_NO',
        'Daily Checks',
      ),
      opt('TV & Music is on?', 'YES_NO', 'Daily Checks'),
      opt('Is the scheduled staff present and on time?', 'YES_NO', 'Daily Checks'),
      opt('Is the dining area clean and presentable? (Tables, chairs, floors, windows, etc.)', 'YES_NO', 'Daily Checks'),
      opt('Are all equipment and appliances functioning properly? (Lights, air conditioning, POS system)', 'YES_NO', 'Daily Checks'),
      opt('Has the restroom been cleaned & sanitized properly and checklist has been filled?', 'YES_NO', 'Daily Checks'),

      opt('Grooming', 'YES_NO', 'Points Discussed on Briefing'),
      opt('Cleanliness', 'YES_NO', 'Points Discussed on Briefing'),
      opt("Yesterday's Feedback", 'YES_NO', 'Points Discussed on Briefing'),
      opt("Day's Special", 'YES_NO', 'Points Discussed on Briefing'),
      opt('Menu Knowledge', 'YES_NO', 'Points Discussed on Briefing'),
      opt('Staff Concern', 'YES_NO', 'Points Discussed on Briefing'),
      opt('Please elaborate the Briefing points for the day', 'TEXT', 'Points Discussed on Briefing'),

      req('Remarks/Comments', 'TEXT', 'Remarks/Comments'),
    ],
  },
];
