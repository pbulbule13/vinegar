/**
 * Suggestions API Route
 * GET /api/suggestions - Get proactive suggestions
 * DELETE /api/suggestions - Dismiss a suggestion by id
 */

import { NextResponse } from 'next/server';
import '@/lib/init';
import { getActiveSuggestions, dismissSuggestion, scanForSuggestions } from '@/lib/suggestion-engine';

export const dynamic = 'force-dynamic';

export async function GET() {
  scanForSuggestions();
  const suggestions = getActiveSuggestions();
  return NextResponse.json({ suggestions });
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Suggestion id required' }, { status: 400 });
    }
    dismissSuggestion(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
