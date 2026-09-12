import { request, type APIRequestContext } from '@playwright/test';
import { apiOrigin } from './data';

/**
 * A signed-in client for the real SAMCO API, used for set-up and for the
 * staff-side mutations whose effect a screen must show.
 *
 * Tokens and credentials never appear in thrown errors or logs: failures
 * report the method, path, status and the API's own message only.
 */
export interface QueueTokenView {
  id: string;
  token_number: number;
  status: string;
  party_size: number;
}

export interface QueueBoard {
  waiting: QueueTokenView[];
  called: QueueTokenView[];
  seated: QueueTokenView[];
}

export class SamcoApi {
  private constructor(
    private readonly http: APIRequestContext,
    private readonly accessToken: string,
    private readonly companyId: string,
  ) {}

  static async login(email: string, password: string, companyId: string): Promise<SamcoApi> {
    const http = await request.newContext({ baseURL: `${apiOrigin()}/api/v1/` });
    const res = await http.post('auth/login', { data: { email, password } });
    if (!res.ok()) {
      await http.dispose();
      throw new Error(`[browser-e2e] API sign-in for ${email} failed (${res.status()}).`);
    }
    const body = (await res.json()) as { accessToken: string };
    return new SamcoApi(http, body.accessToken, companyId);
  }

  async send<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, branchId: string | null, data?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'X-Company-ID': this.companyId,
    };
    if (branchId) headers['X-Branch-ID'] = branchId;
    const res = await this.http.fetch(path, { method, headers, data });
    if (!res.ok()) {
      let message = '';
      try {
        const body = (await res.json()) as { message?: unknown };
        message = Array.isArray(body.message) ? body.message.join('; ') : String(body.message ?? '');
      } catch {
        /* not JSON */
      }
      throw new Error(`[browser-e2e] ${method} ${path} → ${res.status()} ${message}`.trim());
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  board(branchId: string): Promise<QueueBoard> {
    return this.send('GET', 'queue-tokens/board', branchId);
  }

  register(branchId: string, party: { adults: number; kids?: number; customer_id?: string }): Promise<QueueTokenView> {
    return this.send('POST', 'queue-tokens', branchId, party);
  }

  call(branchId: string, tokenId: string): Promise<QueueTokenView> {
    return this.send('POST', `queue-tokens/${tokenId}/call`, branchId, {});
  }

  seat(branchId: string, tokenId: string, tableId?: string): Promise<QueueTokenView> {
    return this.send('POST', `queue-tokens/${tokenId}/seat`, branchId, tableId ? { table_id: tableId } : {});
  }

  /** Pairs a device through the application; the raw credential exists only in this response. */
  async createDevice(branchId: string, kind: string, name: string): Promise<{ id: string; credential: string }> {
    const body = await this.send<{ device: { id: string }; credential: string }>('POST', 'display-devices', branchId, {
      name,
      kind,
    });
    return { id: body.device.id, credential: body.credential };
  }

  revokeDevice(branchId: string, deviceId: string): Promise<unknown> {
    return this.send('POST', `display-devices/${deviceId}/revoke`, branchId, {});
  }

  dispose(): Promise<void> {
    return this.http.dispose();
  }
}
