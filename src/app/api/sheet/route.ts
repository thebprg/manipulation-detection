import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const scriptUrl = process.env.GOOGLE_SHEET_SCRIPT_URL;
    if (!scriptUrl) {
      return NextResponse.json({ error: 'GOOGLE_SHEET_SCRIPT_URL is not configured' }, { status: 500 });
    }

    const response = await fetch(scriptUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch from Google Sheets: ${response.statusText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching sheet data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch' },
      { status: 500 }
    );
  }
}
