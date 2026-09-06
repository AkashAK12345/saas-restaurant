import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { resetDatabase, deleteUserCascade } from './utils/db.js';
import * as bcrypt from 'bcrypt';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testUser: any;
  let validPassword = 'SecurePassword123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    // Must match main.ts exactly. This suite previously omitted
    // forbidNonWhitelisted, so it silently stripped unknown request fields
    // where production rejects them — a weaker pipe than the real app.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);

    // Clean up before tests
    await resetDatabase(prisma);

    // Create a test user
    const password_hash = await bcrypt.hash(validPassword, 10);
    testUser = await prisma.user.create({
      data: {
        email: 'test@samco.com',
        password_hash,
        first_name: 'Test',
        last_name: 'User',
      },
    });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('should fail generically with nonexistent email (does not leak account existence)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@samco.com', password: 'password' });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should fail generically with invalid password (does not leak account existence)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: 'WrongPassword' });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should login successfully with valid credentials and not return sensitive fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user).toHaveProperty('id', testUser.id);
      expect(response.body.user).toHaveProperty('email', 'test@samco.com');
      // Should NOT return password_hash
      expect(response.body.user).not.toHaveProperty('password_hash');

      // 1. JWT does not contain email
      // 2. JWT contains the user ID (sub)
      const accessToken = response.body.accessToken;
      const payloadBase64 = accessToken.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
      expect(payload).toHaveProperty('sub', testUser.id);
      expect(payload).not.toHaveProperty('email');
    });
  });

  describe('GET /api/v1/auth/me', () => {
    let accessToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      accessToken = res.body.accessToken;
    });

    it('should reject requests without a token', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/auth/me');
      expect(response.status).toBe(401);
    });

    it('should reject requests with an invalid/expired token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.here');
      expect(response.status).toBe(401);
    });

    it('should return the user profile with a valid token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
        
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', testUser.id);
      expect(response.body).toHaveProperty('email', 'test@samco.com');
    });
  });

  describe('POST /api/v1/auth/refresh and Concurrency Protection', () => {
    let validRefreshToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      validRefreshToken = res.body.refreshToken;
    });

    it('should reject an invalid refresh token format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid_token' });
      expect(response.status).toBe(401);
    });

    it('should successfully rotate a valid refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.refreshToken).not.toBe(validRefreshToken);

      // The old token should now be invalid because it was rotated (hash changed)
      const replayResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken });
      
      expect(replayResponse.status).toBe(401);
      expect(replayResponse.body.message).toBe('Invalid refresh token');

      // Update validRefreshToken for next tests
      validRefreshToken = response.body.refreshToken;
    });

    it('should reject concurrent requests with the same refresh token, and revoke the session completely (Replay Protection)', async () => {
      // Get a fresh token to avoid state contamination from previous tests
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const freshRefreshToken = loginRes.body.refreshToken;

      // Send two requests exactly at the same time with the same token
      const req1 = request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: freshRefreshToken });
        
      const req2 = request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: freshRefreshToken });

      const [res1, res2] = await Promise.all([req1, req2]);

      // One must succeed, one must fail with 401
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 401]);

      // If a replay happened, the session must be completely revoked by our protection logic.
      // So even the newly rotated token (from the successful request) should now be invalid.
      const successfulRes = res1.status === 200 ? res1 : res2;
      const compromisedNewToken = successfulRes.body.refreshToken;

      const subsequentReq = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: compromisedNewToken });
      
      expect(subsequentReq.status).toBe(401);
      expect(subsequentReq.body.message).toBe('Invalid refresh token');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    let validRefreshToken: string;

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      validRefreshToken = res.body.refreshToken;
    });

    it('should logout and invalidate the refresh session', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: validRefreshToken });

      expect(response.status).toBe(204);

      // Subsequent refresh attempts should fail
      const refreshResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken });

      expect(refreshResponse.status).toBe(401);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // M1 — ACCESS TOKENS ARE BOUND TO A REVOCABLE SESSION
  // ═════════════════════════════════════════════════════════════════════════

  describe('M1 — access token / session binding', () => {
    it('M1-a. the access token carries its issuing session id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });

      const payload = JSON.parse(
        Buffer.from(res.body.accessToken.split('.')[1], 'base64').toString('utf8'),
      );
      expect(payload).toHaveProperty('sid');

      const sessionId = res.body.refreshToken.split('.')[0];
      expect(payload.sid).toBe(sessionId);

      const session = await prisma.userSession.findUnique({ where: { id: payload.sid } });
      expect(session).not.toBeNull();
    });

    it('M1-b. logout immediately invalidates the already-issued access token', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const { accessToken, refreshToken } = login.body;

      // Works before logout
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(204);

      // The same, still-unexpired access token is now rejected.
      const after = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(after.status).toBe(401);
    });

    it('M1-c. revoking a session directly invalidates its access token', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const { accessToken, refreshToken } = login.body;
      const sessionId = refreshToken.split('.')[0];

      await prisma.userSession.update({
        where: { id: sessionId },
        data: { revoked_at: new Date() },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(401);
    });

    it('M1-d. a replay-revoked session also kills its access token', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const { accessToken, refreshToken } = login.body;

      // Rotate, then replay the superseded token — this revokes the session.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(401);
    });

    it('M1-e. a token whose session does not exist is rejected', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const { accessToken, refreshToken } = login.body;
      const sessionId = refreshToken.split('.')[0];

      await prisma.userSession.delete({ where: { id: sessionId } });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(401);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // M5 — REFRESH TOKEN ABSOLUTE LIFETIME
  // ═════════════════════════════════════════════════════════════════════════

  describe('M5 — refresh absolute lifetime', () => {
    it('M5-a. login records both a sliding and an absolute expiry', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const sessionId = res.body.refreshToken.split('.')[0];

      const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
      expect(session!.absolute_expires_at.getTime()).toBeGreaterThan(
        session!.expires_at.getTime(),
      );
    });

    it('M5-b. normal rotation does NOT extend the absolute expiry', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const sessionId = login.body.refreshToken.split('.')[0];

      const before = await prisma.userSession.findUnique({ where: { id: sessionId } });

      const rotated = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.refreshToken });
      expect(rotated.status).toBe(200);

      const after = await prisma.userSession.findUnique({ where: { id: sessionId } });
      expect(after!.absolute_expires_at.getTime()).toBe(
        before!.absolute_expires_at.getTime(),
      );
      // The sliding window did move (or is clamped to the ceiling)
      expect(after!.expires_at.getTime()).toBeGreaterThanOrEqual(
        before!.expires_at.getTime(),
      );
    });

    it('M5-c. refresh is refused once the absolute lifetime is exceeded', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const sessionId = login.body.refreshToken.split('.')[0];

      // Age the session past its hard ceiling while leaving the sliding window
      // valid — isolating the absolute check specifically.
      await prisma.userSession.update({
        where: { id: sessionId },
        data: { absolute_expires_at: new Date(Date.now() - 1000) },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.refreshToken });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid refresh token');

      // The session is revoked, not merely refused
      const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
      expect(session!.revoked_at).not.toBeNull();
    });

    it('M5-d. the sliding window is clamped to the absolute ceiling', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const sessionId = login.body.refreshToken.split('.')[0];

      // Ceiling one hour out — far closer than the 7-day sliding window.
      const ceiling = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.userSession.update({
        where: { id: sessionId },
        data: { absolute_expires_at: ceiling },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);

      const after = await prisma.userSession.findUnique({ where: { id: sessionId } });
      expect(after!.expires_at.getTime()).toBeLessThanOrEqual(ceiling.getTime());
    });

    it('M5-e. an expired-by-absolute session also rejects its access token', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: validPassword });
      const sessionId = login.body.refreshToken.split('.')[0];

      await prisma.userSession.update({
        where: { id: sessionId },
        data: { absolute_expires_at: new Date(Date.now() - 1000) },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(401);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // L2 — USER ENUMERATION
  // ═════════════════════════════════════════════════════════════════════════

  describe('L2 — login does not distinguish existing from unknown accounts', () => {
    it('L2-a. both failure modes return an identical response', async () => {
      const unknown = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'definitely-not-registered@samco.com', password: 'whatever' });

      const wrongPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@samco.com', password: 'WrongPassword' });

      expect(unknown.status).toBe(wrongPassword.status);
      expect(unknown.body.message).toBe(wrongPassword.body.message);
      expect(Object.keys(unknown.body).sort()).toEqual(
        Object.keys(wrongPassword.body).sort(),
      );
    });

    // The mechanism itself — that bcrypt.compare runs against a fixed dummy hash
    // when no user matches, which is what removes the timing signal — is asserted
    // deterministically in the AuthService unit test
    // (src/modules/auth/auth.service.spec.ts, "L2" block). It cannot be asserted
    // here: bcrypt's ESM namespace is not configurable, so it cannot be spied on
    // from an e2e context, and a wall-clock threshold test would be flaky in CI.
  });

  // ═════════════════════════════════════════════════════════════════════════
  // M6 — LOGIN BRUTE-FORCE THROTTLING
  // ═════════════════════════════════════════════════════════════════════════

  describe('M6 — login brute-force protection', () => {
    const throttled = (email: string, password: string) =>
      request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });

    it('M6-a. repeated failures are throttled with 429', async () => {
      const email = 'bruteforce-target@samco.com';
      const statuses: number[] = [];

      for (let i = 0; i < 8; i++) {
        const res = await throttled(email, 'WrongPassword');
        statuses.push(res.status);
      }

      // First attempts are plain 401s, then the budget is exhausted.
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toContain(429);
    });

    it('M6-b. throttling does not reveal whether the account exists', async () => {
      // BOTH identities must start with an untouched budget, otherwise the
      // comparison measures leftover state from earlier tests rather than the
      // throttle's behaviour.
      const known = 'throttle-known@samco.com';
      const unknown = 'throttle-ghost@samco.com';

      await prisma.user.create({
        data: { email: known, password_hash: await bcrypt.hash(validPassword, 10) },
      });

      const drive = async (email: string) => {
        const out: number[] = [];
        for (let i = 0; i < 7; i++) {
          out.push((await throttled(email, 'WrongPassword')).status);
        }
        return out;
      };

      const knownStatuses = await drive(known);
      const unknownStatuses = await drive(unknown);

      // Identical status progression for a real and a non-existent account.
      expect(knownStatuses).toEqual(unknownStatuses);
      expect(knownStatuses).toContain(429);
    });

    it('M6-c. the throttle is per-identity: an untouched account still logs in', async () => {
      const freshEmail = 'throttle-untouched@samco.com';
      await prisma.user.create({
        data: {
          email: freshEmail,
          password_hash: await bcrypt.hash(validPassword, 10),
        },
      });

      const ok = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: freshEmail, password: validPassword });
      expect(ok.status).toBe(200);
      expect(ok.body).toHaveProperty('accessToken');
    });

    it('M6-d. a successful login clears that identity\'s failure budget', async () => {
      const email = 'throttle-recovery@samco.com';
      await prisma.user.create({
        data: { email, password_hash: await bcrypt.hash(validPassword, 10) },
      });

      // Burn part of the budget, but stay under the limit.
      for (let i = 0; i < 4; i++) {
        expect((await throttled(email, 'WrongPassword')).status).toBe(401);
      }

      // A correct login resets the counter...
      expect((await throttled(email, validPassword)).status).toBe(200);

      // ...so the next failures start from a fresh budget rather than tripping.
      for (let i = 0; i < 4; i++) {
        expect((await throttled(email, 'WrongPassword')).status).toBe(401);
      }
    });

    it('M6-e. throttle responses never contain credential material', async () => {
      const email = 'bruteforce-target@samco.com'; // blocked by M6-a
      const res = await throttled(email, 'SomeSecretPassword123');
      expect(res.status).toBe(429);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('SomeSecretPassword123');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // AUTHENTICATED PASSWORD CHANGE — PATCH /auth/password
  //
  // The account and the current session both come from the verified JWT.
  // On success: every OTHER login is revoked, the calling session survives.
  // ═════════════════════════════════════════════════════════════════════════

  describe('PATCH /api/v1/auth/password', () => {
    const NEW_PASSWORD = 'BrandNewPassword456!';

    let subject: any;
    let subjectEmail: string;
    let session1: { accessToken: string; refreshToken: string };
    let session2: { accessToken: string; refreshToken: string };

    const login = (email: string, password: string) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password });

    const changePassword = (
      accessToken: string | undefined,
      body: Record<string, unknown>,
    ) => {
      const req = request(app.getHttpServer()).patch('/api/v1/auth/password');
      if (accessToken) req.set('Authorization', `Bearer ${accessToken}`);
      return req.send(body);
    };

    beforeEach(async () => {
      subjectEmail = `pwchange-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@samco.com`;
      subject = await prisma.user.create({
        data: {
          email: subjectEmail,
          password_hash: await bcrypt.hash(validPassword, 10),
        },
      });

      // Two independent logins => two live sessions.
      const a = await login(subjectEmail, validPassword);
      const b = await login(subjectEmail, validPassword);
      session1 = { accessToken: a.body.accessToken, refreshToken: a.body.refreshToken };
      session2 = { accessToken: b.body.accessToken, refreshToken: b.body.refreshToken };
    });

    afterEach(async () => {
      // Users accumulate AUTHENTICATION audit rows, and audit_logs.user_id is
      // ON DELETE RESTRICT with immutable rows — so the shared cascade helper
      // (which purges the audit table) is the only way to remove them.
      // Every audit assertion above runs before this point.
      await deleteUserCascade(prisma, subject.id);
    });

    // ── A. Successful change ───────────────────────────────────────────────

    it('PW-a1. an authenticated user can change their own password', async () => {
      const res = await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      });

      expect(res.status).toBe(200);
      // Never echo credential material back.
      expect(JSON.stringify(res.body)).not.toContain(NEW_PASSWORD);
      expect(JSON.stringify(res.body)).not.toContain(validPassword);
      expect(res.body).not.toHaveProperty('password_hash');
      expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
    });

    it('PW-a2. the new password works and the old one stops working', async () => {
      await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      }).expect(200);

      const withNew = await login(subjectEmail, NEW_PASSWORD);
      expect(withNew.status).toBe(200);
      expect(withNew.body.accessToken).toBeDefined();

      const withOld = await login(subjectEmail, validPassword);
      expect(withOld.status).toBe(401);
      expect(withOld.body.message).toBe('Invalid credentials');
    });

    it('PW-a3. the stored hash actually changed and is not plaintext', async () => {
      const before = await prisma.user.findUnique({ where: { id: subject.id } });

      await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      }).expect(200);

      const after = await prisma.user.findUnique({ where: { id: subject.id } });
      expect(after!.password_hash).not.toBe(before!.password_hash);
      expect(after!.password_hash).not.toBe(NEW_PASSWORD);
      expect(await bcrypt.compare(NEW_PASSWORD, after!.password_hash)).toBe(true);
    });

    // ── B. Wrong current password ──────────────────────────────────────────

    it('PW-b1. a wrong current password is rejected and nothing changes', async () => {
      const before = await prisma.user.findUnique({ where: { id: subject.id } });

      const res = await changePassword(session1.accessToken, {
        current_password: 'NotMyPassword999!',
        new_password: NEW_PASSWORD,
      });
      expect(res.status).toBe(403);

      const after = await prisma.user.findUnique({ where: { id: subject.id } });
      expect(after!.password_hash).toBe(before!.password_hash);

      // The old password still works; the attempted new one does not.
      expect((await login(subjectEmail, validPassword)).status).toBe(200);
      expect((await login(subjectEmail, NEW_PASSWORD)).status).toBe(401);
    });

    it('PW-b2. a failed attempt does not revoke any session', async () => {
      await changePassword(session1.accessToken, {
        current_password: 'NotMyPassword999!',
        new_password: NEW_PASSWORD,
      }).expect(403);

      const live = await prisma.userSession.count({
        where: { user_id: subject.id, revoked_at: null },
      });
      expect(live).toBe(2);
    });

    // ── C. Same password ───────────────────────────────────────────────────

    it('PW-c1. reusing the current password is rejected', async () => {
      const res = await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: validPassword,
      });
      expect(res.status).toBe(400);

      // And the account is untouched.
      expect((await login(subjectEmail, validPassword)).status).toBe(200);
    });

    // ── D. Unauthenticated ─────────────────────────────────────────────────

    it('PW-d1. an unauthenticated request is rejected with 401', async () => {
      const res = await changePassword(undefined, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      });
      expect(res.status).toBe(401);

      expect((await login(subjectEmail, validPassword)).status).toBe(200);
    });

    it('PW-d2. a garbage token is rejected with 401', async () => {
      const res = await changePassword('not.a.real.token', {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      });
      expect(res.status).toBe(401);
    });

    it('PW-d3. a revoked session cannot change the password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: session1.refreshToken })
        .expect(204);

      const res = await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      });
      expect(res.status).toBe(401);
    });

    // ── E. User isolation ──────────────────────────────────────────────────

    it('PW-e1. a client cannot target another user via the request body', async () => {
      const victimEmail = `victim-${Date.now()}@samco.com`;
      const victim = await prisma.user.create({
        data: {
          email: victimEmail,
          password_hash: await bcrypt.hash(validPassword, 10),
        },
      });
      const victimHashBefore = victim.password_hash;

      // Every shape a caller might try to smuggle a target id through.
      for (const extra of [
        { user_id: victim.id },
        { userId: victim.id },
        { id: victim.id },
        { sub: victim.id },
        { email: victimEmail },
      ]) {
        const res = await changePassword(session1.accessToken, {
          current_password: validPassword,
          new_password: NEW_PASSWORD,
          ...extra,
        });
        // forbidNonWhitelisted rejects unknown fields outright.
        expect(res.status).toBe(400);
      }

      // The victim is untouched and can still log in.
      const victimAfter = await prisma.user.findUnique({ where: { id: victim.id } });
      expect(victimAfter!.password_hash).toBe(victimHashBefore);
      expect((await login(victimEmail, validPassword)).status).toBe(200);

      // And the caller's own password was not changed either (the request failed).
      expect((await login(subjectEmail, validPassword)).status).toBe(200);

      await deleteUserCascade(prisma, victim.id);
    });

    it('PW-e2. the account changed is the token holder, not anyone named in the body', async () => {
      // Even a well-formed request only ever affects the authenticated user.
      const otherEmail = `other-${Date.now()}@samco.com`;
      const other = await prisma.user.create({
        data: {
          email: otherEmail,
          password_hash: await bcrypt.hash(validPassword, 10),
        },
      });
      const otherHashBefore = other.password_hash;

      await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      }).expect(200);

      const otherAfter = await prisma.user.findUnique({ where: { id: other.id } });
      expect(otherAfter!.password_hash).toBe(otherHashBefore);

      await deleteUserCascade(prisma, other.id);
    });

    // ── F. Audit ───────────────────────────────────────────────────────────

    it('PW-f1. a password_changed audit event is recorded', async () => {
      await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      }).expect(200);

      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'AUTHENTICATION', user_id: subject.id },
        orderBy: { created_at: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect(audit!.event_type).toBe('SECURITY');
      expect((audit!.payload as any).action).toBe('password_changed');
      expect((audit!.payload as any).revoked_other_logins).toBe(1);
    });

    it('PW-f2. the audit payload contains no credential material', async () => {
      await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      }).expect(200);

      const user = await prisma.user.findUnique({ where: { id: subject.id } });
      const audits = await prisma.auditLog.findMany({
        where: { entity_type: 'AUTHENTICATION', user_id: subject.id },
      });
      expect(audits.length).toBeGreaterThan(0);

      for (const a of audits) {
        const raw = JSON.stringify(a.payload);
        expect(raw).not.toContain(NEW_PASSWORD);
        expect(raw).not.toContain(validPassword);
        expect(raw).not.toContain(user!.password_hash);
        expect(raw).not.toMatch(/\$2[aby]\$/);
        expect(raw).not.toContain(session1.refreshToken);
        expect(raw).not.toContain(session2.refreshToken);
        expect(raw).not.toContain(session1.accessToken);
        // No raw session identifiers, no Authorization/cookie material.
        expect(raw).not.toMatch(/session_id|sessionId|authorization|cookie/i);
        expect(raw).not.toContain(session1.refreshToken.split('.')[0]);
        expect(raw).not.toContain(session2.refreshToken.split('.')[0]);
      }
    });

    it('PW-f3. a failed attempt records a failure, never a password_changed event', async () => {
      await changePassword(session1.accessToken, {
        current_password: 'WrongOne123!',
        new_password: NEW_PASSWORD,
      }).expect(403);

      const audits = await prisma.auditLog.findMany({
        where: { entity_type: 'AUTHENTICATION', user_id: subject.id },
      });

      // No success event...
      expect(
        audits.filter((a) => (a.payload as any).action === 'password_changed'),
      ).toHaveLength(0);

      // ...but the attempt IS visible. Reaching this endpoint needs a valid
      // session, so repeated failures indicate an attempt to turn session access
      // into a full account takeover, and must not be silent.
      const failures = audits.filter(
        (a) => (a.payload as any).action === 'password_change_failure',
      );
      expect(failures).toHaveLength(1);
      expect((failures[0].payload as any).reason).toBe('invalid_current_password');

      // The failure record still leaks nothing.
      const raw = JSON.stringify(failures[0].payload);
      expect(raw).not.toContain('WrongOne123!');
      expect(raw).not.toContain(NEW_PASSWORD);
      expect(raw).not.toMatch(/\$2[aby]\$/);
    });

    // ── G. Session behaviour ───────────────────────────────────────────────

    it('PW-g1. the calling session survives; the other session is revoked', async () => {
      const res = await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      });
      expect(res.status).toBe(200);
      expect(res.body.revoked_other_logins).toBe(1);

      // Current access token still works.
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${session1.accessToken}`)
        ).status,
      ).toBe(200);

      // The other session's ACCESS token is dead too — session binding means
      // revoking the row kills the token without waiting for it to expire.
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${session2.accessToken}`)
        ).status,
      ).toBe(401);
    });

    it('PW-g2. the other session cannot refresh, the current one can', async () => {
      await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      }).expect(200);

      const otherRefresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session2.refreshToken });
      expect(otherRefresh.status).toBe(401);

      const ownRefresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session1.refreshToken });
      expect(ownRefresh.status).toBe(200);
      expect(ownRefresh.body.accessToken).toBeDefined();
    });

    it('PW-g3. session rows reflect exactly one surviving login', async () => {
      const currentSessionId = session1.refreshToken.split('.')[0];

      await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      }).expect(200);

      const live = await prisma.userSession.findMany({
        where: { user_id: subject.id, revoked_at: null },
      });
      expect(live).toHaveLength(1);
      expect(live[0].id).toBe(currentSessionId);
    });

    it('PW-g4. only this user\'s sessions are revoked', async () => {
      const bystanderEmail = `bystander-${Date.now()}@samco.com`;
      await prisma.user.create({
        data: {
          email: bystanderEmail,
          password_hash: await bcrypt.hash(validPassword, 10),
        },
      });
      const bystander = await login(bystanderEmail, validPassword);

      await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      }).expect(200);

      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${bystander.body.accessToken}`)
        ).status,
      ).toBe(200);

      const b = await prisma.user.findUnique({ where: { email: bystanderEmail } });
      await deleteUserCascade(prisma, b!.id);
    });

    // ── H. Disabled user ───────────────────────────────────────────────────

    it('PW-h1. a globally disabled user cannot change their password', async () => {
      const hashBefore = (await prisma.user.findUnique({ where: { id: subject.id } }))!
        .password_hash;

      await prisma.user.update({
        where: { id: subject.id },
        data: { status: 'INACTIVE' },
      });

      const res = await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      });
      expect(res.status).toBe(401);

      const after = await prisma.user.findUnique({ where: { id: subject.id } });
      expect(after!.password_hash).toBe(hashBefore);
    });

    // ── I. Membership isolation ────────────────────────────────────────────

    it('PW-i1. password change is global and does not touch company membership', async () => {
      const company = await prisma.company.create({
        data: { name: `PwChange Co ${Date.now()}` },
      });
      const membership = await prisma.companyMembership.create({
        data: { user_id: subject.id, company_id: company.id, status: 'ACTIVE' },
      });

      await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      }).expect(200);

      const after = await prisma.companyMembership.findUnique({
        where: { id: membership.id },
      });
      expect(after!.status).toBe('ACTIVE');
      expect(after!.company_id).toBe(company.id);

      const all = await prisma.companyMembership.findMany({
        where: { user_id: subject.id },
      });
      expect(all).toHaveLength(1);

      // Global user status is likewise untouched.
      const user = await prisma.user.findUnique({ where: { id: subject.id } });
      expect(user!.status).toBe('ACTIVE');

      await prisma.companyMembership.delete({ where: { id: membership.id } });
      await prisma.company.delete({ where: { id: company.id } });
    });

    // ── J. Generic errors / policy ─────────────────────────────────────────

    it('PW-j1. a wrong current password reveals nothing beyond the failure', async () => {
      const res = await changePassword(session1.accessToken, {
        current_password: 'WrongOne123!',
        new_password: NEW_PASSWORD,
      });

      expect(res.status).toBe(403);
      const raw = JSON.stringify(res.body);
      // No hash, no other-account information, no internals.
      expect(raw).not.toMatch(/\$2[aby]\$/);
      expect(raw).not.toContain(subject.id);
      expect(raw).not.toContain(subjectEmail);
      expect(raw).not.toMatch(/prisma|sql|stack/i);
    });

    it('PW-j2. 403 is used rather than 401 so a typo is not mistaken for an expired session', async () => {
      const wrongPassword = await changePassword(session1.accessToken, {
        current_password: 'WrongOne123!',
        new_password: NEW_PASSWORD,
      });
      const noToken = await changePassword(undefined, {
        current_password: validPassword,
        new_password: NEW_PASSWORD,
      });

      expect(wrongPassword.status).toBe(403);
      expect(noToken.status).toBe(401);
      expect(wrongPassword.status).not.toBe(noToken.status);
    });

    it('PW-j3. the password policy is enforced on the new password', async () => {
      const tooShort = await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: 'Ab1!',
      });
      expect(tooShort.status).toBe(400);

      const tooLong = await changePassword(session1.accessToken, {
        current_password: validPassword,
        new_password: 'A1!'.repeat(40), // 120 chars, past bcrypt's 72-byte input ceiling
      });
      expect(tooLong.status).toBe(400);

      // Unchanged throughout.
      expect((await login(subjectEmail, validPassword)).status).toBe(200);
    });

    it('PW-j4. missing fields are rejected', async () => {
      expect(
        (await changePassword(session1.accessToken, { new_password: NEW_PASSWORD })).status,
      ).toBe(400);
      expect(
        (await changePassword(session1.accessToken, { current_password: validPassword }))
          .status,
      ).toBe(400);
      expect((await changePassword(session1.accessToken, {})).status).toBe(400);
    });
  });
});
