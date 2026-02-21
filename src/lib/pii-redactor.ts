/**
 * PII Redaction Gateway
 * Redacts personal info before sending to cloud LLMs, rehydrates on response.
 * Layers: Family names from DB + standard regex patterns.
 */

import { db } from './db';

// ─── Types ───

interface PIIMapping {
  original: string;
  token: string;
}

interface RedactionResult {
  redacted: string;
  mappings: PIIMapping[];
}

// ─── Standard Patterns ───

const PII_PATTERNS: { name: string; regex: RegExp; tokenPrefix: string }[] = [
  { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g, tokenPrefix: 'SSN' },
  { name: 'credit_card', regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, tokenPrefix: 'CC' },
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, tokenPrefix: 'EMAIL' },
  { name: 'phone', regex: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, tokenPrefix: 'PHONE' },
  { name: 'address', regex: /\b\d{1,5}\s+(?:[A-Za-z]+\s){1,4}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Court|Ct|Way|Circle|Cir|Place|Pl)\b/gi, tokenPrefix: 'ADDR' },
];

// ─── Session Cache ───

interface SessionCache {
  mappings: Map<string, string>; // original -> token
  reverseMappings: Map<string, string>; // token -> original
  familyNames: string[];
  lastRefresh: number;
  counter: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 500; // Evict when cache exceeds this size

let sessionCache: SessionCache = {
  mappings: new Map(),
  reverseMappings: new Map(),
  familyNames: [],
  lastRefresh: 0,
  counter: 0,
};

function refreshFamilyNames(): void {
  const now = Date.now();
  if (now - sessionCache.lastRefresh < SESSION_TTL_MS && sessionCache.familyNames.length > 0) return;

  try {
    const rows = db.prepare('SELECT name FROM family_members').all() as { name: string }[];
    sessionCache.familyNames = rows.map(r => r.name).filter(n => n.length > 1);
    sessionCache.lastRefresh = now;
  } catch {
    // DB might not have family_members yet
    sessionCache.familyNames = [];
    sessionCache.lastRefresh = now;
  }
}

function getOrCreateToken(original: string, prefix: string): string {
  const existing = sessionCache.mappings.get(original);
  if (existing) return existing;

  // Evict oldest entries if cache exceeds max size
  if (sessionCache.mappings.size >= MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(sessionCache.mappings.keys()).slice(0, Math.floor(MAX_CACHE_SIZE / 4));
    for (const key of keysToDelete) {
      const token = sessionCache.mappings.get(key);
      sessionCache.mappings.delete(key);
      if (token) sessionCache.reverseMappings.delete(token);
    }
  }

  sessionCache.counter++;
  const token = `<${prefix}_${sessionCache.counter}>`;
  sessionCache.mappings.set(original, token);
  sessionCache.reverseMappings.set(token, original);
  return token;
}

// ─── Public API ───

export function redact(text: string, options?: { redactFamilyNames?: boolean }): RedactionResult {
  refreshFamilyNames();

  let redacted = text;
  const mappings: PIIMapping[] = [];

  // Layer 1: Family names (only when explicitly requested, e.g., for external logging)
  // For LLM calls, family names are already in the system prompt so redacting them
  // from user messages causes misidentification in tool calls.
  if (options?.redactFamilyNames) {
    for (const name of sessionCache.familyNames) {
      const nameRegex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'gi');
      redacted = redacted.replace(nameRegex, (match) => {
        const token = getOrCreateToken(match, 'PERSON');
        mappings.push({ original: match, token });
        return token;
      });
    }
  }

  // Layer 2: Standard patterns (SSN, credit cards, emails, phones, addresses)
  for (const pattern of PII_PATTERNS) {
    redacted = redacted.replace(pattern.regex, (match) => {
      const token = getOrCreateToken(match, pattern.tokenPrefix);
      mappings.push({ original: match, token });
      return token;
    });
  }

  return { redacted, mappings };
}

export function rehydrate(text: string): string {
  let result = text;
  sessionCache.reverseMappings.forEach((original, token) => {
    result = result.split(token).join(original);
  });
  return result;
}

export function clearSession(): void {
  sessionCache = {
    mappings: new Map(),
    reverseMappings: new Map(),
    familyNames: [],
    lastRefresh: 0,
    counter: 0,
  };
}

/**
 * Sanitize text for external API calls (search engines, maps, etc.)
 * Unlike redact() which tokenizes for round-trip, this STRIPS PII entirely.
 * Lossy but private - use for DuckDuckGo, Google Maps, etc.
 */
export function sanitizeForExternal(text: string): string {
  refreshFamilyNames();
  let clean = text;

  // Strip family names
  for (const name of sessionCache.familyNames) {
    clean = clean.replace(new RegExp(`\\b${escapeRegex(name)}\\b`, 'gi'), '');
  }

  // Strip standard PII patterns (SSN, CC, email, phone, address)
  for (const pattern of PII_PATTERNS) {
    clean = clean.replace(pattern.regex, '');
  }

  // Collapse whitespace and trim
  return clean.replace(/\s+/g, ' ').trim();
}

// ─── Helpers ───

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
