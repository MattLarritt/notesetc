import { getAiStatus } from '../../lib/api';
import { getCurrentUser } from '../../lib/session';
import { AiChat } from './ai-chat';

export const dynamic = 'force-dynamic';

export default async function AiChatPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  const { chat } = await searchParams;
  const user = await getCurrentUser();
  const status = user ? await getAiStatus() : { enabled: false };
  if (!user || !status.enabled) {
    return (
      <div className="doc">
        <h1>AI assistant</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          {user ? 'The AI assistant is not enabled. An administrator can turn it on under Admin → AI agent.' : 'Sign in to use the AI assistant.'}
        </p>
      </div>
    );
  }
  return <AiChat initialChatId={chat ?? null} />;
}
