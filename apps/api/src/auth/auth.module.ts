import { Module } from '@nestjs/common';
import { CsrfGuard } from '../common/csrf/csrf';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { InMemoryRateLimiter, RateLimiter } from '../common/rate-limit/rate-limiter';
import { ApiTokenService } from './api-token.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { BreakglassService } from './breakglass.service';
import { PasswordService } from './password.service';
import { PrincipalResolver } from './principal-resolver.service';
import { SessionService } from './session.service';
import { TokensController } from './tokens.controller';

@Module({
  controllers: [AuthController, TokensController],
  providers: [
    PasswordService,
    SessionService,
    PrincipalResolver,
    AuthService,
    ApiTokenService,
    AuthGuard,
    BreakglassService,
    CsrfGuard,
    RateLimitGuard,
    { provide: RateLimiter, useClass: InMemoryRateLimiter },
  ],
  exports: [
    PasswordService,
    SessionService,
    PrincipalResolver,
    ApiTokenService,
    AuthGuard,
    CsrfGuard,
    // Shared limiter instance (webhook endpoint throttling lives in AutomationsModule).
    RateLimiter,
  ],
})
export class AuthModule {}
