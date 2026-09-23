'use client';

import { useEffect, useRef, useState } from 'react';
import { tasksApi, type TaskContext } from '@/lib/tasks/api';
import type { ChecklistItem, ChecklistItemPhoto } from '@/lib/tasks/types';
import { AppIcon } from '@/components/app/icons';
import styles from './tasks.module.css';

const DEFAULT_MAX_PHOTOS = 5;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/**
 * One PHOTO checklist item: a row of thumbnails plus an add tile, up to the
 * item's own max_photos (5 when unset). Each photo uploads immediately on
 * pick — unlike a new banquet
 * booking's deferred upload, the task and item already exist here — so this
 * has no Save button of its own; `onChange` tells the parent to refresh the
 * task (a photo flips the item's is_done, which the parent's progress and
 * submit gate need to see).
 */
export function ChecklistPhotoField({
  ctx,
  taskId,
  item,
  disabled,
  onChange,
}: {
  ctx: TaskContext;
  taskId: string;
  item: ChecklistItem;
  disabled: boolean;
  onChange: () => void;
}) {
  const [photos, setPhotos] = useState<ChecklistItemPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxPhotos = item.max_photos ?? DEFAULT_MAX_PHOTOS;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await tasksApi.listItemPhotos(ctx, taskId, item.id);
        if (!cancelled) setPhotos(list);
      } catch {
        // Best effort — the item's is_done flag is still the source of truth.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, taskId, item.id]);

  const upload = async (files: FileList) => {
    const room = maxPhotos - photos.length;
    const toAdd = Array.from(files).slice(0, room);
    if (toAdd.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of toAdd) {
        const data = await fileToBase64(file);
        const photo = await tasksApi.uploadItemPhoto(ctx, taskId, item.id, {
          data,
          mime_type: file.type || 'image/jpeg',
          file_name: file.name,
        });
        setPhotos((prev) => [...prev, photo]);
      }
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Photo upload failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (photoId: string) => {
    setBusy(true);
    setError(null);
    try {
      await tasksApi.deleteItemPhoto(ctx, taskId, item.id, photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the photo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.photoField}>
      <span className={styles.itemLabel}>
        {item.label}
        {item.is_required ? <span className={styles.required}> (required)</span> : null}
        <span className={styles.photoCount}>
          {' '}
          ({photos.length}/{maxPhotos})
        </span>
      </span>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <div className={styles.photoGrid}>
        {photos.map((p) => (
          <PhotoThumb key={p.id} ctx={ctx} taskId={taskId} item={item} photo={p} onRemove={() => void remove(p.id)} disabled={disabled || busy} />
        ))}
        {photos.length < maxPhotos ? (
          <button
            type="button"
            className={styles.photoAdd}
            aria-label={`Add a photo to ${item.label}`}
            disabled={disabled || busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <AppIcon name="plusCircle" size={22} />
          </button>
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** One photo, fetched with the session's credentials. Without `onRemove`
 *  it is read-only — as in a report's details view. */
export function PhotoThumb({
  ctx,
  taskId,
  item,
  photo,
  onRemove,
  disabled = false,
}: {
  ctx: TaskContext;
  taskId: string;
  item: Pick<ChecklistItem, 'id' | 'label'>;
  photo: ChecklistItemPhoto;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { apiBaseUrl } = await import('@/lib/api/client');
        const { sessionStore } = await import('@/lib/auth/session-store');
        const token = sessionStore.getAccessToken();
        const res = await fetch(`${apiBaseUrl()}${tasksApi.itemPhotoUrl(taskId, item.id, photo.id)}`, {
          headers: {
            'x-company-id': ctx.companyId,
            'x-branch-id': ctx.branchId,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (!cancelled) setSrc(URL.createObjectURL(blob));
      } catch {
        // Best effort — the thumbnail is a convenience, not a record.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.companyId, ctx.branchId, taskId, item.id, photo.id]);

  return (
    <div className={styles.photoThumb}>
      {src ? <img src={src} alt={photo.file_name ?? item.label} /> : null}
      {onRemove ? (
        <button type="button" className={styles.photoRemove} aria-label="Remove photo" disabled={disabled} onClick={onRemove}>
          ×
        </button>
      ) : null}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
