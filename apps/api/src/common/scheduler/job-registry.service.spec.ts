import { describe, it, expect, afterEach, vi } from 'vitest';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { ConfigService } from '@nestjs/config';
import { JobRegistry } from './job-registry.service.js';

function build(enabled = true) {
  const scheduler = new SchedulerRegistry();
  const config = { get: (_k: string, d?: string) => (enabled ? 'true' : 'false') ?? d } as unknown as ConfigService;
  const registry = new JobRegistry(scheduler, config);
  return { registry, scheduler };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('JobRegistry with a cross-process lock', () => {
  const withLock = (held: boolean) => {
    const scheduler = new SchedulerRegistry();
    const config = { get: () => 'false' } as unknown as ConfigService; // timers off; run() by hand
    const lock = {
      runExclusive: vi.fn(async (_name: string, fn: () => Promise<void>) => {
        if (held) return false;
        await fn();
        return true;
      }),
    };
    return { registry: new JobRegistry(scheduler, config, lock), lock };
  };

  it('runs the handler inside the lock and counts the run', async () => {
    const { registry, lock } = withLock(false);
    const handler = vi.fn();
    registry.registerInterval({ name: 'locked.job', everyMs: 1_000, handler });
    await registry.run('locked.job');
    expect(lock.runExclusive).toHaveBeenCalledWith('locked.job', expect.any(Function));
    expect(handler).toHaveBeenCalledOnce();
    expect(registry.status('locked.job')).toMatchObject({ runs: 1, skippedLocked: 0, failures: 0 });
  });

  it('skips — without failing — when another process holds the lock', async () => {
    const { registry } = withLock(true);
    const handler = vi.fn();
    registry.registerInterval({ name: 'busy.job', everyMs: 1_000, handler });
    await registry.run('busy.job');
    expect(handler).not.toHaveBeenCalled();
    expect(registry.status('busy.job')).toMatchObject({ runs: 0, skippedLocked: 1, failures: 0 });
  });

  it('still contains a handler failure raised inside the lock', async () => {
    const { registry } = withLock(false);
    registry.registerInterval({
      name: 'bad.locked',
      everyMs: 1_000,
      handler: () => {
        throw new Error('boom');
      },
    });
    await expect(registry.run('bad.locked')).resolves.toBeUndefined();
    expect(registry.status('bad.locked')).toMatchObject({ failures: 1, lastError: 'boom', running: false });
  });
});

describe('JobRegistry', () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => {
    cleanup.forEach((c) => c());
    cleanup = [];
    vi.useRealTimers();
  });

  describe('registration', () => {
    it('registers an interval job and reports it', () => {
      const { registry } = build();
      cleanup.push(() => registry.onModuleDestroy());
      registry.registerInterval({ name: 'a.job', everyMs: 60_000, handler: () => undefined });
      expect(registry.has('a.job')).toBe(true);
      expect(registry.status('a.job')).toMatchObject({ kind: 'interval', schedule: 'every 60000ms', runs: 0, failures: 0 });
      expect(registry.list().map((j) => j.name)).toEqual(['a.job']);
    });

    it('registers a cron job and validates the expression at registration time', () => {
      const { registry } = build();
      cleanup.push(() => registry.onModuleDestroy());
      registry.registerCron({ name: 'c.job', cron: '*/5 * * * *', handler: () => undefined });
      expect(registry.status('c.job')).toMatchObject({ kind: 'cron', schedule: '*/5 * * * *' });

      expect(() =>
        registry.registerCron({ name: 'bad.job', cron: 'not a cron', handler: () => undefined }),
      ).toThrow(/invalid cron expression/);
      expect(registry.has('bad.job')).toBe(false);
    });

    it('REJECTS a duplicate name — no accidental double scheduling', () => {
      const { registry } = build();
      cleanup.push(() => registry.onModuleDestroy());
      registry.registerInterval({ name: 'dup', everyMs: 1_000, handler: () => undefined });
      expect(() =>
        registry.registerInterval({ name: 'dup', everyMs: 2_000, handler: () => undefined }),
      ).toThrow(/already registered/);
      expect(() =>
        registry.registerCron({ name: 'dup', cron: '* * * * *', handler: () => undefined }),
      ).toThrow(/already registered/);
      expect(registry.list()).toHaveLength(1);
    });

    it('rejects invalid names and intervals', () => {
      const { registry } = build();
      cleanup.push(() => registry.onModuleDestroy());
      expect(() => registry.registerInterval({ name: '', everyMs: 1000, handler: () => undefined })).toThrow(/Invalid job name/);
      expect(() => registry.registerInterval({ name: 'has space', everyMs: 1000, handler: () => undefined })).toThrow(/Invalid job name/);
      expect(() => registry.registerInterval({ name: 'zero', everyMs: 0, handler: () => undefined })).toThrow(/positive integer/);
      expect(() => registry.registerInterval({ name: 'neg', everyMs: -5, handler: () => undefined })).toThrow(/positive integer/);
      expect(registry.list()).toHaveLength(0);
    });
  });

  describe('execution', () => {
    it('runs the handler and counts the run', async () => {
      const { registry } = build();
      cleanup.push(() => registry.onModuleDestroy());
      const handler = vi.fn();
      registry.registerInterval({ name: 'r', everyMs: 60_000, handler });
      await registry.run('r');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(registry.status('r')).toMatchObject({ runs: 1, failures: 0, running: false, lastError: null });
      expect(registry.status('r')!.lastStartedAt).not.toBeNull();
      expect(registry.status('r')!.lastFinishedAt).not.toBeNull();
    });

    it('FAILURE CONTAINMENT: a throwing handler is counted and does not propagate', async () => {
      const { registry } = build();
      cleanup.push(() => registry.onModuleDestroy());
      const handler = vi.fn().mockRejectedValue(new Error('boom'));
      registry.registerInterval({ name: 'f', everyMs: 60_000, handler });
      await expect(registry.run('f')).resolves.toBeUndefined();
      expect(registry.status('f')).toMatchObject({ runs: 0, failures: 1, running: false, lastError: 'boom' });

      // ...and the job keeps working afterwards.
      handler.mockResolvedValue(undefined);
      await registry.run('f');
      expect(registry.status('f')).toMatchObject({ runs: 1, failures: 1, lastError: null });
    });

    it('OVERLAP GUARD: a tick during an in-flight run is skipped, not stacked', async () => {
      const { registry } = build();
      cleanup.push(() => registry.onModuleDestroy());
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const handler = vi.fn(() => gate);
      registry.registerInterval({ name: 'slow', everyMs: 60_000, handler });

      const first = registry.run('slow');
      await tick();
      expect(registry.status('slow')!.running).toBe(true);

      await registry.run('slow'); // arrives while first is still running
      expect(handler).toHaveBeenCalledTimes(1);
      expect(registry.status('slow')!.skippedOverlaps).toBe(1);

      release();
      await first;
      expect(registry.status('slow')).toMatchObject({ running: false, runs: 1 });

      await registry.run('slow'); // after completion it runs again
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('throws for an unknown job name', async () => {
      const { registry } = build();
      await expect(registry.run('nope')).rejects.toThrow(/Unknown job/);
    });

    it('timers actually fire the wrapped run path when enabled', async () => {
      vi.useFakeTimers();
      const { registry } = build(true);
      cleanup.push(() => registry.onModuleDestroy());
      const handler = vi.fn();
      registry.registerInterval({ name: 'tick', everyMs: 100, handler });
      await vi.advanceTimersByTimeAsync(350);
      expect(handler).toHaveBeenCalledTimes(3);
      expect(registry.status('tick')!.runs).toBe(3);
    });
  });

  describe('disabled mode (SCHEDULER_ENABLED=false)', () => {
    it('registers jobs but starts no timers', async () => {
      vi.useFakeTimers();
      const { registry, scheduler } = build(false);
      const handler = vi.fn();
      registry.registerInterval({ name: 'quiet', everyMs: 50, handler });
      registry.registerCron({ name: 'quiet.cron', cron: '* * * * * *', handler });
      expect(registry.enabled).toBe(false);
      expect(registry.list()).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(handler).not.toHaveBeenCalled();
      expect(scheduler.getIntervals()).toEqual([]);
      expect(scheduler.getCronJobs().size).toBe(0);
    });

    it('still allows on-demand run() so tests can exercise a job deterministically', async () => {
      const { registry } = build(false);
      const handler = vi.fn();
      registry.registerInterval({ name: 'manual', everyMs: 50, handler });
      await registry.run('manual');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown', () => {
    it('onModuleDestroy removes every timer and clears the registry', () => {
      const { registry, scheduler } = build(true);
      registry.registerInterval({ name: 'i1', everyMs: 60_000, handler: () => undefined });
      registry.registerCron({ name: 'c1', cron: '0 * * * *', handler: () => undefined });
      expect(scheduler.getIntervals()).toHaveLength(1);
      expect(scheduler.getCronJobs().size).toBe(1);

      registry.onModuleDestroy();
      expect(scheduler.getIntervals()).toEqual([]);
      expect(scheduler.getCronJobs().size).toBe(0);
      expect(registry.list()).toEqual([]);
    });
  });
});
