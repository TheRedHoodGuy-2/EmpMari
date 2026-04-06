import { NextResponse } from 'next/server';

// Placeholder — bot cache expires automatically after 5 minutes.
// This endpoint exists so the dashboard can show a "Refresh bot config"
// button that feels intentional. No action needed server-side.
export async function POST() {
  return NextResponse.json({ ok: true, message: 'Bot config cache will refresh within 5 minutes.' });
}
