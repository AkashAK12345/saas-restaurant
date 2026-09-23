'use client';

import { useEffect, useRef, useState } from 'react';
import { AppIcon, type AppIconName } from '@/components/app/icons';
import { PhotoThumb } from '@/components/tasks/checklist-photo-field';
import { sectionMeta, type SectionTone } from '@/components/tasks/section-meta';
import { tasksApi, type TaskContext } from '@/lib/tasks/api';
import type { ChecklistItem, ChecklistItemPhoto } from '@/lib/tasks/types';
import styles from './checklist-details-dialog.module.css';

/** A section's look in this dialog, where it differs from the task form's. */
export type SectionLook = { icon: AppIconName; tone: SectionTone };

/**
 * One submitted checklist, read in full from a report row: every section,
 * every answer, every photo.
 *
 * It reads the TASK itself rather than anything the report sent, so it shows
 * exactly what the task screen would — and the server applies the task's own
 * permission, not the report's. Someone who may read reports but not tasks is
 * told so here instead of seeing a half-empty form.
 */
export function ChecklistDetailsDialog({
  ctx,
  taskId,
  title,
  subtitle,
  icon,
  tone = 'amber',
  sectionLooks = {},
  onClose,
}: {
  ctx: TaskContext;
  taskId: string;
  title: string;
  subtitle: string;
  icon: AppIconName;
  /** The heading's colour — each checklist's dialog has its own. */
  tone?: 'amber' | 'red';
  sectionLooks?: Readonly<Record<string, SectionLook>>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const task = await tasksApi.get(ctx, taskId);
        if (!cancelled) setItems([...task.checklist].sort((a, b) => a.position - b.position));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this checklist');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, taskId]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.dialog}
        data-tone={tone}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checklist-details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <span className={styles.headIcon} aria-hidden="true">
            <AppIcon name={icon} size={30} />
          </span>
          <div className={styles.headText}>
            <h2 className={styles.title} id="checklist-details-title">
              {title}
            </h2>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
          <button ref={closeRef} type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <AppIcon name="close" size={24} />
          </button>
        </div>

        <div className={styles.body}>
          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : items === null ? (
            <p className={styles.loading} role="status">
              Loading…
            </p>
          ) : (
            groupBySection(items).map((group, i) => {
              const look = sectionLooks[group.section] ?? sectionMeta(group.section);
              return (
                <section key={i} className={styles.section} data-tone={look.tone}>
                  <h3 className={styles.sectionHead}>
                    <AppIcon name={look.icon} size={22} />
                    {group.section}
                  </h3>
                  <dl className={styles.answers}>
                    {group.items.map((item) =>
                      item.kind === 'PHOTO' ? (
                        <div key={item.id} className={styles.photoAnswer}>
                          <dt>{item.label}</dt>
                          <dd>
                            <PhotoStrip ctx={ctx} taskId={taskId} item={item} />
                          </dd>
                        </div>
                      ) : (
                        <div key={item.id} className={styles.answer}>
                          <dt>{item.label}</dt>
                          <dd data-answer={verdict(item)}>
                            {answerText(item) ?? <span className={styles.blank}>—</span>}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** An answer as written; a tick or yes/no as Yes/No, a rating out of five. */
function answerText(item: ChecklistItem): string | null {
  if (item.kind === 'CHECK') return item.is_done ? 'Yes' : 'No';
  const value = item.value?.trim() ? item.value : null;
  if (value === null) return null;
  if (item.kind === 'YES_NO') return value.toUpperCase() === 'YES' ? 'Yes' : 'No';
  if (item.kind === 'RATING') return `${value}/5`;
  return value;
}

/** A yes/no question's answer, for its colour; nothing for free text. */
function verdict(item: ChecklistItem): 'yes' | 'no' | undefined {
  if (item.kind === 'CHECK') return item.is_done ? 'yes' : 'no';
  if (item.kind === 'YES_NO' && item.value) return item.value.toUpperCase() === 'YES' ? 'yes' : 'no';
  return undefined;
}

/** Consecutive items sharing a section, in form order. */
function groupBySection(items: readonly ChecklistItem[]) {
  const groups: Array<{ section: string; items: ChecklistItem[] }> = [];
  for (const item of items) {
    const section = item.section ?? 'Checklist';
    const last = groups.at(-1);
    if (last && last.section === section) last.items.push(item);
    else groups.push({ section, items: [item] });
  }
  return groups;
}

function PhotoStrip({ ctx, taskId, item }: { ctx: TaskContext; taskId: string; item: ChecklistItem }) {
  const [photos, setPhotos] = useState<ChecklistItemPhoto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await tasksApi.listItemPhotos(ctx, taskId, item.id);
        if (!cancelled) setPhotos(list);
      } catch {
        if (!cancelled) setPhotos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, taskId, item.id]);

  if (photos === null) return <span className={styles.blank}>Loading…</span>;
  if (photos.length === 0) return <span className={styles.blank}>No photos</span>;
  return (
    <div className={styles.photos}>
      {photos.map((p) => (
        <PhotoThumb key={p.id} ctx={ctx} taskId={taskId} item={item} photo={p} />
      ))}
    </div>
  );
}
