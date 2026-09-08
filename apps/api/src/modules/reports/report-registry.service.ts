import { Injectable, Logger } from '@nestjs/common';
import type { ReportDefinition, ReportProvider } from './report-contract.js';

/**
 * The one place reports are registered.
 *
 * Domain modules call `register()` from their own `onModuleInit`, exactly the
 * way the T0-C JobRegistry works. The registry holds no domain knowledge and
 * no SQL; it maps a stable key to whoever answers for it.
 *
 * Registering a key twice is a programming error, not a silent override — two
 * providers claiming "queue.summary" means one of them is unreachable, and
 * failing loudly at boot is better than discovering it in production.
 */
@Injectable()
export class ReportRegistry {
  private readonly logger = new Logger(ReportRegistry.name);
  private readonly providers = new Map<string, ReportProvider>();

  register(provider: ReportProvider): void {
    const { key } = provider.definition;
    if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(key)) {
      throw new Error(
        `Invalid report key "${key}": expected "<domain>.<report>" in lowercase snake_case`,
      );
    }
    if (this.providers.has(key)) {
      throw new Error(`Report "${key}" is already registered`);
    }
    this.providers.set(key, provider);
    this.logger.log(`Registered report ${key}`);
  }

  get(key: string): ReportProvider | undefined {
    return this.providers.get(key);
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  /** Every definition, ordered by key so listings are stable. */
  definitions(): ReportDefinition[] {
    return [...this.providers.values()]
      .map((p) => p.definition)
      .sort((a, b) => a.key.localeCompare(b.key));
  }
}
