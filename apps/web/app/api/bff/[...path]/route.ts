import { type NextRequest, NextResponse } from 'next/server';

/**
 * Thin BFF proxy: the browser only ever talks to this same-origin endpoint, and
 * we forward to the Notes Etc API server-side. This keeps auth cookies first-party
 * to the web origin and avoids cross-origin cookie fragility. It contains NO
 * business logic — it just relays request/response, including Set-Cookie.
 */
const API_INTERNAL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4100';

export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const target = `${API_INTERNAL}/api/v1/${path.join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const cookie = req.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const csrf = req.headers.get('x-csrf-token');
  if (csrf) headers.set('x-csrf-token', csrf);
  headers.set('x-forwarded-for', req.headers.get('x-forwarded-for') ?? '');

  // Read the body as bytes (not text) so binary payloads — image uploads — pass
  // through intact, boundary and all.
  const body =
    req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : Buffer.from(await req.arrayBuffer());

  const apiRes = await fetch(target, {
    method: req.method,
    headers,
    body,
    redirect: 'manual',
  });

  // 204/304 must not carry a body — passing one to NextResponse throws.
  const noBody = apiRes.status === 204 || apiRes.status === 304;
  // Relay bytes (not text) so served images aren't corrupted by UTF-8 decoding.
  const payload = noBody ? null : Buffer.from(await apiRes.arrayBuffer());

  const outHeaders = new Headers();
  outHeaders.set('content-type', apiRes.headers.get('content-type') ?? 'application/json');
  for (const h of ['content-disposition', 'cache-control', 'x-content-type-options']) {
    const v = apiRes.headers.get(h);
    if (v) outHeaders.set(h, v);
  }
  const res = new NextResponse(payload, { status: apiRes.status, headers: outHeaders });

  // Relay Set-Cookie headers (login/logout/csrf) back to the browser.
  for (const sc of apiRes.headers.getSetCookie()) {
    res.headers.append('set-cookie', sc);
  }
  return res;
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
export async function PUT(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
