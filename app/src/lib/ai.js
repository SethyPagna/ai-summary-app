// ─── OpenRouter Configuration ───────────────────────────────────────────────
const OR_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Read from Vite environment variable
const OR_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY;

if (!OR_API_KEY) {
  throw new Error(
    'Missing OpenRouter API key. Set VITE_OPENROUTER_API_KEY in your .env file.'
  );
}

export const MODELS = [
  {
    id: 'stepfun/step-3.5-flash:free',
    label: 'Step 3.5 Flash',
    provider: 'StepFun',
    badge: '⚡',
    description: 'Fast responses, great for quick Q&A',
  },
  {
    id: 'arcee-ai/trinity-large-preview:free',
    label: 'Trinity Large',
    provider: 'Arcee AI',
    badge: '🔬',
    description: 'Larger model, deeper analysis',
  },
  {
    id: 'z-ai/glm-4.5-air:free',
    label: 'GLM 4.5 Air',
    provider: 'Z.ai',
    badge: '🌬️',
    description: 'Advanced communications and text generation.',
  },
  {
    id: 'deepseek/deepseek-r1-0528:free',
    label: 'DeepSeek R1 0528',
    provider: 'DeepSeek',
    badge: '🔍',
    description: 'Focuses on deep analysis and insights extraction.',
  },
  {
    id: 'openai/gpt-oss-120b:free',
    label: 'OpenAI GPT-OSS 120B',
    provider: 'OpenAI',
    badge: '🤖',
    description: 'Model based on 120 billion parameters for versatile tasks.',
  },
  {
    id: 'qwen/qwen3-coder:free',
    label: 'Qwen3 Coder 480B A35B',
    provider: 'Qwen',
    badge: '💻',
    description: 'Large model for programming and code-related tasks.',
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

// ─── Core fetch wrapper ──────────────────────────────────────────────────────
async function callOpenRouter(messages, systemPrompt, modelId) {
  const model = modelId || DEFAULT_MODEL;

  const body = {
    model,
    max_tokens: 1500,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages,
    ],
  };

  const response = await fetch(OR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OR_API_KEY}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'AI Summary App',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      err?.error?.message ||
        `OpenRouter error ${response.status}: ${response.statusText}`
    );
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';

  if (!text) throw new Error('Empty response from model.');
  return text;
}

// ─── Document Summarization ──────────────────────────────────────────────────
export async function summarizeDocument(content, modelId) {
  return callOpenRouter(
    [
      {
        role: 'user',
        content: `Please provide a comprehensive summary of the following document.

Use clear headings (##), bullet points, and highlight key insights. Be thorough but concise.

---
${content}
---`,
      },
    ],
    'You are an expert document analyst. Produce structured, insightful summaries.',
    modelId
  );
}

// ─── Document Chat ───────────────────────────────────────────────────────────
export async function chatWithDocuments(messages, documentsContext, modelId) {
  const systemPrompt = `You are an intelligent document assistant with access to the following documents. Answer questions accurately, cite relevant parts when useful, and be concise yet thorough.

Documents:
${documentsContext}`;

  const openRouterMsgs = messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));

  return callOpenRouter(openRouterMsgs, systemPrompt, modelId);
}

// ─── Follow-up Suggestion Generator ─────────────────────────────────────────
export async function generateFollowUps(lastQuestion, lastAnswer, modelId) {
  const prompt = `Based on this Q&A exchange, generate exactly 3 short, natural follow-up questions a user might want to ask next. Return ONLY a JSON array of 3 strings, no extra text, no markdown fences.

Question: ${lastQuestion}
Answer: ${lastAnswer.slice(0, 600)}

Return format: ["question 1", "question 2", "question 3"]`;

  try {
    const raw = await callOpenRouter(
      [{ role: 'user', content: prompt }],
      'You generate follow-up questions. Return only valid JSON arrays.',
      modelId
    );

    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.slice(0, 3);
  } catch {
    // non-critical
  }

  return [];
}

// ─── Starter Suggestions ────────────────────────────────────────────────────
export const STARTER_SUGGESTIONS = [
  'What are the main topics covered?',
  'Summarize the key findings.',
  'What are the most important conclusions?',
  'List all dates and deadlines mentioned.',
  'What action items are recommended?',
  'Who are the key people or organizations?',
  'What data or statistics are referenced?',
  'What problems or challenges are discussed?',
];