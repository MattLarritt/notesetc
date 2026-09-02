import { cookies } from 'next/headers';

const API_INTERNAL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4100';

export interface CurrentUser {
  userId: string;
  email: string;
  globalRole: string;
}

/** Server-side: resolve the current principal by forwarding the session cookie. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API_INTERNAL}/api/v1/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { principal: CurrentUser };
    return data.principal;
  } catch {
    return null;
  }
}
