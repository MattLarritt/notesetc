import { PrismaClient } from '@prisma/client';

/**
 * Demo/seed data. Idempotent — safe to run repeatedly. Establishes a handful of
 * spaces, each with a welcome page (initial version), so the app has realistic
 * multi-space content to browse. The breakglass admin is bootstrapped from env
 * by the application on boot (M1), not here.
 */
const prisma = new PrismaClient();

interface SeedSpace {
  key: string;
  name: string;
  description: string;
  icon: string;
  welcome: { title: string; body: string };
}

const SPACES: SeedSpace[] = [
  {
    key: 'IT',
    icon: 'computer',
    name: 'IT Knowledgebase',
    description: 'Internal IT documentation, runbooks, and how-tos.',
    welcome: {
      title: 'Welcome to Notes Etc',
      body: [
        '# Welcome to Notes Etc',
        '',
        'This is the IT knowledgebase. Pages support headings, tables, code blocks,',
        'links, and callouts.',
        '',
        ':::tip',
        'Content is stored as Notes Etc Flavored Markdown — stable and safe for AI tools',
        'to read and propose changes.',
        ':::',
        '',
      ].join('\n'),
    },
  },
  {
    key: 'ENG',
    icon: 'engineering',
    name: 'Engineering',
    description: 'Architecture decisions, service docs, and on-call runbooks.',
    welcome: {
      title: 'Engineering Handbook',
      body: [
        '# Engineering Handbook',
        '',
        'Standards, architecture, and runbooks for the engineering team.',
        '',
        '## Sections',
        '',
        '- Services & ownership',
        '- Deployment & release process',
        '- On-call & incident response',
        '',
        ':::note',
        'Propose changes rather than editing critical runbooks directly.',
        ':::',
        '',
      ].join('\n'),
    },
  },
  {
    key: 'SEC',
    icon: 'security',
    name: 'Security & Compliance',
    description: 'Policies, standards, and incident procedures.',
    welcome: {
      title: 'Security Overview',
      body: [
        '# Security Overview',
        '',
        'Policies and procedures for keeping company systems secure.',
        '',
        ':::warning',
        'Report suspected incidents to the security team immediately.',
        ':::',
        '',
        '| Policy | Owner | Review cycle |',
        '| --- | --- | --- |',
        '| Access control | SecOps | Quarterly |',
        '| Data retention | Compliance | Annual |',
        '',
      ].join('\n'),
    },
  },
  {
    key: 'HR',
    icon: 'groups',
    name: 'People & HR',
    description: 'Onboarding, policies, and people processes.',
    welcome: {
      title: 'People Handbook',
      body: [
        '# People Handbook',
        '',
        'Onboarding guides, leave policies, and team processes.',
        '',
        '## New starters',
        '',
        '1. Accounts & access',
        '2. Equipment',
        '3. First-week checklist',
        '',
      ].join('\n'),
    },
  },
  {
    key: 'OPS',
    icon: 'factory',
    name: 'Operations',
    description: 'Plant operations, maintenance, and logistics documentation.',
    welcome: {
      title: 'Operations Home',
      body: [
        '# Operations Home',
        '',
        'Documentation for plant operations, maintenance schedules, and logistics.',
        '',
        ':::info',
        'Looking for a specific procedure? Use search or browse the tree.',
        ':::',
        '',
      ].join('\n'),
    },
  },
];

async function seedSpace(def: SeedSpace): Promise<void> {
  const space = await prisma.space.upsert({
    where: { key: def.key },
    update: { status: 'active', archivedAt: null, icon: def.icon }, // reactivate + set icon
    create: {
      key: def.key,
      name: def.name,
      description: def.description,
      icon: def.icon,
      status: 'active',
    },
  });

  const slug = 'welcome';
  const existing = await prisma.page.findFirst({
    where: { spaceId: space.id, parentId: null, slug },
  });
  if (existing) return;

  const page = await prisma.page.create({
    data: { spaceId: space.id, slug, title: def.welcome.title, status: 'published', position: 0 },
  });
  const version = await prisma.pageVersion.create({
    data: {
      pageId: page.id,
      versionNumber: 1,
      title: def.welcome.title,
      content: def.welcome.body,
      contentFormat: 'hfm/1',
      changeSummary: 'Initial seed.',
      authorType: 'system',
    },
  });
  await prisma.page.update({ where: { id: page.id }, data: { currentVersionId: version.id } });
}

async function main(): Promise<void> {
  for (const def of SPACES) {
    await seedSpace(def);
  }
  await prisma.auditLog.create({
    data: { actorType: 'system', action: 'system.seed', result: 'success' },
  });
  console.log(`Seed complete: ${SPACES.length} spaces with welcome pages.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
