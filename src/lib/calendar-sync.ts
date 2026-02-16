/**
 * Google Calendar Sync Engine
 * Incremental sync using syncToken (NOT polling).
 * Optional - calendar works locally without Google.
 */

import { db, generateId, getSetting, setSetting } from './db';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  status?: string;
}

export async function syncGoogleCalendar(accessToken: string, calendarId = 'primary'): Promise<{ added: number; updated: number; deleted: number }> {
  const syncToken = getSetting(`google_sync_token_${calendarId}`);
  let url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?maxResults=250&singleEvents=true`;

  if (syncToken) {
    url += `&syncToken=${syncToken}`;
  } else {
    // First sync: get events from 30 days ago
    const timeMin = new Date(Date.now() - 30 * 86400000).toISOString();
    url += `&timeMin=${timeMin}`;
  }

  let stats = { added: 0, updated: 0, deleted: 0 };
  let nextPageToken: string | undefined;

  do {
    const fetchUrl = nextPageToken ? `${url}&pageToken=${nextPageToken}` : url;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 410) {
      // syncToken expired, need full sync
      setSetting(`google_sync_token_${calendarId}`, '');
      return syncGoogleCalendar(accessToken, calendarId);
    }

    if (!res.ok) {
      throw new Error(`Google Calendar API error: ${res.status}`);
    }

    const data = await res.json();
    const events: GoogleEvent[] = data.items || [];

    const upsertEvent = db.prepare(`
      INSERT INTO calendar_events (id, external_id, title, description, start_time, end_time, all_day, location, source, calendar_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google', ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        all_day = excluded.all_day,
        location = excluded.location,
        updated_at = unixepoch()
    `);

    const deleteEvent = db.prepare("DELETE FROM calendar_events WHERE external_id = ? AND source = 'google'");

    const processEvents = db.transaction(() => {
      for (const event of events) {
        if (event.status === 'cancelled') {
          deleteEvent.run(event.id);
          stats.deleted++;
          continue;
        }

        const startTime = event.start?.dateTime
          ? Math.floor(new Date(event.start.dateTime).getTime() / 1000)
          : event.start?.date
          ? Math.floor(new Date(event.start.date).getTime() / 1000)
          : null;

        const endTime = event.end?.dateTime
          ? Math.floor(new Date(event.end.dateTime).getTime() / 1000)
          : event.end?.date
          ? Math.floor(new Date(event.end.date).getTime() / 1000)
          : null;

        if (!startTime || !endTime) continue;

        const allDay = !event.start?.dateTime;
        const localId = generateId('gevt');

        // Check if exists
        const existing = db.prepare("SELECT id FROM calendar_events WHERE external_id = ? AND source = 'google'").get(event.id);

        if (existing) {
          db.prepare(`
            UPDATE calendar_events SET title = ?, description = ?, start_time = ?, end_time = ?, all_day = ?, location = ?, updated_at = unixepoch()
            WHERE external_id = ? AND source = 'google'
          `).run(event.summary || 'Untitled', event.description || null, startTime, endTime, allDay ? 1 : 0, event.location || null, event.id);
          stats.updated++;
        } else {
          upsertEvent.run(localId, event.id, event.summary || 'Untitled', event.description || null, startTime, endTime, allDay ? 1 : 0, event.location || null, calendarId);
          stats.added++;
        }
      }
    });

    processEvents();

    // Save new sync token
    if (data.nextSyncToken) {
      setSetting(`google_sync_token_${calendarId}`, data.nextSyncToken);
    }

    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  console.log(`[CalendarSync] Synced: ${stats.added} added, ${stats.updated} updated, ${stats.deleted} deleted`);
  return stats;
}
