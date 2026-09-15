import type { AuditEntry } from './api';

/** Who did it: a person's name, their email, or "System" for scheduled work. */
export function actorName(entry: AuditEntry): string {
  if (!entry.user) return 'System';
  const name = [entry.user.first_name, entry.user.last_name].filter(Boolean).join(' ');
  return name || entry.user.email;
}

/**
 * The one line an operator reads: what happened. Built from the payload's own
 * `action` and, for money and settings, the old → new values the services
 * record. Payloads are already minimised server-side (no PII, no secrets).
 */
export function summarise(entry: AuditEntry): string {
  const payload = entry.payload ?? {};
  const action = typeof payload.action === 'string' ? payload.action.replace(/_/g, ' ') : '';
  const changes = payload.changes && typeof payload.changes === 'object' ? (payload.changes as Record<string, unknown>) : null;
  const parts: string[] = [];
  if (changes) {
    for (const [field, change] of Object.entries(changes)) {
      if (change && typeof change === 'object' && 'from' in change && 'to' in change) {
        const c = change as { from: unknown; to: unknown };
        parts.push(`${field.replace(/_/g, ' ')}: ${String(c.from)} → ${String(c.to)}`);
      }
    }
  }
  return [action, parts.join('; ')].filter(Boolean).join(' — ') || '—';
}
