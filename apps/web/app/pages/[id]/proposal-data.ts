import { listProposals } from '../../../lib/api';
import { renderHfmToSafeHtml } from '../../../lib/render';
import type { ProposalModalItem } from './proposals-modal';

const ORIGIN_LABEL: Record<string, string> = {
  human: 'Human',
  api_token: 'API token',
  ai_tool: 'AI tool',
};

/** Load proposals and pre-render their content server-side (sanitizer is server-only). */
export async function loadProposalItems(pageId: string): Promise<ProposalModalItem[]> {
  const proposals = await listProposals(pageId);
  return proposals.map((p) => ({
    id: p.id,
    status: p.status,
    originLabel: ORIGIN_LABEL[p.originType] ?? p.originType,
    aiAgentLabel: p.aiAgentLabel,
    createdAt: p.createdAt,
    rationale: p.rationale,
    proposedTitle: p.proposedTitle,
    contentHtml: renderHfmToSafeHtml(p.proposedContent),
  }));
}
