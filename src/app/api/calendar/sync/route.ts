import { NextResponse } from "next/server";
import { syncGoogleCalendar } from "@/lib/calendar-sync";
import { getSetting } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const accessToken = body.access_token || getSetting('google_access_token');

    if (!accessToken) {
      return NextResponse.json(
        { error: "No Google access token. Connect your Google Calendar in Settings." },
        { status: 401 }
      );
    }

    const calendarId = body.calendar_id || 'primary';
    const stats = await syncGoogleCalendar(accessToken, calendarId);

    return NextResponse.json({
      success: true,
      ...stats,
      message: `Synced: ${stats.added} new, ${stats.updated} updated, ${stats.deleted} removed`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
