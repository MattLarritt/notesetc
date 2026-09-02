import { renderHfmToSafeHtml } from '../../../lib/render';
import type { CommentNode } from '../../../lib/api';

export type RenderedComment = Omit<CommentNode, 'replies'> & {
  bodyHtml: string;
  replies: RenderedComment[];
};

/** Pre-render comment bodies to safe HTML server-side (the sanitizer is server-only). */
export function renderComments(nodes: CommentNode[]): RenderedComment[] {
  return nodes.map((n) => ({
    ...n,
    bodyHtml: n.deleted ? '' : renderHfmToSafeHtml(n.body),
    replies: renderComments(n.replies),
  }));
}
