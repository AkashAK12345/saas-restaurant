import type { AppIconName } from '@/components/app/icons';
import styles from './tasks.module.css';

type Tone = 'green' | 'blue' | 'amber' | 'pink' | 'red' | 'neutral';

const TONE_CLASSES: Record<Tone, { iconClass: string; accentClass: string }> = {
  green: { iconClass: styles.toneGreen, accentClass: styles.accentGreen },
  blue: { iconClass: styles.toneBlue, accentClass: styles.accentBlue },
  amber: { iconClass: styles.toneAmber, accentClass: styles.accentAmber },
  pink: { iconClass: styles.tonePink, accentClass: styles.accentPink },
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
  'Submitted By': { icon: 'person', tone: 'pink' },
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
};

export function sectionMeta(section: string): { icon: AppIconName; iconClass: string; accentClass: string } {
  const meta = SECTION_META[section] ?? { icon: 'clipboard', tone: 'neutral' as Tone };
  return { icon: meta.icon, ...TONE_CLASSES[meta.tone] };
}
