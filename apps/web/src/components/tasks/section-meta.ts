import type { AppIconName } from '@/components/app/icons';
import styles from './tasks.module.css';

export type SectionTone = 'green' | 'blue' | 'amber' | 'purple' | 'red' | 'neutral';
type Tone = SectionTone;

const TONE_CLASSES: Record<Tone, { iconClass: string; accentClass: string }> = {
  green: { iconClass: styles.toneGreen, accentClass: styles.accentGreen },
  blue: { iconClass: styles.toneBlue, accentClass: styles.accentBlue },
  amber: { iconClass: styles.toneAmber, accentClass: styles.accentAmber },
  purple: { iconClass: styles.tonePurple, accentClass: styles.accentPurple },
  red: { iconClass: styles.toneRed, accentClass: styles.accentRed },
  neutral: { iconClass: styles.toneNeutral, accentClass: '' },
};

/**
 * Icon + colour for a checklist section, keyed by the exact `section` label a
 * checklist's items carry. Purely cosmetic and purely frontend: any section
 * still groups and renders together without an entry here — an unmapped
 * label just gets the neutral look.
 */
const SECTION_META: Record<string, { icon: AppIconName; tone: Tone }> = {
  // EOD Report
  "Today's Summary": { icon: 'calendarCheck', tone: 'green' },
  EB: { icon: 'lightning', tone: 'blue' },
  "Tomorrow's Operational Info": { icon: 'calendar', tone: 'amber' },
  'Submitted By': { icon: 'person', tone: 'purple' },
  // Operational Checklist
  Security: { icon: 'shield', tone: 'blue' },
  'Parking / Driver': { icon: 'parking', tone: 'amber' },
  Reception: { icon: 'door', tone: 'red' },
  'Lift & Manager Info': { icon: 'lift', tone: 'blue' },
  'Restrooms & Restaurant Readiness': { icon: 'broom', tone: 'green' },
  'Staff & Service': { icon: 'people', tone: 'green' },
  Banquets: { icon: 'party', tone: 'red' },
  Remarks: { icon: 'chat', tone: 'blue' },
  // Kitchen Checklist
  'Supplies & Readiness': { icon: 'archive', tone: 'blue' },
  'Cleanliness & Storage': { icon: 'broom', tone: 'green' },
  'Compliance & Audits': { icon: 'clipboardCheck', tone: 'red' },
  Images: { icon: 'image', tone: 'amber' },
  // Branch Head Opening Checklist
  'Parking & Security': { icon: 'parking', tone: 'blue' },
  'Reception & Front Area': { icon: 'store', tone: 'amber' },
  'Kitchen & Supplies': { icon: 'fridge', tone: 'red' },
  'Restaurant Readiness': { icon: 'fork', tone: 'green' },
  'Operations & Compliance': { icon: 'checklist', tone: 'blue' },
  // Banquet Opening Checklist
  "Today's Bookings": { icon: 'calendar', tone: 'blue' },
  'Hall Cleanliness': { icon: 'broom', tone: 'red' },
  'Climate & Lighting': { icon: 'snowflake', tone: 'green' },
  'AV Equipment': { icon: 'monitor', tone: 'amber' },
  // BM Checklist
  'Checklist Information': { icon: 'clipboard', tone: 'red' },
  'Daily Checks': { icon: 'clipboardCheck', tone: 'green' },
  'Points Discussed on Briefing': { icon: 'notes', tone: 'amber' },
  'Remarks/Comments': { icon: 'chat', tone: 'blue' },
  // Kitchen Balance Report
  Biryani: { icon: 'bowl', tone: 'red' },
  Mandi: { icon: 'fork', tone: 'red' },
  Breads: { icon: 'box', tone: 'red' },
  Indian: { icon: 'bowl', tone: 'red' },
  Tandoor: { icon: 'flame', tone: 'red' },
  Fish: { icon: 'fish', tone: 'red' },
  BBQ: { icon: 'grill', tone: 'red' },
  // Biryani Sales Report — one section per product line.
  'Chicken Biryani (Non-Veg)': { icon: 'bowl', tone: 'amber' },
  'Mutton Biryani (Non-Veg)': { icon: 'bowl', tone: 'red' },
  'Chicken Mandi (Non-Veg)': { icon: 'fork', tone: 'red' },
  'Mutton Mandi (Non-Veg)': { icon: 'fork', tone: 'blue' },
  'Appam (Veg)': { icon: 'bowl', tone: 'green' },
  // Corporate Branch Visit Report
  'Visit Details': { icon: 'briefcase', tone: 'blue' },
  'Remarks / Observations': { icon: 'notes', tone: 'blue' },
  'Reference Photos': { icon: 'image', tone: 'purple' },
};

export function sectionMeta(section: string): {
  icon: AppIconName;
  tone: SectionTone;
  iconClass: string;
  accentClass: string;
} {
  // "Product 1", "Product 2", … are the repeated blocks of a wastage report.
  const fallback: { icon: AppIconName; tone: Tone } = /^Product \d+$/.test(section)
    ? { icon: 'trash', tone: 'red' }
    : { icon: 'clipboard', tone: 'neutral' };
  const meta = SECTION_META[section] ?? fallback;
  return { icon: meta.icon, tone: meta.tone, ...TONE_CLASSES[meta.tone] };
}
