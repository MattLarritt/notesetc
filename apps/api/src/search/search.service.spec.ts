import { beforeEach, describe, expect, it } from 'vitest';
import { GlobalRole, PageStatus, type Principal, ResourceRole } from '@notesetc/shared';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { AuditRepository } from '../repositories/audit.repository';
import { type SearchParams, type SearchRow, SearchRepository } from '../repositories/search.repository';
import { type SpaceRecord, SpaceRepository } from '../repositories/space.repository';
import { SearchService } from './search.service';

const SPACE_A = 'space-a';
const SPACE_B = 'space-b';

class NoopAudit extends AuditRepository {
  async append() {}
}

class FakeSearchRepo extends SearchRepository {
  rows: SearchRow[] = [
    { id: 'p1', spaceId: SPACE_A, slug: 'p1', title: 'Alpha runbook', icon: null, status: PageStatus.Published, content: 'restart the alpha service' },
    { id: 'p2', spaceId: SPACE_A, slug: 'p2', title: 'Alpha draft', icon: null, status: PageStatus.Draft, content: 'draft alpha notes' },
    { id: 'p3', spaceId: SPACE_B, slug: 'p3', title: 'Alpha secret', icon: null, status: PageStatus.Published, content: 'alpha in space B' },
  ];
  lastParams: SearchParams | null = null;
  async search(params: SearchParams): Promise<SearchRow[]> {
    this.lastParams = params;
    let rows = this.rows.filter(
      (r) => r.title.toLowerCase().includes(params.query.toLowerCase()) || r.content.toLowerCase().includes(params.query.toLowerCase()),
    );
    if (params.spaceIds) rows = rows.filter((r) => params.spaceIds!.includes(r.spaceId));
    return rows.slice(0, params.limit);
  }
}

class FakeSpaces extends SpaceRepository {
  async list() { return []; }
  async findById() { return null; }
  async findByKey(key: string): Promise<SpaceRecord | null> {
    const map: Record<string, string> = { A: SPACE_A, B: SPACE_B };
    if (!map[key]) return null;
    return { id: map[key], key, name: key, description: null, icon: null, overview: null, ownerId: null, status: 'active', createdAt: new Date(), updatedAt: new Date(), archivedAt: null };
  }
  async create() { throw new Error('x'); }
  async update() { throw new Error('x'); }
  async archive() { throw new Error('x'); }
  async unarchive() { throw new Error('x'); }
}

function principal(globalRole: GlobalRole, grants: Principal['grants'] = []): Principal {
  return { userId: 'u1', email: 'u1@x.com', globalRole, grants, via: 'session', actorType: 'human' };
}

describe('SearchService', () => {
  let svc: SearchService;
  let repo: FakeSearchRepo;

  beforeEach(() => {
    repo = new FakeSearchRepo();
    svc = new SearchService(repo, new FakeSpaces(), new AuthorizationService(new AuditService(new NoopAudit())));
  });

  it('returns nothing for a too-short query', async () => {
    expect(await svc.query(principal(GlobalRole.GlobalAdmin), 'a', undefined)).toEqual([]);
  });

  it('global admin searches everything', async () => {
    const res = await svc.query(principal(GlobalRole.GlobalAdmin), 'alpha', undefined);
    expect(res.map((r) => r.pageId).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(repo.lastParams?.spaceIds).toBeUndefined();
  });

  it('limits a member to spaces they can read', async () => {
    const member = principal(GlobalRole.Member, [
      { resourceType: 'space', resourceId: SPACE_A, role: ResourceRole.Editor },
    ]);
    const res = await svc.query(member, 'alpha', undefined);
    // Only space A pages; both published + draft (editor can see drafts).
    expect(res.map((r) => r.pageId).sort()).toEqual(['p1', 'p2']);
  });

  it('hides drafts from a viewer', async () => {
    const viewer = principal(GlobalRole.Member, [
      { resourceType: 'space', resourceId: SPACE_A, role: ResourceRole.Viewer },
    ]);
    const res = await svc.query(viewer, 'alpha', undefined);
    expect(res.map((r) => r.pageId)).toEqual(['p1']); // draft p2 excluded
  });

  it('returns nothing for a member with no grants', async () => {
    expect(await svc.query(principal(GlobalRole.Member), 'alpha', undefined)).toEqual([]);
  });

  it('narrows by space key', async () => {
    const res = await svc.query(principal(GlobalRole.GlobalAdmin), 'alpha', 'B');
    expect(res.map((r) => r.pageId)).toEqual(['p3']);
  });

  it('builds a snippet around the match', async () => {
    const res = await svc.query(principal(GlobalRole.GlobalAdmin), 'restart', undefined);
    expect(res[0].snippet.toLowerCase()).toContain('restart');
  });
});
