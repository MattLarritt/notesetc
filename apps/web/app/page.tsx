import { getCurrentUser } from '../lib/session';
import { listSpaces } from '../lib/api';
import { SignInCard } from './components/sign-in-card';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getCurrentUser();

  // Signed in: a calm landing that points to the navigation.
  if (user) {
    return (
      <div className="home-landing">
        <h1>Welcome to Notes Etc</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Choose a space or document from the menu on the left to get started.
        </p>
      </div>
    );
  }

  // Signed out: if any documents are public, invite browsing alongside sign-in.
  const publicSpaces = await listSpaces();
  if (publicSpaces.length > 0) {
    return (
      <div className="home-split">
        <div className="home-welcome">
          <h1>Welcome to Notes Etc</h1>
          <p>
            Browse our public documentation from the menu on the left — no sign-in needed.
          </p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            Sign in for access to everything else.
          </p>
        </div>
        <div className="home-or" aria-hidden="true">
          <span>or</span>
        </div>
        <div className="home-signin">
          <SignInCard heading="Sign in" subtitle="Access your full knowledgebase." />
        </div>
      </div>
    );
  }

  // Signed out with nothing public: just the sign-in card.
  return (
    <div className="auth-page">
      <SignInCard />
    </div>
  );
}
