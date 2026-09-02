import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditResult } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { UserRepository } from '../repositories/user.repository';
import type { LoginDto } from './dto';
import { PasswordService } from './password.service';
import { type IssuedSession, SessionService } from './session.service';

export interface LoginResult {
  session: IssuedSession;
  user: { id: string; email: string; displayName: string; globalRole: string };
}

/**
 * A throwaway argon2 hash used to equalize timing when the account does not
 * exist, mitigating user-enumeration via response-time differences.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3g2Z1p6Xk8m0mQpQvV0Xk8m0mQpQvV0Xk8m0mQpQvV0';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto, ctx: AuditContext): Promise<LoginResult> {
    const user = await this.users.findByEmail(dto.email);

    // Always run a verify to keep timing uniform whether or not the user exists
    // and whether or not they have a local password.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const passwordOk = await this.passwords.verify(hash, dto.password);

    const fail = async (reason: string): Promise<never> => {
      await this.audit.record(
        null,
        {
          action: 'auth.login',
          result: AuditResult.Denied,
          targetType: 'user',
          targetId: user?.id,
          metadata: { email: dto.email, reason },
        },
        ctx,
      );
      throw new UnauthorizedException('Invalid email or password.');
    };

    if (!user) return fail('no_such_user');
    if (user.status === 'disabled') return fail('account_disabled');
    if (!user.passwordHash) return fail('no_local_password');
    if (!passwordOk) return fail('bad_password');

    const now = new Date();
    await this.users.recordLogin(user.id, now);
    const session = await this.sessions.issue(user.id, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    await this.audit.record(
      {
        userId: user.id,
        email: user.email,
        globalRole: user.globalRole,
        grants: [],
        via: 'session',
        actorType: 'human',
      },
      {
        action: 'auth.login',
        result: AuditResult.Success,
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email, breakglass: user.isBreakglass },
      },
      ctx,
    );

    return {
      session,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        globalRole: user.globalRole,
      },
    };
  }

  async logout(token: string | undefined, userId: string | undefined, ctx: AuditContext): Promise<void> {
    if (token) await this.sessions.revoke(token);
    await this.audit.record(
      null,
      {
        action: 'auth.logout',
        result: AuditResult.Success,
        targetType: 'user',
        targetId: userId,
      },
      ctx,
    );
  }
}
