/**
 * Shared topic classification patterns.
 * Extracted from buildMemoryContext() to prevent duplication.
 * Used by: llm-middleware.ts, stream/route.ts, visual-context-detector.ts
 */

export type TopicCategory =
  | 'calendar' | 'task' | 'grocery' | 'budget'
  | 'weather' | 'recipe' | 'place' | 'traffic'
  | 'skill_gap' | 'general';

interface TopicPattern {
  category: TopicCategory;
  pattern: RegExp;
}

// Pre-compiled regex patterns (shared across all consumers)
const TOPIC_PATTERNS: TopicPattern[] = [
  {
    category: 'calendar',
    pattern: /\b(calendar|schedule|event|meeting|appointment|plan|today|tomorrow|week|free|busy|when)\b/i,
  },
  {
    category: 'task',
    pattern: /\b(task|todo|chore|homework|errand|remind|due|overdue)\b/i,
  },
  {
    category: 'grocery',
    pattern: /\b(grocery|groceries|shopping|buy|milk|bread|food|meal|dinner|lunch|breakfast|cook|recipe)\b/i,
  },
  {
    category: 'budget',
    pattern: /\b(budget|bill|bills|expense|subscription|payment|due|money|cost|spend|spending)\b/i,
  },
  {
    category: 'weather',
    pattern: /\b(weather|temperature|rain|snow|sunny|cloudy|forecast|wind|humidity|storm|hot|cold|warm|cool)\b/i,
  },
  {
    category: 'recipe',
    pattern: /\b(recipe|cook|bake|ingredient|dish|cuisine|food|prepare|make.*food|what.*cook)\b/i,
  },
  {
    category: 'place',
    pattern: /\b(restaurant|cafe|store|shop|nearby|near me|closest|find.*place|where.*is|directions|navigate|location)\b/i,
  },
  {
    category: 'traffic',
    pattern: /\b(traffic|commute|drive|route|eta|how long.*get|travel time|congestion)\b/i,
  },
  {
    category: 'skill_gap',
    pattern: /\b(skill gap|unanswered|couldn't answer|couldn't help|improve|improvement|what.*missing|review.*logs?|what.*can't)\b/i,
  },
];

/**
 * Classify a user message into topic categories.
 * Returns all matching categories (a message can match multiple).
 */
export function classifyTopics(message: string): TopicCategory[] {
  const matches: TopicCategory[] = [];
  for (const { category, pattern } of TOPIC_PATTERNS) {
    if (pattern.test(message)) {
      matches.push(category);
    }
  }
  return matches.length > 0 ? matches : ['general'];
}

/**
 * Check if a message matches a specific topic category.
 */
export function matchesTopic(message: string, category: TopicCategory): boolean {
  const entry = TOPIC_PATTERNS.find(p => p.category === category);
  return entry ? entry.pattern.test(message) : false;
}

/**
 * Get the primary (first matching) topic for a message.
 */
export function getPrimaryTopic(message: string): TopicCategory {
  for (const { category, pattern } of TOPIC_PATTERNS) {
    if (pattern.test(message)) return category;
  }
  return 'general';
}
