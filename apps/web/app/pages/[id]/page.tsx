import { Fragment } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getComments, getPage, listPages } from '../../../lib/api';
import { pageRefFromParam, pageUrl } from '../../../lib/page-url';
import { renderHfmToSafeHtml } from '../../../lib/render';
import { AppIcon } from '../../components/app-icon';
import { PageToc } from '../../components/page-toc';
import { HistoryModal } from './history-modal';
import { ProposalsModal } from './proposals-modal';
import { loadProposalItems } from './proposal-data';
import { CommentsModal } from './comments-modal';
import { renderComments } from './comment-render';
import { AttachmentBits } from '../../components/attachment-viewer';
import { MermaidBlocks } from '../../components/mermaid-blocks';
import { SparkIcon } from '../../components/ai-icons';

export const dynamic = 'force-dynamic';

export default async function PageView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getPage(pageRefFromParam(id));

  if (!detail) {
    return (
      <div className="doc">
        <h1>Page not found</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          It may be a draft you can’t access, or it doesn’t exist.
        </p>
        <Link href="/spaces">← Spaces</Link>
      </div>
    );
  }

  const { page, version, capabilities: can } = detail;

  // Pages created by the AI chat carry their originating chat id in metadata.
  // The API returns metadata as a parsed object; tolerate a JSON string too.
  let aiChatId: string | null = null;
  try {
    const raw = page.metadata;
    const meta = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { aiChat?: { id?: string } } | null;
    aiChatId = meta?.aiChat?.id ?? null;
  } catch {
    /* malformed metadata -> no button */
  }

  // Normalize the address bar to the canonical /p/<slug>-<code>: this upgrades
  // legacy /pages/<uuid> links and fixes a stale slug after a rename/move.
  const canonical = pageUrl(page);
  if (page.shortId && `/p/${id}` !== canonical) redirect(canonical);
  const html = renderHfmToSafeHtml(version?.content ?? '');
  const siblings = await listPages(page.spaceId);
  const hasSubpages = siblings.some((p) => p.parentId === page.id);

  const reviewDue = page.reviewDueAt ? new Date(page.reviewDueAt) : null;
  const reviewOverdue = reviewDue ? reviewDue.getTime() < Date.now() : false;
  const reviewDueSoon = reviewDue ? !reviewOverdue && reviewDue.getTime() < Date.now() + 14 * 86_400_000 : false;

  // Reviewers who can't edit reach proposals from the read view (editors use the
  // editor's settings panel instead). Pre-render content for the modal.
  const showProposals = can.review && !can.edit;
  const proposalItems = showProposals ? await loadProposalItems(page.id) : [];

  // Comments: visible to anyone who can read the page; posting is gated server-side.
  const commentData = await getComments(page.id);

  // An author-placed `:::subpages` block becomes a marker div; split on it so the
  // subpage tree renders exactly where they put it. No marker → auto card at end.
  const chunks = version?.content ? html.split(/<div class="nefm-subpages">\s*<\/div>/) : [''];
  const hasEmbed = chunks.length > 1;
  const subpagesBlock = () => (
    <div className="space-toc card" style={{ margin: '1.5rem 0' }}>
      <h3 style={{ marginTop: 0 }}>Subpages</h3>
      {hasSubpages ? (
        <PageToc pages={siblings} rootId={page.id} />
      ) : (
        <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>No subpages yet.</p>
      )}
    </div>
  );

  return (
    <div className="doc-wide">
      <div className="doc-header">
        <div className="doc-header-main">
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {page.icon && <AppIcon icon={page.icon} size={28} />}
            {page.title}
          </h1>
          <div style={{ marginTop: '0.35rem' }}>
            <span className={`badge ${page.status}`}>{page.status}</span>
            {version && (
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginLeft: 8 }}>
                v{version.versionNumber}
                {version.authorType !== 'human' && ` · ${version.authorType}`}
              </span>
            )}
            {reviewDue && (
              <span
                style={{
                  marginLeft: 8,
                  padding: '0.1rem 0.55rem',
                  borderRadius: 999,
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: reviewOverdue ? '#fdeaea' : reviewDueSoon ? '#fdf2e6' : '#e6f4ea',
                  color: reviewOverdue ? '#c0392b' : reviewDueSoon ? '#b8730b' : '#1e7d34',
                }}
              >
                {reviewOverdue ? 'Review overdue' : `Review due ${reviewDue.toLocaleDateString()}`}
              </span>
            )}
          </div>
        </div>

        <div className="page-actions doc-header-actions">
          {aiChatId && (
            <Link href={`/ai?chat=${encodeURIComponent(aiChatId)}`} className="ai-revisit-btn" title="This page was created in an AI chat — reopen it">
              <SparkIcon size={13} /> Revisit this chat
            </Link>
          )}
          {can.edit ? (
            <Link href={`${canonical}/edit`} className="btn-primary" style={{ textDecoration: 'none' }}>
              Edit
            </Link>
          ) : (
            can.propose && (
              <Link href={`${canonical}/propose`} className="btn-primary" style={{ textDecoration: 'none' }}>
                Suggest edit
              </Link>
            )
          )}
          {can.edit && (
            <HistoryModal
              pageId={page.id}
              currentVersionId={page.currentVersionId}
              canRestore={can.edit}
              triggerClass="btn-secondary"
            />
          )}
          {/* Editors reach proposals from the editor's settings panel; a
              review-only user needs a direct way in. */}
          {showProposals && (
            <ProposalsModal
              pageId={page.id}
              proposals={proposalItems}
              canReview={can.review}
              canPropose={can.propose}
              openCount={proposalItems.filter((p) => p.status === 'open').length}
              triggerClass="btn-secondary"
            />
          )}
          {commentData && (
            <CommentsModal
              pageId={page.id}
              comments={renderComments(commentData.comments)}
              canComment={commentData.canComment}
              triggerClass="btn-secondary"
            />
          )}
        </div>
      </div>

      <div className="doc">
        {!version?.content ? (
          <p style={{ color: 'var(--color-text-muted)' }}>This page has no content yet.</p>
        ) : hasEmbed ? (
          // Author placed the Subpages block — render the tree at that spot(s).
          chunks.map((chunk, i) => (
            <Fragment key={i}>
              <div className="prose" dangerouslySetInnerHTML={{ __html: chunk }} />
              {i < chunks.length - 1 && subpagesBlock()}
            </Fragment>
          ))
        ) : (
          <>
            <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
            {hasSubpages && subpagesBlock()}
          </>
        )}
        <AttachmentBits />
        <MermaidBlocks />
      </div>
    </div>
  );
}
