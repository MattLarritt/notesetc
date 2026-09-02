import { Global, Module } from '@nestjs/common';
import { AttachmentRepository } from './attachment.repository';
import { PrismaAttachmentRepository } from './prisma-attachment.repository';
import { GroupRepository } from './group.repository';
import { PrismaGroupRepository } from './prisma-group.repository';
import { ApiTokenRepository } from './api-token.repository';
import { PrismaApiTokenRepository } from './prisma-api-token.repository';
import { PageMaintainerRepository } from './page-maintainer.repository';
import { PrismaPageMaintainerRepository } from './prisma-page-maintainer.repository';
import { TemplateRepository } from './template.repository';
import { PrismaTemplateRepository } from './prisma-template.repository';
import { CommentRepository } from './comment.repository';
import { PrismaCommentRepository } from './prisma-comment.repository';
import { AutomationRepository } from './automation.repository';
import { PrismaAutomationRepository } from './prisma-automation.repository';
import { AuditRepository } from './audit.repository';
import { GrantRepository } from './grant.repository';
import { PageRepository } from './page.repository';
import { PageVersionRepository } from './page-version.repository';
import { PrismaAuditRepository } from './prisma-audit.repository';
import { PrismaGrantRepository } from './prisma-grant.repository';
import { PrismaPageRepository } from './prisma-page.repository';
import { PrismaPageVersionRepository } from './prisma-page-version.repository';
import { PrismaProposalRepository } from './prisma-proposal.repository';
import { PrismaSearchRepository } from './prisma-search.repository';
import { ProposalRepository } from './proposal.repository';
import { SearchRepository } from './search.repository';
import { PrismaSessionRepository } from './prisma-session.repository';
import { PrismaSpaceRepository } from './prisma-space.repository';
import { PrismaUserRepository } from './prisma-user.repository';
import { SessionRepository } from './session.repository';
import { SpaceRepository } from './space.repository';
import { UserRepository } from './user.repository';

/**
 * Binds repository interfaces (abstract classes) to their concrete persistence
 * implementations. To target a different database, swap the implementations
 * here — service-layer code, which depends only on the interfaces, is untouched.
 */
@Global()
@Module({
  providers: [
    { provide: AuditRepository, useClass: PrismaAuditRepository },
    { provide: UserRepository, useClass: PrismaUserRepository },
    { provide: SessionRepository, useClass: PrismaSessionRepository },
    { provide: SpaceRepository, useClass: PrismaSpaceRepository },
    { provide: GrantRepository, useClass: PrismaGrantRepository },
    { provide: PageRepository, useClass: PrismaPageRepository },
    { provide: PageVersionRepository, useClass: PrismaPageVersionRepository },
    { provide: ProposalRepository, useClass: PrismaProposalRepository },
    { provide: SearchRepository, useClass: PrismaSearchRepository },
    { provide: AttachmentRepository, useClass: PrismaAttachmentRepository },
    { provide: GroupRepository, useClass: PrismaGroupRepository },
    { provide: ApiTokenRepository, useClass: PrismaApiTokenRepository },
    { provide: PageMaintainerRepository, useClass: PrismaPageMaintainerRepository },
    { provide: TemplateRepository, useClass: PrismaTemplateRepository },
    { provide: CommentRepository, useClass: PrismaCommentRepository },
    { provide: AutomationRepository, useClass: PrismaAutomationRepository },
  ],
  exports: [
    AuditRepository,
    UserRepository,
    SessionRepository,
    SpaceRepository,
    GrantRepository,
    PageRepository,
    PageVersionRepository,
    ProposalRepository,
    SearchRepository,
    AttachmentRepository,
    GroupRepository,
    ApiTokenRepository,
    PageMaintainerRepository,
    TemplateRepository,
    CommentRepository,
    AutomationRepository,
  ],
})
export class RepositoriesModule {}
