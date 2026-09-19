import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter.js';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildCorsOptions } from './core/cors.js';
import { securityHeaders, trustProxySetting } from './core/security-headers.js';
import { MAX_REQUEST_BODY_SIZE } from './core/http-body-limit.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    // Configure default logger
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    // Disable Nest's default body parser so the larger limit below (needed
    // for base64 photo uploads — banquet booking photos, checklist item
    // photos) applies instead of Express's 100kb default.
    bodyParser: false,
  });
  app.use(json({ limit: MAX_REQUEST_BODY_SIZE }));
  app.use(urlencoded({ extended: true, limit: MAX_REQUEST_BODY_SIZE }));

  // Enable graceful shutdown (triggers OnModuleDestroy, etc.)
  app.enableShutdownHooks();

  // Set global API prefix
  app.setGlobalPrefix('api/v1');

  // Register global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Register global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const configService = app.get(ConfigService);

  // Response hardening and proxy trust. See core/security-headers.ts for why
  // each is set the way it is.
  const http = app.getHttpAdapter().getInstance() as {
    disable(setting: string): void;
    set(setting: string, value: unknown): void;
  };
  http.disable('x-powered-by');
  const trustProxy = trustProxySetting(configService.get<string>('TRUST_PROXY'));
  if (trustProxy !== undefined) http.set('trust proxy', trustProxy);
  app.use(securityHeaders({ hsts: configService.get<string>('NODE_ENV') === 'production' }));

  // The browser app runs on its own origin; without an allowlist every request
  // from it is blocked before it leaves the browser. See core/cors.ts.
  app.enableCors(buildCorsOptions(configService.get<string>('CORS_ORIGINS')));

  const port = configService.get<number>('PORT') || 3001;

  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}/api/v1`);
}
bootstrap();
