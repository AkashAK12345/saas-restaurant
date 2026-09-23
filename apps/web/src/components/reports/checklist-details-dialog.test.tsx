import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const tasksApiMock = vi.hoisted(() => ({ get: vi.fn(), listItemPhotos: vi.fn() }));
vi.mock('@/lib/tasks/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tasks/api')>();
  return { ...actual, tasksApi: { ...actual.tasksApi, ...tasksApiMock } };
});

const { ChecklistDetailsDialog } = await import('./checklist-details-dialog');

const ctx = { companyId: 'c1', branchId: 'b1' };
const item = (over: Record<string, unknown>) => ({
  id: 'x',
  label: 'Question',
  position: 0,
  kind: 'TEXT',
  is_required: false,
  is_done: false,
  value: null,
  section: null,
  max_photos: null,
  done_at: null,
  done_by: null,
  ...over,
});

function open(onClose = vi.fn()) {
  render(
    <ChecklistDetailsDialog
      ctx={ctx}
      taskId="t1"
      title="Branch Head Opening Details"
      subtitle="23 Sep 2026 - pallavaramba"
      icon="sun"
      sectionLooks={{ Remarks: { icon: 'notes', tone: 'neutral' } }}
      onClose={onClose}
    />,
  );
  return screen.getByRole('dialog', { name: 'Branch Head Opening Details' });
}

describe('ChecklistDetailsDialog', () => {
  beforeEach(() => {
    tasksApiMock.get.mockReset();
    tasksApiMock.listItemPhotos.mockReset();
  });

  it('groups the form by section, in order, with each answer as written', async () => {
    tasksApiMock.get.mockResolvedValue({
      checklist: [
        item({ id: 'b', position: 1, label: 'Valet drivers present?', value: 'yes', section: 'Parking & Security' }),
        item({ id: 'a', position: 0, label: 'Parking area pictures', kind: 'PHOTO', section: 'Parking & Security' }),
        item({ id: 'c', position: 2, label: 'Generators working?', value: '100%', section: 'Operations & Compliance' }),
        item({ id: 'd', position: 3, label: 'Any additional remarks', section: 'Remarks' }),
      ],
    });
    tasksApiMock.listItemPhotos.mockResolvedValue([]);
    const dialog = open();

    await within(dialog).findByText('Parking & Security');
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Parking & Security',
      'Operations & Compliance',
      'Remarks',
    ]);
    expect(within(dialog).getByText('100%')).toBeTruthy();
    // A photo field with nothing attached says so; a blank answer is a dash.
    expect(await within(dialog).findByText('No photos')).toBeTruthy();
    expect(tasksApiMock.listItemPhotos).toHaveBeenCalledWith(ctx, 't1', 'a');
    expect(within(dialog).getByText('—')).toBeTruthy();
    // The dialog's own look for a section wins over the task form's.
    expect(within(dialog).getByText('Remarks', { selector: 'h3' }).closest('section')?.getAttribute('data-tone')).toBe(
      'neutral',
    );
  });

  it("reports the task's own refusal instead of showing an empty form", async () => {
    tasksApiMock.get.mockRejectedValue(new Error('You do not have permission to view tasks'));
    const dialog = open();
    expect((await within(dialog).findByRole('alert')).textContent).toMatch('permission');
  });

  it('closes on the close button and on the backdrop', () => {
    tasksApiMock.get.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    const dialog = open(onClose);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
