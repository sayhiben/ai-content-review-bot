import { readLimited, wordCount } from "./input";
import { AiCheckError, AiDetectionProvider, DetectionResult, DetectionSegment, Fetch, LIMITS, ScanRejected } from "./types";

const BASE_URL = "https://api.gptzero.me";
const malformed = () => new AiCheckError("response", "GPTZero returned an invalid analysis. No replacement scan was submitted.");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const probability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** Preserve the vendor's probabilities and highlights without inventing text fractions. */
export function normalizeGPTZero(value: unknown, submittedText: string, modelVersion: string): DetectionResult {
  if (!record(value) || !Array.isArray(value.documents) || value.documents.length !== 1) throw malformed();
  const doc = value.documents[0];
  if (!record(doc) || !["ai", "mixed", "human"].includes(String(doc.predicted_class))) throw malformed();
  const scores = doc.class_probabilities;
  if (!record(scores) || !probability(scores.ai) || !probability(scores.mixed) || !probability(scores.human) ||
    Math.abs(scores.ai + scores.mixed + scores.human - 1) > 0.001) throw malformed();
  const analyzedText = doc.inputText === undefined ? submittedText : doc.inputText;
  if (typeof analyzedText !== "string" || !analyzedText.trim() || Buffer.byteLength(analyzedText) > LIMITS.bytes) throw malformed();
  if (doc.sentences !== undefined && !Array.isArray(doc.sentences)) throw malformed();
  const sentences = (doc.sentences ?? []) as unknown[];
  let cursor = 0, aligned = true;
  const segments: DetectionSegment[] = sentences.map(sentence => {
    if (!record(sentence) || typeof sentence.sentence !== "string" || !sentence.sentence.trim() ||
      (sentence.generated_prob !== undefined && !probability(sentence.generated_prob)) ||
      (sentence.highlight_sentence_for_ai !== undefined && typeof sentence.highlight_sentence_for_ai !== "boolean") ||
      (sentence.should_mask !== undefined && typeof sentence.should_mask !== "boolean")) throw malformed();
    // Sentences are ordered. Only exact reconstruction with whitespace gaps gives
    // verified positions; searching ahead could select the wrong repeated sentence.
    while (cursor < analyzedText.length && /\s/u.test(analyzedText[cursor])) cursor++;
    const start = cursor;
    if (!analyzedText.startsWith(sentence.sentence, cursor)) aligned = false;
    cursor += sentence.sentence.length;
    const masked = sentence.should_mask === true;
    const highlighted = !masked && sentence.highlight_sentence_for_ai === true;
    return {
      text: sentence.sentence, category: highlighted ? "ai" : "unknown",
      label: masked ? "Excluded from AI scoring" : highlighted ? "Flagged as AI by GPTZero" : "Not highlighted as AI (not a human classification)",
      confidence: !masked && probability(sentence.generated_prob) ? `AI probability ${(sentence.generated_prob * 100).toFixed(1)}%` : undefined,
      range: { start, end: cursor },
    };
  });
  if (!aligned || analyzedText.slice(cursor).trim()) for (const segment of segments) segment.range = undefined;
  const classification = { ai: "Likely AI", mixed: "Likely mixed", human: "Likely human" }[doc.predicted_class as "ai" | "mixed" | "human"];
  const confidence = typeof doc.confidence_category === "string" ? doc.confidence_category : "unavailable";
  return {
    provider: "GPTZero", model: modelVersion,
    version: typeof doc.version === "string" ? doc.version : typeof value.version === "string" ? value.version : undefined,
    analyzedText, headline: confidence === "reject" ? "Uncertain classification" : `${classification} · ${confidence} confidence`,
    explanation: [
      typeof doc.result_message === "string" ? doc.result_message : "See the document classification probabilities below.",
      typeof doc.result_sub_message === "string" ? doc.result_sub_message : "",
      "Unhighlighted or excluded sentences are not classified as human by this report.",
    ].filter(Boolean).join("\n"),
    documentProbabilities: { ai: scores.ai, mixed: scores.mixed, human: scores.human }, segments,
    billingUrl: "https://app.gptzero.me/app/api",
  };
}

export class GPTZeroProvider implements AiDetectionProvider {
  readonly name = "GPTZero";
  readonly model = "ai-detection";
  // Bot policy for useful moderation reports; not a claim about the API minimum.
  readonly minimumWords = 50;
  readonly maximumCharacters = 150_000;

  constructor(
    private readonly apiKey: string,
    readonly version: string,
    private readonly usdPer1000Words?: number,
    private readonly fetcher: Fetch = globalThis.fetch,
  ) {}

  async analyze(text: string, { signal }: { signal: AbortSignal }): Promise<DetectionResult> {
    let result: DetectionResult;
    try {
      // Never retry a potentially billed submission, including 429/5xx responses.
      const body = await this.request("/v2/predict/text", signal, {
        document: text, modelVersion: this.version,
      });
      result = normalizeGPTZero(body, text, this.version);
    } catch (error) {
      if (error instanceof AiCheckError) throw error;
      throw new AiCheckError("connection", "The GPTZero scan could not be confirmed and may incur a charge. No replacement scan was submitted.");
    }
    const units = wordCount(text);
    result.usage = { estimated: true, units, unit: "words", cost: this.usdPer1000Words === undefined ? undefined : { amount: units / 1000 * this.usdPer1000Words, currency: "USD" } };
    // Budget lookup is best effort. A missing balance must not discard a paid result.
    try {
      const usage = await this.request("/v3/usage-stats", signal);
      if (record(usage) && record(usage.data) && typeof usage.data.words_left === "number" &&
        Number.isFinite(usage.data.words_left) && usage.data.words_left >= 0) {
        result.balance = { amount: usage.data.words_left, unit: "words in current billing cycle", observedAt: Date.now() };
      }
    } catch { /* Unavailable/null quota is never interpreted as zero remaining. */ }
    return result;
  }

  private async request(path: string, signal: AbortSignal, payload?: object): Promise<unknown> {
    const response = await this.fetcher(`${BASE_URL}${path}`, {
      method: payload ? "POST" : "GET", redirect: "error",
      headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(payload ? LIMITS.analysisMs : 10_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const reason = response.status === 401 || response.status === 403 ? "Check the API credentials and plan." :
        response.status === 429 ? "The provider's rate or word quota was reached." :
        response.status === 400 ? "The text or configured model was rejected." : "The provider could not complete the request.";
      const ErrorType = payload && [400, 401, 403, 429].includes(response.status) ? ScanRejected : AiCheckError;
      throw new ErrorType(`http_${response.status}`, `GPTZero: ${reason}`);
    }
    const bytes = await readLimited(response, payload ? 4 * 1024 * 1024 : 64 * 1024);
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw malformed(); }
  }
}
