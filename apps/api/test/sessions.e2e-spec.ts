/**
 * Signed-in devices and remote sign-out (SRS §4.8 "logged devices").
 *
 * A user sees their own live logins and can end any of them from another
 * device. The session id — half of the refresh-token material — is never
 * returned; an opaque handle stands in for it. Another user's session is
 * simply not found.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { resetDatabase } from './utils/db.js';

const PASSWORD = 'SecurePassword123!';

describe('Signed-in devices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;
  let owner: any;

  const login = async (email: string, userAgent: string) => {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .set('User-Agent', userAgent)
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body as { accessToken: string; refreshToken: string };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    http = app.getHttpServer();
    await resetDatabase(prisma);

    const hash = await bcrypt.hash(PASSWORD, 10);
    owner = await prisma.user.create({ data: { email: 'devices-owner@test.com', password_hash: hash } });
    await prisma.user.create({ data: { email: 'devices-other@test.com', password_hash: hash } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('SD-1. lists the caller’s own live logins with what identifies each device, never a session id', async () => {
    const laptop = await login('devices-owner@test.com', 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 Laptop');
    await login('devices-owner@test.com', 'Mozilla/5.0 (Linux; Android 14) Tablet');
    await login('devices-other@test.com', 'Someone else');

    const res = await request(http).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${laptop.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.filter((s: any) => s.current)).toHaveLength(1);
    expect(res.body.data.find((s: any) => s.current).user_agent).toMatch(/Laptop/);
    for (const session of res.body.data) {
      expect(session.handle).toMatch(/^[a-f0-9]{32}$/);
      expect(session).not.toHaveProperty('id');
      expect(session).not.toHaveProperty('token_hash');
    }
    const sessionIds = (await prisma.userSession.findMany({ where: { user_id: owner.id } })).map((s) => s.id);
    const body = JSON.stringify(res.body);
    for (const id of sessionIds) expect(body).not.toContain(id);
    expect(body).not.toContain('Someone else');
  });

  it('SD-2. signing out another device kills its access token and its refresh token at once', async () => {
    const phone = await login('devices-owner@test.com', 'Phone');
    const desk = await login('devices-owner@test.com', 'Desk');

    const list = await request(http).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${desk.accessToken}`);
    const phoneHandle = list.body.data.find((s: any) => s.user_agent === 'Phone').handle;

    const revoke = await request(http)
      .delete(`/api/v1/auth/sessions/${phoneHandle}`)
      .set('Authorization', `Bearer ${desk.accessToken}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body).toEqual({ revoked: true, current: false });

    expect((await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${phone.accessToken}`)).status).toBe(401);
    expect((await request(http).post('/api/v1/auth/refresh').send({ refreshToken: phone.refreshToken })).status).toBe(401);
    // The device that did it is untouched.
    expect((await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${desk.accessToken}`)).status).toBe(200);

    // Revoked is revoked: a second attempt finds nothing.
    const again = await request(http)
      .delete(`/api/v1/auth/sessions/${phoneHandle}`)
      .set('Authorization', `Bearer ${desk.accessToken}`);
    expect(again.status).toBe(404);

    const audit = await prisma.auditLog.findFirst({
      where: { user_id: owner.id, entity_type: 'AUTHENTICATION' },
      orderBy: { created_at: 'desc' },
    });
    expect(audit!.payload).toMatchObject({ action: 'revoke_session' });
    const sessionIds = (await prisma.userSession.findMany({ where: { user_id: owner.id } })).map((s) => s.id);
    for (const id of sessionIds) expect(JSON.stringify(audit!.payload)).not.toContain(id);
  });

  it('SD-3. nobody can sign out someone else’s device, and a malformed handle reveals nothing', async () => {
    const mine = await login('devices-owner@test.com', 'Mine');
    const theirs = await login('devices-other@test.com', 'Theirs');
    const handle = (
      await request(http).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${mine.accessToken}`)
    ).body.data.find((s: any) => s.current).handle;

    const attempt = await request(http)
      .delete(`/api/v1/auth/sessions/${handle}`)
      .set('Authorization', `Bearer ${theirs.accessToken}`);
    expect(attempt.status).toBe(404);
    expect((await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${mine.accessToken}`)).status).toBe(200);

    for (const bad of ['not-a-handle', 'A'.repeat(32), `${handle}00`]) {
      const res = await request(http)
        .delete(`/api/v1/auth/sessions/${bad}`)
        .set('Authorization', `Bearer ${mine.accessToken}`);
      expect([bad, res.status]).toEqual([bad, 404]);
    }
  });

  it('SD-4. the device list and sign-out require a signed-in user', async () => {
    expect((await request(http).get('/api/v1/auth/sessions')).status).toBe(401);
    expect((await request(http).delete(`/api/v1/auth/sessions/${'a'.repeat(32)}`)).status).toBe(401);
  });

  it('SD-5. a hostile User-Agent is bounded, not stored whole', async () => {
    const huge = 'X'.repeat(5000);
    const res = await login('devices-owner@test.com', huge);
    const list = await request(http).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${res.accessToken}`);
    const current = list.body.data.find((s: any) => s.current);
    expect(current.user_agent.length).toBe(300);
  });
});
