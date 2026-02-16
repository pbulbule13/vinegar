/**
 * Phase 4: Episodic Memory
 *
 * Logs significant interactions as episodes for pattern detection.
 * - Conversation summaries after each session
 * - Learning from corrections
 * - Pattern detection over time
 */

import { db, generateId } from './db';

export type EpisodeType =
  | 'conversation'
  | 'correction'
  | 'tool_usage'
  | 'preference_learned'
  | 'routine_detected'
  | 'skill_created'
  | 'milestone';

interface Episode {
  id: string;
  event_type: EpisodeType;
  summary: string;
  details: string | null;
  family_member_id: string | null;
  session_id: string | null;
  created_at: number;
}

/**
 * Log an episode.
 */
export function logEpisode(params: {
  event_type: EpisodeType;
  summary: string;
  details?: string;
  family_member_id?: string;
  session_id?: string;
}): string {
  const id = generateId('ep');
  db.prepare(`
    INSERT INTO episodes (id, event_type, summary, details, family_member_id, session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
  `).run(
    id,
    params.event_type,
    params.summary,
    params.details || null,
    params.family_member_id || null,
    params.session_id || null
  );
  return id;
}

/**
 * Summarize a conversation session.
 * Called after a chat session ends or after N messages.
 */
export function logConversationSummary(
  messages: Array<{ role: string; content: string }>,
  sessionId: string,
  memberId?: string
): string | null {
  if (messages.length < 2) return null;

  // Extract key topics from conversation
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
  const topics = extractTopics(userMessages);
  const summary = `Discussed: ${topics.join(', ')}. ${userMessages.length} user messages.`;

  return logEpisode({
    event_type: 'conversation',
    summary,
    details: JSON.stringify({
      messageCount: messages.length,
      topics,
      firstMessage: userMessages[0]?.substring(0, 100),
    }),
    family_member_id: memberId,
    session_id: sessionId,
  });
}

/**
 * Log when user corrects Vinegar.
 */
export function logCorrection(
  originalResponse: string,
  correctedInfo: string,
  memberId?: string
): string {
  return logEpisode({
    event_type: 'correction',
    summary: `Corrected: ${correctedInfo.substring(0, 100)}`,
    details: JSON.stringify({
      original: originalResponse.substring(0, 200),
      correction: correctedInfo.substring(0, 200),
    }),
    family_member_id: memberId,
  });
}

/**
 * Log tool usage for pattern detection.
 */
export function logToolUsage(
  toolName: string,
  args: Record<string, unknown>,
  memberId?: string
): string {
  return logEpisode({
    event_type: 'tool_usage',
    summary: `Used tool: ${toolName}`,
    details: JSON.stringify(args),
    family_member_id: memberId,
  });
}

/**
 * Detect patterns from recent episodes.
 * Returns patterns like "You usually go grocery shopping on Saturdays"
 */
export function detectPatterns(memberId?: string): string[] {
  const patterns: string[] = [];

  try {
    // Detect frequent tool usage patterns
    const toolPatterns = db.prepare(`
      SELECT summary, COUNT(*) as count,
             GROUP_CONCAT(DISTINCT strftime('%w', created_at, 'unixepoch')) as days
      FROM episodes
      WHERE event_type = 'tool_usage'
      ${memberId ? "AND family_member_id = ?" : ""}
      AND created_at > unixepoch() - (30 * 86400)
      GROUP BY summary
      HAVING count >= 3
      ORDER BY count DESC
      LIMIT 5
    `).all(...(memberId ? [memberId] : [])) as { summary: string; count: number; days: string }[];

    for (const p of toolPatterns) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const mostFrequentDay = p.days?.split(',')
        .reduce<Record<string, number>>((acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; }, {});
      const topDay = mostFrequentDay
        ? Object.entries(mostFrequentDay).sort(([, a], [, b]) => b - a)[0]?.[0]
        : null;

      if (topDay) {
        patterns.push(`${p.summary} (${p.count} times, often on ${dayNames[parseInt(topDay)]}s)`);
      }
    }

    // Detect conversation topic patterns
    const topicPatterns = db.prepare(`
      SELECT details FROM episodes
      WHERE event_type = 'conversation'
      ${memberId ? "AND family_member_id = ?" : ""}
      AND created_at > unixepoch() - (14 * 86400)
      ORDER BY created_at DESC
      LIMIT 20
    `).all(...(memberId ? [memberId] : [])) as { details: string }[];

    const allTopics: Record<string, number> = {};
    for (const ep of topicPatterns) {
      try {
        const parsed = JSON.parse(ep.details);
        for (const t of (parsed.topics || [])) {
          allTopics[t] = (allTopics[t] || 0) + 1;
        }
      } catch {}
    }

    const frequentTopics = Object.entries(allTopics)
      .filter(([, count]) => count >= 3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    if (frequentTopics.length > 0) {
      patterns.push(`Frequent topics: ${frequentTopics.map(([t, c]) => `${t} (${c}x)`).join(', ')}`);
    }
  } catch {}

  return patterns;
}

/**
 * Get recent episodes for a member.
 */
export function getRecentEpisodes(memberId?: string, limit = 10): Episode[] {
  const rows = db.prepare(`
    SELECT * FROM episodes
    ${memberId ? "WHERE family_member_id = ?" : ""}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...(memberId ? [memberId, limit] : [limit])) as Episode[];
  return rows;
}

// ─── Helpers ───

function extractTopics(messages: string[]): string[] {
  const topicKeywords: Record<string, string[]> = {
    calendar: ['calendar', 'schedule', 'event', 'meeting', 'appointment'],
    tasks: ['task', 'todo', 'remind', 'due'],
    grocery: ['grocery', 'shopping', 'buy', 'food'],
    meals: ['meal', 'dinner', 'lunch', 'breakfast', 'cook', 'recipe'],
    chores: ['chore', 'clean', 'wash', 'vacuum'],
    activities: ['activity', 'swim', 'soccer', 'lesson', 'practice'],
    family: ['family', 'kids', 'children'],
    weather: ['weather', 'temperature', 'rain', 'forecast'],
  };

  const topics = new Set<string>();
  for (const msg of messages) {
    const lower = msg.toLowerCase();
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(k => lower.includes(k))) {
        topics.add(topic);
      }
    }
  }

  return topics.size > 0 ? Array.from(topics) : ['general'];
}
