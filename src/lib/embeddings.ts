/**
 * Phase 4: Embedding Generation & Vector Search
 *
 * Uses Euri embedding API (free within daily limit).
 * Stores embeddings in memory_embeddings table as JSON (fallback when sqlite-vec unavailable).
 * Provides hybrid search: cosine similarity + keyword match + importance + recency.
 */

import { db, generateId } from './db';
import { createEuriClient } from './euri-client';
import { EURI_DEFAULT_EMBEDDING_MODEL } from './euri-models';

const EMBEDDING_DIM = 768; // Gemini embedding dimension

// Simple hash for change detection
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Generate embedding for text via Euri API.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const apiKey = process.env.EURI_API_KEY;
    if (!apiKey) return null;
    const client = createEuriClient();
    const vector = await client.embed(text);
    return vector.length > 0 ? vector : null;
  } catch (err) {
    console.error('[Embeddings] Generation failed:', err);
    return null;
  }
}

/**
 * Store embedding for a memory entry.
 * Skips if content hasn't changed (hash check).
 */
export async function embedMemory(memoryId: string): Promise<boolean> {
  try {
    const memory = db.prepare('SELECT id, topic, content FROM memories WHERE id = ?').get(memoryId) as { id: string; topic: string; content: string } | undefined;
    if (!memory) return false;

    const contentHash = hashContent(memory.content);

    // Check if already embedded with same content
    const existing = db.prepare('SELECT model FROM memory_embeddings WHERE memory_id = ?').get(memoryId) as { model: string } | undefined;
    if (existing && existing.model.endsWith(contentHash)) return true; // Already up to date

    const text = `${memory.topic}: ${memory.content}`;
    const vector = await generateEmbedding(text);
    if (!vector) return false;

    // Store as JSON blob
    const embeddingBlob = JSON.stringify(vector);
    db.prepare(`
      INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model, created_at)
      VALUES (?, ?, ?, unixepoch())
    `).run(memoryId, embeddingBlob, `${EURI_DEFAULT_EMBEDDING_MODEL}:${contentHash}`);

    return true;
  } catch (err) {
    console.error('[Embeddings] Failed to embed memory:', err);
    return false;
  }
}

/**
 * Embed all un-embedded memories (background job).
 */
export async function embedAllMemories(): Promise<{ embedded: number; failed: number }> {
  let embedded = 0, failed = 0;

  const unembedded = db.prepare(`
    SELECT m.id FROM memories m
    LEFT JOIN memory_embeddings me ON m.id = me.memory_id
    WHERE me.memory_id IS NULL
    ORDER BY m.created_at DESC
    LIMIT 50
  `).all() as { id: string }[];

  for (const { id } of unembedded) {
    const ok = await embedMemory(id);
    if (ok) embedded++; else failed++;
    // Rate limit: small delay between API calls
    await new Promise(r => setTimeout(r, 200));
  }

  return { embedded, failed };
}

/**
 * Semantic search: find memories similar to query text.
 * Hybrid scoring: vector similarity (60%) + keyword match (20%) + importance (10%) + recency (10%)
 */
export async function semanticSearch(
  query: string,
  limit = 5
): Promise<Array<{ id: string; topic: string; content: string; type: string; score: number }>> {
  const queryVector = await generateEmbedding(query);

  // Get all embeddings for scoring
  const rows = db.prepare(`
    SELECT m.id, m.topic, m.content, m.type, m.importance, m.created_at,
           me.embedding
    FROM memories m
    INNER JOIN memory_embeddings me ON m.id = me.memory_id
  `).all() as Array<{
    id: string; topic: string; content: string; type: string;
    importance: string; created_at: number; embedding: string;
  }>;

  const now = Math.floor(Date.now() / 1000);
  const queryLower = query.toLowerCase();

  const scored = rows.map(row => {
    let vectorScore = 0;
    if (queryVector) {
      try {
        const stored = JSON.parse(row.embedding) as number[];
        vectorScore = cosineSimilarity(queryVector, stored);
      } catch {}
    }

    // Keyword match
    const text = `${row.topic} ${row.content}`.toLowerCase();
    const keywords = queryLower.split(/\s+/);
    const keywordHits = keywords.filter(k => text.includes(k)).length;
    const keywordScore = keywords.length > 0 ? keywordHits / keywords.length : 0;

    // Importance
    const importanceMap: Record<string, number> = { high: 1, medium: 0.5, low: 0.2 };
    const importanceScore = importanceMap[row.importance] || 0.5;

    // Recency (decay over 30 days)
    const age = now - row.created_at;
    const recencyScore = Math.max(0, 1 - (age / (30 * 86400)));

    const score = (vectorScore * 0.6) + (keywordScore * 0.2) + (importanceScore * 0.1) + (recencyScore * 0.1);

    return { id: row.id, topic: row.topic, content: row.content, type: row.type, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Fallback keyword-only search (when embeddings unavailable).
 */
export function keywordSearch(
  query: string,
  limit = 5
): Array<{ id: string; topic: string; content: string; type: string; score: number }> {
  const q = `%${query}%`;
  const rows = db.prepare(`
    SELECT id, topic, content, type, importance, created_at FROM memories
    WHERE content LIKE ? OR topic LIKE ? OR tags LIKE ?
    ORDER BY
      CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
      created_at DESC
    LIMIT ?
  `).all(q, q, q, limit) as Array<{ id: string; topic: string; content: string; type: string }>;

  return rows.map((r, i) => ({ ...r, score: 1 - (i * 0.1) }));
}
