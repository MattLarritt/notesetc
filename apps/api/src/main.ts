import './load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  // Fire lifecycle hooks (onModuleDestroy etc.) on SIGTERM/SIGINT so the
  // automation execution manager can terminate its workers and mark runs.
  app.enableShutdownHooks();

  const config = app.get(ConfigService);

  // Security headers (CSP tuned per-surface in later milestones).
  app.use(helmet());

  // Parse cookies (session + CSRF). Signing is not required: the session token
  // is high-entropy and validated against a server-side hash.
  app.use(cookieParser());

  // Behind a reverse proxy in production; trust it so req.ip / secure cookies work.
  app.set('trust proxy', 1);

  // The web app is a separate origin; allow it with credentials for cookie auth.
  app.enableCors({
    origin: config.get('WEB_ORIGIN'),
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', {
    // Health probes live at the root so orchestrators don't need the API prefix.
    exclude: ['healthz', 'readyz'],
  });

  // Input validation is done with zod (per the design), not class-validator.
  // A global ZodValidationPipe is wired in alongside the first DTOs (M1+).

  // OpenAPI 3.x — generated from code, served for humans and tooling.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Notes Etc API')
    .setDescription('Enterprise IT knowledgebase — REST API (see docs/DESIGN.md §4).')
    .setVersion('0.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'token' }, 'api-token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'api/v1/openapi.json',
  });

  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');
  logger.log(`Notes Etc API listening on :${port} (docs at /docs)`);
}

void bootstrap();
