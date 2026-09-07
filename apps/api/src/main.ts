import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter.js';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildCorsOptions } from './core/cors.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    // Configure default logger
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

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

  // The browser app runs on its own origin; without an allowlist every request
  // from it is blocked before it leaves the browser. See core/cors.ts.
  app.enableCors(buildCorsOptions(configService.get<string>('CORS_ORIGINS')));

  const port = configService.get<number>('PORT') || 3001;

  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}/api/v1`);
}
bootstrap();
