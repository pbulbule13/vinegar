/**
 * Zod Validators for all API routes
 */

import { z } from 'zod';

// ─── Tool Routes ───

export const saveMemorySchema = z.object({
  topic: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
  type: z.enum(['fact', 'preference', 'routine', 'decision', 'person', 'conversation']).default('fact'),
  importance: z.enum(['low', 'medium', 'high']).default('medium'),
  tags: z.array(z.string()).optional(),
});

export const recallMemorySchema = z.object({
  query: z.string().max(500).optional(),
  type: z.enum(['fact', 'preference', 'routine', 'decision', 'person', 'conversation']).optional(),
});

export const manageTaskSchema = z.object({
  action: z.enum(['create', 'update', 'list']).default('list'),
  title: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  due_date: z.string().optional(),
  category: z.string().max(100).optional(),
});

// ─── Chat Route ───

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(50000),
});

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(50),
  model: z.string().max(100).optional(),
  language: z.string().max(10).optional(), // "en-US" | "hi-IN" | "mr-IN" etc.
  visualContext: z.string().max(200).optional(), // Current visual panel state, e.g. "weather card for Fremont"
});

// ─── Family Routes ───

export const familyMemberSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['parent', 'child']),
  age: z.number().int().min(0).max(150).optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pin: z.string().length(4).regex(/^\d{4}$/).optional(),
  dietary_restrictions: z.array(z.string()).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

// ─── Calendar Routes ───

export const calendarEventSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  start_time: z.number().int(),
  end_time: z.number().int(),
  all_day: z.boolean().default(false),
  location: z.string().max(500).optional(),
  family_member_id: z.string().optional(),
  reminder_minutes: z.number().int().min(0).max(10080).optional(),
  recurring: z.string().max(500).optional(),
});

export const calendarQuerySchema = z.object({
  start: z.number().int().optional(),
  end: z.number().int().optional(),
  family_member_id: z.string().optional(),
});

// ─── Reminder Routes ───

export const reminderSchema = z.object({
  type: z.enum(['one_time', 'daily', 'weekly', 'custom']),
  message: z.string().min(1).max(1000),
  cron_expression: z.string().max(100).optional(),
  next_fire_time: z.number().int().optional(),
  target_member_id: z.string().optional(),
  source_type: z.enum(['calendar', 'task', 'manual', 'alarm', 'skill']).optional(),
  source_id: z.string().optional(),
});

// ─── Grocery Routes ───

export const groceryItemSchema = z.object({
  item: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(999).default(1),
  unit: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
});

export const groceryActionSchema = z.object({
  action: z.enum(['add', 'complete', 'remove', 'list', 'clear_completed']),
  item: z.string().max(200).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  unit: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  id: z.string().optional(),
});

// ─── Meal Plan Routes ───

export const mealPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  recipe: z.string().min(1).max(500),
  ingredients: z.array(z.string()).optional(),
  notes: z.string().max(1000).optional(),
});

// ─── Skills Routes ───

export const skillSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  type: z.enum(['web_scraper', 'api_caller', 'scheduled', 'data_lookup', 'composite']),
  trigger_phrases: z.array(z.string().min(1)).min(1).max(20),
  config: z.record(z.string(), z.unknown()),
  schedule: z.string().max(100).optional(),
});

// ─── Usage Route ───

export const usageLogSchema = z.object({
  model: z.string().min(1).max(100),
  usage: z.object({
    input_token_details: z.object({
      audio_tokens: z.number().optional(),
      text_tokens: z.number().optional(),
    }).optional(),
    output_token_details: z.object({
      audio_tokens: z.number().optional(),
      text_tokens: z.number().optional(),
    }).optional(),
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).optional(),
});

// ─── Activity Routes ───

export const activitySchema = z.object({
  title: z.string().min(1).max(300),
  family_member_id: z.string(),
  day_of_week: z.array(z.number().int().min(0).max(6)).min(1),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

// ─── Update Schemas (for PUT routes) ───

export const familyMemberUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  age: z.number().int().min(0).max(150).optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dietary_restrictions: z.array(z.string()).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export const calendarEventUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  start_time: z.number().int().optional(),
  end_time: z.number().int().optional(),
  location: z.string().max(500).optional(),
});

// ─── Chore Routes ───

export const choreSchema = z.object({
  action: z.enum(['create', 'complete', 'list', 'approve']),
  title: z.string().max(300).optional(),
  assigned_to: z.string().optional(),
  points: z.number().int().min(0).max(100).optional(),
  recurring: z.string().max(100).optional(),
  id: z.string().optional(),
});

// ─── Image Search Routes ───

export const imageSearchSchema = z.object({
  query: z.string().min(1).max(200),
  child_safe: z.boolean().default(false),
});

export const imageProxySchema = z.object({
  url: z.string().min(1).max(2000).url(),
});
