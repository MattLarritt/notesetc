import { listSpaces, listTokens, listUsers } from '../../../lib/api';
import { TokensManager } from './tokens-manager';

export const dynamic = 'force-dynamic';

export default async function AdminTokensPage() {
  const [tokens, spaces, users] = await Promise.all([
    listTokens(),
    listSpaces(true),
    listUsers(),
  ]);
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>API tokens</h2>
      <TokensManager
        tokens={tokens}
        spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
        users={users.map((u) => ({ id: u.id, email: u.email }))}
      />
    </div>
  );
}
