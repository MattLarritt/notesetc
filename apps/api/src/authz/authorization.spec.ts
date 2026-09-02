import { describe, expect, it } from 'vitest';
import { Action, GlobalRole, type Principal, ResourceRole } from '@notesetc/shared';
import { decide, effectiveSpaceRole } from './authorization';

const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'u1',
    email: 'u1@example.com',
    globalRole: GlobalRole.Member,
    grants: [],
    via: 'session',
    actorType: 'human',
    ...overrides,
  };
}

describe('decide() — deny by default', () => {
  it('denies an action the principal has no role for', () => {
    const p = principal();
    expect(decide(p, Action.PageUpdate, { type: 'page', spaceId: SPACE }).allowed).toBe(false);
  });

  it('denies unknown/unmapped actions', () => {
    const p = principal({ globalRole: GlobalRole.Member, grants: [] });
    expect(decide(p, 'totally.unknown' as Action, { type: 'space', spaceId: SPACE }).allowed).toBe(
      false,
    );
  });
});

describe('decide() — global admin', () => {
  it('allows space-scoped actions without an explicit grant', () => {
    const p = principal({ globalRole: GlobalRole.GlobalAdmin });
    expect(decide(p, Action.PageUpdate, { type: 'page', spaceId: SPACE }).allowed).toBe(true);
    expect(decide(p, Action.SpaceCreate, { type: 'global' }).allowed).toBe(true);
  });

  it('still cannot escape token space restriction', () => {
    const p = principal({ globalRole: GlobalRole.GlobalAdmin, allowedSpaceIds: [OTHER_SPACE] });
    expect(decide(p, Action.PageUpdate, { type: 'page', spaceId: SPACE }).allowed).toBe(false);
  });
});

describe('decide() — space role hierarchy', () => {
  const viewer = principal({
    grants: [{ resourceType: 'space', resourceId: SPACE, role: ResourceRole.Viewer }],
  });
  const editor = principal({
    grants: [{ resourceType: 'space', resourceId: SPACE, role: ResourceRole.Editor }],
  });
  const admin = principal({
    grants: [{ resourceType: 'space', resourceId: SPACE, role: ResourceRole.SpaceAdmin }],
  });

  it('viewer can read published but not edit', () => {
    expect(decide(viewer, Action.PageReadPublished, { type: 'page', spaceId: SPACE }).allowed).toBe(
      true,
    );
    expect(decide(viewer, Action.PageUpdate, { type: 'page', spaceId: SPACE }).allowed).toBe(false);
  });

  it('editor can edit but not manage grants', () => {
    expect(decide(editor, Action.PageUpdate, { type: 'page', spaceId: SPACE }).allowed).toBe(true);
    expect(decide(editor, Action.SpaceManageGrants, { type: 'space', spaceId: SPACE }).allowed).toBe(
      false,
    );
  });

  it('space_admin can manage grants', () => {
    expect(decide(admin, Action.SpaceManageGrants, { type: 'space', spaceId: SPACE }).allowed).toBe(
      true,
    );
  });

  it('grant on one space does not leak to another', () => {
    expect(decide(editor, Action.PageUpdate, { type: 'page', spaceId: OTHER_SPACE }).allowed).toBe(
      false,
    );
  });

  it('global-only action denied even for space_admin', () => {
    expect(decide(admin, Action.SpaceCreate, { type: 'global' }).allowed).toBe(false);
  });
});

describe('effectiveSpaceRole', () => {
  it('returns the highest role among grants', () => {
    const p = principal({
      grants: [
        { resourceType: 'space', resourceId: SPACE, role: ResourceRole.Viewer },
        { resourceType: 'space', resourceId: SPACE, role: ResourceRole.SpaceAdmin },
      ],
    });
    expect(effectiveSpaceRole(p, SPACE)).toBe(ResourceRole.SpaceAdmin);
  });

  it('returns null when no grant exists', () => {
    expect(effectiveSpaceRole(principal(), SPACE)).toBeNull();
  });
});
