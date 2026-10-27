import { createCanvas } from "canvas";
import { ReportSession } from "./AiCheckService";
import { DetectionResult, SegmentCategory } from "./types";
import { wordCount } from "./input";

export const CATEGORY_NAMES: Record<SegmentCategory, string> = {
  ai: "AI-generated", assisted: "AI-assisted", human: "Human", unknown: "Unknown",
};
const COLORS: Record<SegmentCategory, string> = { ai: "#d35400", assisted: "#916300", human: "#00796b", unknown: "#666666" };
const escape = (text: string) => text.replace(/[\\`*_{}[\]()<>#+.!|~]/g, "\\$&").replace(/@/g, "@\u200b");
const clip = (text: string, length: number) => text.length <= length ? text : text.slice(0, length - 1) + "…";
const percent = (n: number | undefined) => n === undefined ? "Unavailable" : n > 0 && n < 0.001 ? "<0.1%" : `${(n * 100).toFixed(1)}%`;

export function budgetText(result: DetectionResult, cached = false): string {
  const usage = result.usage;
  const cost = usage?.cost;
  const balance = result.balance;
  const costText = cost ? `${cost.amount > 0 && cost.amount < 0.01 ? "<0.01" : cost.amount.toFixed(2)} ${cost.currency}` : "cost unavailable";
  return [
    cached ? "Cached result · no new scan charge" : usage ? `${usage.estimated ? "Estimated" : "Reported"}: ${usage.units} ${usage.unit} · ${costText}` : "Scan cost unavailable",
    balance ? `Balance: ${balance.amount} ${balance.unit} as of ${new Date(balance.observedAt).toISOString()}` : "Remaining balance unavailable",
  ].join("\n");
}

function documentProbabilityText(p: NonNullable<DetectionResult["documentProbabilities"]>): string {
  return `AI: ${percent(p.ai)} · Mixed: ${percent(p.mixed)} · Human: ${percent(p.human)}\nProbabilities, not text percentages.`;
}

export function summaryEmbed(session: ReportSession) {
  const r = session.result!;
  return {
    title: clip(escape(`${r.provider}: ${r.headline}`), 240),
    description: clip(escape(`${wordCount(r.analyzedText)} words · ${r.model}${r.version ? ` · ${r.version}` : ""}`), 1_000),
    color: 0x00796b,
    fields: [
      ...(r.textFractions ? [{ name: "Text classified as", value: `AI: **${percent(r.textFractions.ai)}** · Assisted: **${percent(r.textFractions.assisted)}** · Human: **${percent(r.textFractions.human)}**` }] : []),
      ...(r.documentProbabilities ? [{ name: "Document probabilities", value: documentProbabilityText(r.documentProbabilities) }] : []),
      ...(!r.textFractions && !r.documentProbabilities ? [{ name: "Score", value: "Unavailable" }] : []),
      { name: "API budget", value: clip(escape(budgetText(r, session.cached)), 1_000) },
      ...(!r.segments.length ? [{ name: "Segments", value: "No segment details returned." }] :
        r.segments.some(s => !s.range) || session.hasChart === false ? [{ name: "Segments", value: "Chart unavailable. See the attached text report." }] : []),
    ],
    timestamp: new Date(session.scannedAt!).toISOString(),
    footer: { text: "AI detection is an estimate. Review the text before acting." },
  };
}

export function segmentPages(result: DetectionResult): string[] {
  const pages: string[] = [];
  result.segments.forEach((segment, index) => {
    const heading = `**${index + 1}/${result.segments.length} · ${clip(escape(segment.label), 200)}**${segment.confidence ? ` · Confidence: ${clip(escape(segment.confidence), 100)}` : ""}`;
    // Escape BEFORE sizing; escaping may double a payload's length. Iterate by code point.
    let page = "";
    const parts: string[] = [];
    for (const character of segment.text) {
      const escaped = escape(character);
      if (page.length + escaped.length > 3_200) { parts.push(page); page = ""; }
      page += escaped;
    }
    parts.push(page || "(Empty segment)");
    parts.forEach((part, p) => pages.push(`${heading}${parts.length > 1 ? ` · Part ${p + 1}/${parts.length}` : ""}\n\n${part}`));
  });
  return pages.length ? pages : ["No segment details returned."];
}

export function fullReport(session: ReportSession): Buffer {
  const r = session.result!;
  const parts = [
    `${r.provider} · ${r.model}${r.version ? ` · ${r.version}` : ""}`,
    new Date(session.scannedAt!).toISOString(), r.headline, r.explanation,
    ...(r.textFractions ? [`AI: ${percent(r.textFractions.ai)}; Assisted: ${percent(r.textFractions.assisted)}; Human: ${percent(r.textFractions.human)}`] : []),
    ...(r.documentProbabilities ? [documentProbabilityText(r.documentProbabilities)] : []),
    budgetText(r, session.cached), "AI detection is an estimate.", "", "SUBMITTED TEXT", session.submittedText!,
  ];
  if (r.analyzedText !== session.submittedText) parts.push("", "ANALYZED TEXT", r.analyzedText);
  parts.push("", "SEGMENTS");
  for (const [index, s] of r.segments.entries()) {
    parts.push("", `${index + 1}. ${s.label}${s.confidence ? ` · Confidence: ${s.confidence}` : ""}`, s.text);
  }
  if (!r.segments.length) parts.push("Segment details unavailable.");
  return Buffer.from(parts.join("\n"), "utf8");
}

/** Fixed-size chart: overlap appears in category lanes; gaps are not inferred to be human. */
export function segmentChart(result: DetectionResult): Buffer | undefined {
  if (!result.segments.length || result.segments.some(s => !s.range)) return undefined;
  const categories: SegmentCategory[] = ["human", "assisted", "ai"];
  if (result.segments.some(s => s.category === "unknown")) categories.push("unknown");
  const width = 1000, height = 170 + 60 * categories.length, left = 180, right = 950;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#15202b"; ctx.font = "bold 24px sans-serif";
  ctx.fillText("Classifications across the analyzed text", 30, 38);
  categories.forEach((category, row) => {
    const y = 70 + row * 60;
    ctx.fillStyle = "#15202b"; ctx.font = "18px sans-serif";
    ctx.fillText(CATEGORY_NAMES[category], 25, y + 25);
    ctx.fillStyle = "#eeeeee"; ctx.fillRect(left, y, right - left, 36);
    for (const s of result.segments.filter(s => s.category === category)) {
      const start = left + s.range!.start / result.analyzedText.length * (right - left);
      const end = left + s.range!.end / result.analyzedText.length * (right - left);
      ctx.fillStyle = COLORS[category]; ctx.fillRect(start, y, Math.max(1, end - start), 36);
    }
  });
  ctx.fillStyle = "#15202b"; ctx.font = "17px sans-serif";
  ctx.fillText("0%", left, height - 52); ctx.fillText("100%", right - 42, height - 52);
  ctx.fillText("Relative position in analyzed text · blank areas are unclassified in that row", 180, height - 22);
  return canvas.toBuffer("image/png");
}

export function reportFiles(session: ReportSession, chart: typeof segmentChart = segmentChart) {
  const files: { attachment: Buffer; name: string; description?: string }[] = [
    { attachment: fullReport(session), name: "ai-report.txt" },
  ];
  try {
    const image = chart(session.result!);
    if (image) files.push({ attachment: image, name: "ai-segments.png", description: "Segment classifications by relative text position. Full labels and text are in ai-report.txt." });
  } catch { /* Deliver the complete text report even if native canvas fails. */ }
  return files;
}
