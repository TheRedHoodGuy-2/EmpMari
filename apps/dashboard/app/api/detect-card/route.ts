import { NextRequest, NextResponse } from 'next/server';
import { detectCard } from '@mariabelle/card-detector';
import { join } from 'path';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

// Resolved at request time — process.cwd() is the dashboard app dir in Next.js
// This bypasses webpack path mangling entirely
function getWorkerPath(): string {
  return join(process.cwd(), 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js');
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('image');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Image too large' }, { status: 400 });
  }

  const buffer = Buffer.from(arrayBuffer);

  try {
    const result = await detectCard(buffer, getWorkerPath());
    return NextResponse.json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Could not read image', detail }, { status: 400 });
  }
}
