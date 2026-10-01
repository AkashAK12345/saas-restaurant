import { describe, it, expect } from 'vitest';
import { SYSTEM_PERMISSIONS } from '../../common/authorization/permission-keys.js';
import {
  ACCESS_PRESETS,
  ACCESS_SECTIONS,
  ROUTINES,
  normalizeSelection,
  permissionsFor,
  selectionFromPermissions,
  typeFromPermissions,
} from './user-access.js';

const NONE = { toggles: [], routines: {}, tasks: 'OFF' as const };

describe('user access catalogue', () => {
  it('grants only keys the system defines, and every toggle key is unique', () => {
    const defined = new Set(SYSTEM_PERMISSIONS.map((p) => p.name));
    const toggles = ACCESS_SECTIONS.flatMap((s) => s.toggles);
    expect(new Set(toggles.map((t) => t.key)).size).toBe(toggles.length);
    for (const key of permissionsFor('ADMIN', ACCESS_PRESETS.ADMIN)) expect(defined.has(key)).toBe(true);
  });

  it('presets name only toggles and forms that exist', () => {
    for (const preset of Object.values(ACCESS_PRESETS)) expect(normalizeSelection(preset)).toEqual(preset);
    expect(Object.keys(ACCESS_PRESETS.ADMIN.routines)).toEqual(ROUTINES.map((r) => r.key));
  });

  it('a staff user with nothing switched on can only open the dashboard and look customers up', () => {
    expect(permissionsFor('STAFF', NONE)).toEqual(['customers.view', 'dashboard.view']);
  });

  it('administration comes from the type, not from any toggle', () => {
    expect(permissionsFor('MANAGER', ACCESS_PRESETS.ADMIN)).not.toContain('users.update');
    expect(permissionsFor('ADMIN', NONE)).toContain('users.update');
  });

  it('a toggle for a feature not built yet is kept but grants nothing', () => {
    expect(permissionsFor('STAFF', { ...NONE, toggles: ['pos.billing'] })).toEqual(permissionsFor('STAFF', NONE));
    expect(normalizeSelection({ ...NONE, toggles: ['pos.billing'] }).toggles).toEqual(['pos.billing']);
  });

  it('drops unknown toggles, forms and levels', () => {
    expect(
      normalizeSelection({
        toggles: ['queue.waiter', 'queue.waiter', 'made.up'],
        routines: { 'eod-report': 'STAFF', nope: 'MANAGER', 'kitchen-checklist': 'OWNER' as never },
        tasks: 'SOMETIMES' as never,
      }),
    ).toEqual({ toggles: ['queue.waiter'], routines: { 'eod-report': 'STAFF' }, tasks: 'OFF' });
  });

  it('reads what someone given shared roles can do today', () => {
    const held = new Set(['queue.view', 'queue.seat', 'tables.view', 'tasks.view_own', 'tasks.update', 'tasks.start', 'tasks.complete']);
    expect(selectionFromPermissions(held)).toEqual({
      toggles: ['queue.admin_display', 'queue.waiter', 'queue.customer_display'],
      routines: {},
      tasks: 'RECEIVE',
    });
    expect(typeFromPermissions(held)).toBe('STAFF');
    expect(typeFromPermissions(new Set(['users.update']))).toBe('ADMIN');
  });
});
