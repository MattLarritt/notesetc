import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AttachmentsModule } from './attachments/attachments.module';
import { AutomationsModule } from './automations/automations.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { RequestContextMiddleware } from './common/request-context';
import { ConfigModule } from './config/config.module';
import { GroupsModule } from './groups/groups.module';
import { HealthModule } from './health/health.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { TemplatesModule } from './templates/templates.module';
import { CommentsModule } from './comments/comments.module';
import { AiModule } from './ai/ai.module';
import { McpModule } from './mcp/mcp.module';
import { PagesModule } from './pages/pages.module';
import { ProposalsModule } from './proposals/proposals.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { SpacesModule } from './spaces/spaces.module';

/**
 * Root module. Global infrastructure modules (config, prisma, repositories,
 * audit, authz) are imported once here and exported globally so feature modules
 * can depend on the service layer without re-wiring.
 */
@Module({
  imports: [
    ConfigModule,
    // In-process event bus: page mutations emit events consumed by automations.
    EventEmitterModule.forRoot({ wildcard: true }),
    // Dynamic cron registry for scheduled automations + housekeeping sweeps.
    ScheduleModule.forRoot(),
    PrismaModule,
    RepositoriesModule,
    AuditModule,
    AuthzModule,
    AuthModule,
    SpacesModule,
    PagesModule,
    ProposalsModule,
    SearchModule,
    UsersModule,
    GroupsModule,
    AttachmentsModule,
    MaintenanceModule,
    TemplatesModule,
    CommentsModule,
    AutomationsModule,
    McpModule,
    AiModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Assign a request id to every request for audit correlation.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
