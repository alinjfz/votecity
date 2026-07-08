import type { FeasibilityRating, NeedCategory } from "../types";

const openRouterApiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
const configuredModel = import.meta.env.VITE_OPENROUTER_MODEL;
const freeFallbackModel = "tencent/hy3:free";
const openRouterModel =
  !configuredModel || configuredModel === "openrouter/free"
    ? freeFallbackModel
    : configuredModel;

export const isOpenRouterConfigured = Boolean(openRouterApiKey);

interface ReviewInput {
  title: string;
  category: NeedCategory;
  area: string;
  reason: string;
}

interface ReviewResult {
  rating: FeasibilityRating;
  score: number;
  summary: string;
  nextStep: string;
}

export async function reviewNeedWithOpenRouter(
  input: ReviewInput
): Promise<ReviewResult> {
  if (!openRouterApiKey) {
    throw new Error("OpenRouter API key is not configured.");
  }

  return runOpenRouterReview(input, openRouterModel, true);
}

async function runOpenRouterReview(
  input: ReviewInput,
  model: string,
  allowFreeFallback: boolean
): Promise<ReviewResult> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5173",
      "X-OpenRouter-Title": "VoteCity"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You review civic ideas for a UK nonprofit local-priority platform. Assess feasibility for a council or community partner in the next 3-12 months. Be practical, concise, and non-hallucinatory. Return valid JSON only with keys rating, score, summary, nextStep."
        },
        {
          role: "user",
          content: [
            "Review this local need and rate feasibility.",
            'Return JSON only in this exact shape: {"rating":"High|Medium|Low|Not feasible","score":0-100,"summary":"...","nextStep":"..."}',
            `Title: ${input.title}`,
            `Category: ${input.category}`,
            `Area: ${input.area}`,
            `Reason: ${input.reason}`
          ].join("\n")
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();

    if (
      response.status === 402 &&
      allowFreeFallback &&
      model !== freeFallbackModel
    ) {
      return runOpenRouterReview(input, freeFallbackModel, false);
    }

    throw new Error(`OpenRouter review failed: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part: { type?: string; text?: string }) =>
              part.type === "text" ? part.text ?? "" : ""
            )
            .join("")
        : "";
  const parsed = parseJsonObject(text);

  return {
    rating: parsed.rating,
    score: Math.max(0, Math.min(100, Math.round(parsed.score))),
    summary: parsed.summary,
    nextStep: parsed.nextStep
  };
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const direct = tryParseJson(trimmed);

  if (direct) {
    return direct;
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    const extracted = tryParseJson(jsonMatch[0]);

    if (extracted) {
      return extracted;
    }
  }

  throw new Error(`OpenRouter returned non-JSON content: ${trimmed.slice(0, 200)}`);
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text) as {
      rating: FeasibilityRating;
      score: number;
      summary: string;
      nextStep: string;
    };
  } catch {
    return null;
  }
}
