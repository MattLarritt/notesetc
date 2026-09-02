import { type NextRequest, NextResponse } from 'next/server';
import { searchApps, searchMaterial } from '../../../../lib/icons.server';

export const dynamic = 'force-dynamic';

/**
 * Icon search. `set=material` returns Material Symbols names (rendered via the
 * self-hosted font); `set=apps` returns Simple Icons brand logos with path+hex.
 * All data is served from local packages — no external icon calls.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const set = req.nextUrl.searchParams.get('set') ?? 'material';
  const q = req.nextUrl.searchParams.get('q') ?? '';

  if (set === 'apps') {
    return NextResponse.json({ icons: searchApps(q, 60) });
  }
  const names = searchMaterial(q, 80);
  return NextResponse.json({ icons: names.map((name) => ({ id: `ms:${name}`, name })) });
}
