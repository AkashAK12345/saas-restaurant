/**
 * Route inventory — DEFAULT DENY, asserted.
 *
 * PermissionGuard lets a request through when a route carries no permission
 * metadata, and a permission decorator does nothing on a route that forgot the
 * guard. Either mistake would silently expose an endpoint. This test walks
 * EVERY registered controller route and requires each one to be exactly one
 * of:
 *
 *   PERMISSION  JwtAuthGuard + PermissionGuard + permission metadata
 *   DEVICE      DisplayDeviceGuard (a paired screen's own credential)
 *   SELF        JwtAuthGuard only, acting on the caller's own identity — and
 *               explicitly listed below with the reason
 *   PLATFORM    JwtAuthGuard + PlatformAdminGuard (ACTIVE platform administrator),
 *               explicitly listed below with the reason
 *   TICKET     StreamTicketGuard (single-use ticket minted behind a permission)
 *   PUBLIC      no guard at all — explicitly listed below with the reason
 *
 * A new route that fits none of these fails this test until someone decides,
 * in review, which it is.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { AppModule } from '../src/app.module.js';
import { PERMISSION_META_KEY } from '../src/common/authorization/require-permission.decorator.js';

/** Routes with no guard. Each must be safe to call anonymously. */
const PUBLIC_ROUTES: Record<string, string> = {
  'GET /health': 'liveness only; returns no data',
  'POST /auth/login': 'credentials are the proof; throttled per ip+email',
  'POST /auth/refresh': 'the refresh token is the proof',
  'POST /auth/logout': 'the refresh token is the proof; revokes only that session',
};

/** Routes that need a signed-in user but act only on that user. */
const SELF_ROUTES: Record<string, string> = {
  'GET /auth/me': "the caller's own profile",
  'GET /auth/context': "the caller's own companies and permissions; headers re-verified",
  'PATCH /auth/password': "the caller's own password; target comes from the JWT",
  'GET /auth/sessions': "the caller's own signed-in devices",
  'DELETE /auth/sessions/:handle': "signs out one of the caller's own devices",
  'GET /dashboard/all-branches': 'every branch proved individually through AuthorizationService',
  'GET /companies': 'only companies the caller holds an ACTIVE membership in (service-scoped)',
  'GET /companies/:id': 'service verifies the caller’s ACTIVE membership; otherwise refused',
};

/**
 * Platform operations: no company exists to scope a permission against, so an
 * ACTIVE platform administrator (checked fresh in the database) is required.
 */
const PLATFORM_ROUTES: Record<string, string> = {
  'POST /companies': 'creates a new tenant; ordinary signed-in users and company admins are refused',
};

/** Routes authenticated by a single-use, short-lived stream ticket instead of a JWT. */
const TICKET_ROUTES: Record<string, string> = {
  'GET /realtime/stream': 'EventSource cannot send headers; the ticket was minted behind a permission check',
};

type RouteClass = 'PERMISSION' | 'DEVICE' | 'SELF' | 'PLATFORM' | 'PUBLIC' | 'TICKET' | 'UNCLASSIFIED';

interface Route {
  id: string;
  guards: string[];
  hasPermissionMeta: boolean;
}

function collectRoutes(app: INestApplication): Route[] {
  const routes: Route[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | undefined;
      if (!controller?.prototype) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      const classPermission = Reflect.getMetadata(PERMISSION_META_KEY, controller);

      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === 'constructor') continue;
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        if (path === undefined) continue;

        const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const joined = `/${[base, String(path)].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
        const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? [])].map(
          (g) => (typeof g === 'function' ? g.name : (g as object).constructor.name),
        );
        routes.push({
          id: `${verb} ${joined === '/' ? '/' : joined.replace(/\/$/, '')}`,
          guards,
          hasPermissionMeta: Reflect.getMetadata(PERMISSION_META_KEY, handler) !== undefined || classPermission !== undefined,
        });
      }
    }
  }
  return routes.sort((a, b) => a.id.localeCompare(b.id));
}

function classify(route: Route): RouteClass {
  const { guards, hasPermissionMeta, id } = route;
  if (guards.includes('PermissionGuard') && hasPermissionMeta && guards.includes('JwtAuthGuard')) return 'PERMISSION';
  if (guards.includes('DisplayDeviceGuard') && !hasPermissionMeta) return 'DEVICE';
  if (guards.length === 1 && guards[0] === 'JwtAuthGuard' && !hasPermissionMeta && id in SELF_ROUTES) return 'SELF';
  if (
    guards.length === 2 &&
    guards[0] === 'JwtAuthGuard' &&
    guards[1] === 'PlatformAdminGuard' &&
    !hasPermissionMeta &&
    id in PLATFORM_ROUTES
  )
    return 'PLATFORM';
  if (guards.length === 0 && !hasPermissionMeta && id in PUBLIC_ROUTES) return 'PUBLIC';
  if (guards.length === 1 && guards[0] === 'StreamTicketGuard' && id in TICKET_ROUTES) return 'TICKET';
  return 'UNCLASSIFIED';
}

describe('Route inventory — default deny (e2e)', () => {
  let app: INestApplication;
  let routes: Route[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    routes = collectRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('RI-1. finds the application routes', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('RI-2. every route is PERMISSION, DEVICE, SELF or PUBLIC — nothing is open by accident', () => {
    const unclassified = routes
      .filter((r) => classify(r) === 'UNCLASSIFIED')
      .map((r) => `${r.id} guards=[${r.guards.join(',')}] permission=${r.hasPermissionMeta}`);
    expect(unclassified).toEqual([]);
  });

  it('RI-3. no permission decorator sits on a route without PermissionGuard (it would never be checked)', () => {
    const inert = routes.filter((r) => r.hasPermissionMeta && !r.guards.includes('PermissionGuard')).map((r) => r.id);
    expect(inert).toEqual([]);
  });

  it('RI-4. no PermissionGuard sits on a route without a permission (the guard would pass it through)', () => {
    const passThrough = routes.filter((r) => r.guards.includes('PermissionGuard') && !r.hasPermissionMeta).map((r) => r.id);
    expect(passThrough).toEqual([]);
  });

  it('RI-5. the self and public allow-lists name only routes that exist', () => {
    const ids = new Set(routes.map((r) => r.id));
    expect(Object.keys(PUBLIC_ROUTES).filter((id) => !ids.has(id))).toEqual([]);
    expect(Object.keys(SELF_ROUTES).filter((id) => !ids.has(id))).toEqual([]);
    expect(Object.keys(TICKET_ROUTES).filter((id) => !ids.has(id))).toEqual([]);
    expect(Object.keys(PLATFORM_ROUTES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('RI-6. PlatformAdminGuard protects only the listed platform routes', () => {
    const platform = routes.filter((r) => r.guards.includes('PlatformAdminGuard')).map((r) => r.id);
    expect(platform.sort()).toEqual(Object.keys(PLATFORM_ROUTES).sort());
  });
});
