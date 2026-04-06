import { NextRequest, NextResponse } from 'next/server';
import { createRegistry, registerTensuraTemplates } from '@mariabelle/parser';

const registry = createRegistry();
registerTensuraTemplates(registry);

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('raw' in body) ||
    typeof (body as Record<string, unknown>)['raw'] !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Body must be { raw: string }' },
      { status: 400 },
    );
  }

  const raw = (body as { raw: string }).raw;
  const trace = registry.trace(raw);

  return NextResponse.json(trace);
}
