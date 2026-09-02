import { type NextRequest, NextResponse } from 'next/server';
import { getBrandSvg } from '../../../../lib/icons.server';

export const dynamic = 'force-dynamic';

/** Resolve a single brand icon (si:<slug> or logos:<name>) to an inlineable svg. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const svg = getBrandSvg(id);
  if (!svg) return NextResponse.json({ error: 'Icon not found.' }, { status: 404 });
  return NextResponse.json({ svg });
}
