import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    await app.init();
    prisma = app.get(PrismaService);

    // Clean up before tests
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();

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
    await prisma.auditLog.deleteMany();
    await prisma.userBranchRole.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.companyMembership.deleteMany();
    await prisma.user.deleteMany();
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
});
