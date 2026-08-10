/**

 * Intent helpers for ContOS general Chat mode.

 */



const PLATFORM_PATTERNS = [

  { id: "linkedin", label: "LinkedIn", re: /\b(linkedin|li\s*posts?)\b/i },

  {

    id: "instagram",

    label: "Instagram",

    re: /\b(instagram|insta|reels?|ig\b)\b/i,

  },

  { id: "playbook", label: "Playbook", re: /\b(playbook|guardrails?|audit\s+this)\b/i },

];



const CONTENT_PLAN_RE =

  /\b(content|posts?|calendar|calend[ae]r|posting\s+plan|schedule|campaign)\b/i;

const TIME_SPAN_RE =

  /\b(month|30\s*days?|4\s*weeks?|weekly|week|7\s*days?|daily|for\s+a\s+month)\b/i;

const ALL_PLATFORMS_RE =

  /\b(all\s+(platforms?|channels?|socials?|accounts?)|every\s+platform|everywhere|all\s+of\s+(them|it)|full\s+stack)\b/i;



export const SPECIALIZED_PLATFORMS = ["linkedin", "instagram"];



export function detectMentionedPlatforms(text) {

  const found = [];

  for (const p of PLATFORM_PATTERNS) {

    if (p.re.test(text)) found.push({ id: p.id, label: p.label });

  }

  return found;

}



export function detectPrimaryPlatform(text) {

  const all = detectMentionedPlatforms(text);

  return all[0] || null;

}



/** Broad content ask with no specific platform → clarify or assume all */

export function isBroadContentRequest(text) {

  if (!text) return false;

  if (detectPrimaryPlatform(text)) return false;

  return CONTENT_PLAN_RE.test(text) && TIME_SPAN_RE.test(text);

}



export function wantsAllPlatforms(text) {

  return ALL_PLATFORMS_RE.test(text || "");

}



export function isAffirmative(text) {

  return /^(yes|yeah|yep|sure|ok|okay|go\s*ahead|do\s*it|all|please|sounds?\s*good)\b/i.test(

    (text || "").trim()

  );

}



export const BROAD_CONTENT_QUICK_ACTIONS = [

  {

    id: "clarify_all",

    label: "Both platforms (LinkedIn + Instagram)",

    platforms: SPECIALIZED_PLATFORMS,

  },

  { id: "linkedin", label: "LinkedIn only", platforms: ["linkedin"] },

  { id: "instagram", label: "Instagram only", platforms: ["instagram"] },

];



export function buildClarificationPrompt(userText) {

  return `${userText}



[SYSTEM ROUTING — ContOS Chat]

The user asked for a content plan without naming a platform.

In your reply:

1) Briefly acknowledge the request (1 sentence).

2) Ask 3 short clarifying questions: which platforms (Instagram / LinkedIn / both), cadence (e.g. 3x/week vs daily), and content mix (Reels vs carousels vs text).

3) Say they can tap a quick action below OR reply with e.g. "both platforms" or "LinkedIn only".

Do NOT generate a full month of posts yet — wait for their answer.

Plain conversational text only. Do not use asterisks (*) or markdown bold/italic.`;

}



export function buildMultiPlatformPrompt(userText, platformId) {

  const labels = {

    linkedin: "LinkedIn",

    instagram: "Instagram",

  };

  return `${userText}



Focus only on ${labels[platformId] || platformId}.

Produce a full structured ${labels[platformId] || platformId} content plan matching the user's timeframe (e.g. month ≈ 30 days or a practical weekly cadence if daily is too dense).

Include transcripts for any video/Reel items.`;

}



/** Remove markdown-style asterisks from agent-facing text. */

export function stripAsterisks(value) {

  if (value == null) return value;

  if (typeof value === "string") return value.replace(/\*/g, "");

  if (Array.isArray(value)) return value.map(stripAsterisks);

  if (typeof value === "object") {

    const out = {};

    for (const [k, v] of Object.entries(value)) {

      out[k] = stripAsterisks(v);

    }

    return out;

  }

  return value;

}


