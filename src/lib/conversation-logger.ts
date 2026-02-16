/**
 * Conversation Logger
 * Logs every question and answer for future interaction context.
 * Stores in conversation_logs table with session tracking.
 */

import { db } from './db';
import crypto from 'crypto';

// ─── Session Management ───

let currentSessionId: string = generateSessionId();

function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export function getSessionId(): string {
  return currentSessionId;
}

export function newSession(): string {
  currentSessionId = generateSessionId();
  return currentSessionId;
}

// ─── Logging ───

interface LogEntry {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string;
  source?: 'text' | 'stream' | 'voice' | 'offline';
  toolsUsed?: string[];
  tokensIn?: number;
  tokensOut?: number;
  familyMemberId?: string;
  sessionId?: string;
}

export function logConversation(entry: LogEntry): void {
  try {
    db.prepare(`
      INSERT INTO conversation_logs (session_id, role, content, model, source, tools_used, tokens_in, tokens_out, family_member_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.sessionId || currentSessionId,
      entry.role,
      entry.content,
      entry.model || null,
      entry.source || 'text',
      entry.toolsUsed ? JSON.stringify(entry.toolsUsed) : null,
      entry.tokensIn || 0,
      entry.tokensOut || 0,
      entry.familyMemberId || null,
    );
  } catch (err) {
    console.error('[ConvoLog] Failed to log:', err);
  }
}

// ─── Batch Logging (for multi-message interactions) ───

export function logConversationBatch(entries: LogEntry[]): void {
  const insert = db.prepare(`
    INSERT INTO conversation_logs (session_id, role, content, model, source, tools_used, tokens_in, tokens_out, family_member_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batchInsert = db.transaction(() => {
    for (const entry of entries) {
      insert.run(
        entry.sessionId || currentSessionId,
        entry.role,
        entry.content,
        entry.model || null,
        entry.source || 'text',
        entry.toolsUsed ? JSON.stringify(entry.toolsUsed) : null,
        entry.tokensIn || 0,
        entry.tokensOut || 0,
        entry.familyMemberId || null,
      );
    }
  });

  try {
    batchInsert();
  } catch (err) {
    console.error('[ConvoLog] Batch log failed:', err);
  }
}

// ─── Retrieval (for future context) ───

interface ConversationEntry {
  id: number;
  session_id: string;
  role: string;
  content: string;
  model: string | null;
  source: string;
  tools_used: string | null;
  created_at: number;
}

export function getRecentConversations(limit: number = 20): ConversationEntry[] {
  try {
    return db.prepare(`
      SELECT id, session_id, role, content, model, source, tools_used, created_at
      FROM conversation_logs
      WHERE role IN ('user', 'assistant')
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as ConversationEntry[];
  } catch {
    return [];
  }
}

export function getSessionHistory(sessionId: string): ConversationEntry[] {
  try {
    return db.prepare(`
      SELECT id, session_id, role, content, model, source, tools_used, created_at
      FROM conversation_logs
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId) as ConversationEntry[];
  } catch {
    return [];
  }
}

export function searchConversations(query: string, limit: number = 10): ConversationEntry[] {
  try {
    const q = `%${query}%`;
    return db.prepare(`
      SELECT id, session_id, role, content, model, source, tools_used, created_at
      FROM conversation_logs
      WHERE content LIKE ? AND role IN ('user', 'assistant')
      ORDER BY created_at DESC
      LIMIT ?
    `).all(q, limit) as ConversationEntry[];
  } catch {
    return [];
  }
}
