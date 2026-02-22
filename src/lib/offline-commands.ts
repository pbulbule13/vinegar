/**
 * Offline Command Handler for Vinegar
 * Handles simple queries without LLM to save tokens and reduce latency.
 * Returns null if the query needs LLM processing.
 *
 * Target: intercept 30-40% of common household queries offline.
 */

import type { SupportedLanguage } from "@/types/language";

export interface OfflineResult {
  response: string;
  shouldSpeak: boolean;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

// ─── Pattern Matchers ───

const GREETINGS = [
  'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
  'good night', 'howdy', 'sup', "what's up", 'yo', 'hola', 'namaste',
  'greetings', 'heya', 'hiya', 'what up', 'whats up', "what's good",
  // Hindi/Marathi greetings
  'namaskar', 'namaskaar', 'kaise ho', 'kasa aahes', 'kashi aahat',
];

const THANKS = ['thank you', 'thanks', 'thx', 'appreciate it', 'cheers', 'thank u', 'tysm', 'ty',
  'dhanyavad', 'shukriya', 'dhanyavaad', 'aabhar', 'aabhaar'];

const GOODBYES = [
  'bye', 'goodbye', 'see you', 'see ya', 'later', 'good night',
  'gotta go', 'talk later', 'catch you later', 'peace', 'signing off',
  'i\'m done', 'that\'s all', 'nothing else', 'no more questions',
  'alvida', 'phir milenge', 'chalo', 'bhet u', 'yetoye',
];

const ACKNOWLEDGMENTS = [
  'ok', 'okay', 'got it', 'alright', 'sure', 'cool', 'nice', 'great',
  'perfect', 'sounds good', 'understood', 'right', 'yep', 'yup', 'yes',
  'no', 'nope', 'nah', 'not really', 'never mind', 'nevermind', 'nvm',
  'fine', 'k', 'kk', 'roger', 'copy that', 'noted',
];

const IDENTITY = [
  'who are you', 'what are you', "what's your name", 'your name',
  'what can you do', 'what do you do', 'tell me about yourself',
  'introduce yourself', 'are you a robot', 'are you ai', 'are you human',
];

const HELP_QUERIES = [
  'help', 'help me', 'what can you help with', 'what are your features',
  'show me what you can do', 'capabilities', 'features', 'commands',
  'how do i use you', 'how does this work', 'what should i say',
];

const HOW_ARE_YOU = [
  'how are you', "how's it going", 'how do you feel', 'are you okay',
  "how're you", 'how you doing', "what's happening", 'how goes it',
  "how's everything", 'you good',
];

// ─── Response Banks ───

const GREETING_RESPONSES = [
  () => `Good ${getTimeOfDay()}! How can I help you?`,
  () => "Hey there! What can I do for you?",
  () => "Hello! I'm here and ready to help.",
  () => "Hey! What's on your mind?",
  () => `Good ${getTimeOfDay()}! Need anything?`,
];

const THANKS_RESPONSES = [
  "You're welcome!",
  "Happy to help!",
  "Anytime!",
  "No problem at all!",
  "Glad I could help!",
];

const GOODBYE_RESPONSES = [
  "Goodbye! I'll be here whenever you need me.",
  "See you later! Have a great rest of your day.",
  "Take care! Just say hi when you need me again.",
  "Bye! I'll be right here if you need anything.",
];

const ACKNOWLEDGMENT_RESPONSES = [
  "Anything else I can help with?",
  "Let me know if you need anything else.",
  "I'm here if you need more help!",
];

const IDENTITY_RESPONSE = "I'm Vinegar, your home assistant! I can help manage your family calendar, grocery list, tasks, reminders, chores, meal planning, and more. Just ask!";

const HELP_RESPONSE = `Here's what I can help with:
- Calendar: "What's on my schedule today?"
- Grocery list: "Add milk to the grocery list"
- Tasks: "Create a task to fix the fence"
- Reminders: "Remind me to call Mom in 30 minutes"
- Meal planning: "Plan dinner for tonight"
- Chores: "Assign dishes to Sarah"
- Activities: "Add soccer practice on Tuesdays"
- Memory: "Remember that Dad likes decaf"
- General questions: Ask me anything!

Just speak naturally - I'll understand what you need.`;

const HOW_ARE_YOU_RESPONSES = [
  "I'm running great! Ready to help with whatever you need.",
  "Doing well, thanks for asking! What can I do for you?",
  "All systems go! How can I help?",
  "I'm good! What do you need?",
];

// ─── Localized Response Banks ───

const GREETING_RESPONSES_HI = [
  () => "नमस्ते! मैं कैसे मदद कर सकता हूँ?",
  () => "हैलो! बताइए क्या करना है?",
  () => "नमस्ते! मैं यहाँ हूँ, बोलिए।",
];

const GREETING_RESPONSES_MR = [
  () => "नमस्कार! मी कशी मदत करू शकतो?",
  () => "हॅलो! सांगा काय करायचं?",
  () => "नमस्कार! मी इथे आहे, बोला.",
];

const THANKS_RESPONSES_HI = ["कोई बात नहीं!", "खुशी हुई मदद करके!", "कभी भी!"];
const THANKS_RESPONSES_MR = ["काही हरकत नाही!", "मदत करून आनंद झाला!", "कधीही!"];

const GOODBYE_RESPONSES_HI = ["अलविदा! जब ज़रूरत हो तो बुलाइए।", "फिर मिलते हैं! ध्यान रखिए।"];
const GOODBYE_RESPONSES_MR = ["बाय! गरज असेल तेव्हा बोलवा.", "पुन्हा भेटू! काळजी घ्या."];

const HOW_ARE_YOU_RESPONSES_HI = ["मैं बढ़िया हूँ! आप बताइए, क्या मदद करूँ?", "सब अच्छा है! बोलिए क्या करना है?"];
const HOW_ARE_YOU_RESPONSES_MR = ["मी छान आहे! सांगा, काय मदत करू?", "सगळं ठीक आहे! बोला काय हवं?"];

const ACKNOWLEDGMENT_RESPONSES_HI = ["और कुछ मदद चाहिए?", "बताइए अगर और कुछ करना है।"];
const ACKNOWLEDGMENT_RESPONSES_MR = ["अजून काही मदत हवी का?", "सांगा अजून काही करायचं असेल तर."];

function getLocalizedGreeting(lang?: SupportedLanguage) {
  if (lang === "hi-IN") return pick(GREETING_RESPONSES_HI)();
  if (lang === "mr-IN") return pick(GREETING_RESPONSES_MR)();
  return pick(GREETING_RESPONSES)();
}

function getLocalizedThanks(lang?: SupportedLanguage) {
  if (lang === "hi-IN") return pick(THANKS_RESPONSES_HI);
  if (lang === "mr-IN") return pick(THANKS_RESPONSES_MR);
  return pick(THANKS_RESPONSES);
}

function getLocalizedGoodbye(lang?: SupportedLanguage) {
  if (lang === "hi-IN") return pick(GOODBYE_RESPONSES_HI);
  if (lang === "mr-IN") return pick(GOODBYE_RESPONSES_MR);
  return pick(GOODBYE_RESPONSES);
}

function getLocalizedHowAreYou(lang?: SupportedLanguage) {
  if (lang === "hi-IN") return pick(HOW_ARE_YOU_RESPONSES_HI);
  if (lang === "mr-IN") return pick(HOW_ARE_YOU_RESPONSES_MR);
  return pick(HOW_ARE_YOU_RESPONSES);
}

function getLocalizedAcknowledgment(lang?: SupportedLanguage) {
  if (lang === "hi-IN") return pick(ACKNOWLEDGMENT_RESPONSES_HI);
  if (lang === "mr-IN") return pick(ACKNOWLEDGMENT_RESPONSES_MR);
  return pick(ACKNOWLEDGMENT_RESPONSES);
}

// ─── Main Handler ───

export function tryOfflineResponse(input: string, language?: SupportedLanguage): OfflineResult | null {
  const lower = input.toLowerCase().trim();

  // Very short or empty
  if (!lower || lower.length < 1) return null;

  // ── Greetings ──
  if (GREETINGS.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + ',') || lower.startsWith(g + '!'))) {
    return { response: getLocalizedGreeting(language), shouldSpeak: true };
  }

  // ── Thanks ──
  if (THANKS.some(t => lower === t || lower.startsWith(t + ' ') || lower.startsWith(t + ','))) {
    return { response: getLocalizedThanks(language), shouldSpeak: true };
  }

  // ── Goodbyes ──
  if (GOODBYES.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + ','))) {
    return { response: getLocalizedGoodbye(language), shouldSpeak: true };
  }

  // ── Acknowledgments ──
  if (ACKNOWLEDGMENTS.includes(lower)) {
    return { response: getLocalizedAcknowledgment(language), shouldSpeak: true };
  }

  // ── How are you ──
  if (HOW_ARE_YOU.some(q => lower === q || lower.startsWith(q))) {
    return { response: getLocalizedHowAreYou(language), shouldSpeak: true };
  }

  // ── Identity / About ──
  if (IDENTITY.some(q => lower.includes(q))) {
    return { response: IDENTITY_RESPONSE, shouldSpeak: true };
  }

  // ── Help ──
  if (HELP_QUERIES.some(q => lower === q || lower.startsWith(q + ' '))) {
    return { response: HELP_RESPONSE, shouldSpeak: true };
  }

  // ── Time ──
  if (/^(what('s| is) the time|what time is it|time( now)?\??|tell me the time|current time|time now|time please|kitna baja hai|kitne baje hain|vela kay aahe)$/i.test(lower)) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { response: `It's ${time}.`, shouldSpeak: true };
  }

  // ── Date ──
  if (/^(what('s| is) (the |today'?s? )?date|date\??|today'?s? date|what is today|what day is today)$/i.test(lower)) {
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    return { response: `Today is ${date}.`, shouldSpeak: true };
  }

  // ── Day of week ──
  if (/^(what day (is it|of the week)|what('s| is) the day)$/i.test(lower)) {
    const day = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    return { response: `Today is ${day}.`, shouldSpeak: true };
  }

  // ── Year / Month ──
  if (/^(what year is it|what('s| is) the year|current year)$/i.test(lower)) {
    return { response: `It's ${new Date().getFullYear()}.`, shouldSpeak: true };
  }
  if (/^(what month is it|what('s| is) the month|current month)$/i.test(lower)) {
    const month = new Date().toLocaleDateString('en-US', { month: 'long' });
    return { response: `It's ${month}.`, shouldSpeak: true };
  }

  // ── Basic math ──
  const mathMatch = lower.match(/^(?:what(?:'s| is)\s+)?(\d+(?:\.\d+)?)\s*([+\-*/x×÷])\s*(\d+(?:\.\d+)?)\s*\??$/);
  if (mathMatch) {
    const a = parseFloat(mathMatch[1]);
    const op = mathMatch[2];
    const b = parseFloat(mathMatch[3]);
    let result: number;
    switch (op) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case '*': case 'x': case '×': result = a * b; break;
      case '/': case '÷': result = b !== 0 ? a / b : NaN; break;
      default: return null;
    }
    if (isNaN(result)) return { response: "Can't divide by zero!", shouldSpeak: true };
    const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(2);
    return { response: `${a} ${op} ${b} = ${formatted}`, shouldSpeak: true };
  }

  // ── Spoken math: "what is X plus/minus/times/divided by Y" ──
  const spokenMath = lower.match(/^(?:what(?:'s| is)\s+)?(\d+(?:\.\d+)?)\s+(plus|minus|times|multiplied by|divided by|over)\s+(\d+(?:\.\d+)?)\s*\??$/);
  if (spokenMath) {
    const a = parseFloat(spokenMath[1]);
    const opWord = spokenMath[2];
    const b = parseFloat(spokenMath[3]);
    let result: number;
    switch (opWord) {
      case 'plus': result = a + b; break;
      case 'minus': result = a - b; break;
      case 'times': case 'multiplied by': result = a * b; break;
      case 'divided by': case 'over': result = b !== 0 ? a / b : NaN; break;
      default: return null;
    }
    if (isNaN(result)) return { response: "Can't divide by zero!", shouldSpeak: true };
    const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(2);
    return { response: `${a} ${opWord} ${b} equals ${formatted}`, shouldSpeak: true };
  }

  // ── Timer / Countdown (just acknowledge, actual timer is server-side) ──
  // These get routed to LLM for set_reminder tool - don't intercept

  // ── Random number ──
  if (/^(random number|give me a (random )?number|pick a number|roll a? ?di[ce]e?)$/i.test(lower)) {
    const num = Math.floor(Math.random() * 100) + 1;
    return { response: `${num}!`, shouldSpeak: true };
  }

  // ── Coin flip ──
  if (/^(flip a coin|coin flip|heads or tails|toss a coin)$/i.test(lower)) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return { response: `${result}!`, shouldSpeak: true };
  }

  // ── Jokes ──
  if (/^(tell me a joke|joke|say something funny|make me laugh)$/i.test(lower)) {
    const jokes = [
      "Why did the scarecrow win an award? He was outstanding in his field!",
      "I told my wife she should embrace her mistakes. She gave me a hug.",
      "Why don't scientists trust atoms? Because they make up everything!",
      "What do you call a fake noodle? An impasta!",
      "Why did the bicycle fall over? Because it was two-tired!",
      "What do you call cheese that isn't yours? Nacho cheese!",
      "Why don't eggs tell jokes? They'd crack each other up!",
      "I'm reading a book about anti-gravity. It's impossible to put down!",
    ];
    return { response: pick(jokes), shouldSpeak: true };
  }

  // ── Compliments / Positive ──
  if (/^(you('re| are) (great|awesome|amazing|the best|cool|helpful)|i love you|good job|well done|nice work)$/i.test(lower)) {
    const responses = [
      "Thank you! That means a lot. Happy to help!",
      "Aw, thanks! I try my best.",
      "You're pretty great yourself!",
      "That's so kind! Let me know if you need anything.",
    ];
    return { response: pick(responses), shouldSpeak: true };
  }

  // ── "Stop" / "Be quiet" / "Shut up" ──
  if (/^(stop|shut up|be quiet|silence|quiet|hush|shh|shhh|mute)$/i.test(lower)) {
    return { response: "Okay, I'll be quiet. Just let me know when you need me.", shouldSpeak: true };
  }

  // ── "Say that again" / "Repeat" ──
  if (/^(repeat|say (that|it) again|what did you say|come again|pardon|excuse me)$/i.test(lower)) {
    return { response: "I'm sorry, I don't remember what I just said. Could you ask your question again?", shouldSpeak: true };
  }

  // ── "Test" / "Are you there" / "Ping" ──
  if (/^(test|testing|are you there|ping|can you hear me|hello\??|is this working|you there)$/i.test(lower)) {
    return { response: "I'm here! What do you need?", shouldSpeak: true };
  }

  // Weather queries now handled by get_weather tool via LLM - don't intercept

  // ── Not handled offline ──
  return null;
}
