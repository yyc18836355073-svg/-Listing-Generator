/**
 * SiliconFlow 前端直连客户端
 * 纯前端方案：密钥由用户自填并仅存于本地 localStorage，不上传任何服务器。
 * 替代原 api/generate.js 的 serverless 代理层（GitHub Pages / Vercel 均不执行 serverless 源码）。
 */

export const SILICONFLOW_ENDPOINT = "https://api.siliconflow.cn/v1/chat/completions";
export const SILICONFLOW_MODEL = "Qwen/Qwen2.5-72B-Instruct";

/** 从 localStorage 读取用户自填的 API Key */
export function getApiKey(): string {
  try {
    return localStorage.getItem("sicflow_api_key") || "";
  } catch {
    return "";
  }
}

/** 把 API Key 写入 localStorage（仅本地，不上传） */
export function setApiKey(key: string): void {
  try {
    localStorage.setItem("sicflow_api_key", key.trim());
  } catch {
    /* storage 不可用（如隐私模式）时静默失败 */
  }
}

/** 本地有 key 且非占位符 */
export function hasApiKey(): boolean {
  const k = getApiKey();
  return k.length > 5 && !/sk-your-key/i.test(k);
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type RequestOptions = {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  timeoutMs?: number;
};

/**
 * 直连 SiliconFlow 单次对话。
 * @returns 文本内容；超时报 AbortError 风格错误（name === "AbortError"）
 */
export async function chat(
  apiKey: string,
  messages: ChatMessage[],
  opts: RequestOptions = {},
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("未配置 API 密钥：请在页面上方粘贴你的硅基流动 API Key");
  }
  const {
    temperature = 0.7,
    maxTokens = 2000,
    topP = 0.9,
    timeoutMs = 45000,
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(SILICONFLOW_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: SILICONFLOW_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`SiliconFlow HTTP ${resp.status}: ${errText.slice(0, 300)}`);
    }
    const data = await resp.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("SiliconFlow 返回为空");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/* ==================== Platform prompts（原 serverless 逻辑迁移） ==================== */

export type Platform = "amazon-en" | "amazon-de" | "tiktok-en";

const PLATFORM_LABEL: Record<Platform, { label: string; lang: string }> = {
  "amazon-en": { label: "Amazon-英文", lang: "英文（Amazon.com）" },
  "amazon-de": { label: "Amazon-德文", lang: "德文（Amazon.de）" },
  "tiktok-en": { label: "TikTok-英文", lang: "英文（TikTok Shop）" },
};

export function normalizeSellingPoints(sp: string): string {
  return sp.trim().replace(/[\/／]/g, "、").replace(/[,，]/g, "、");
}

function buildGenerateSystemPrompt(platform: Platform): string {
  const { label, lang } = PLATFORM_LABEL[platform] || { label: platform, lang: platform };
  return `You are a senior cross-border e-commerce listing specialist for ${label}. Your task is to write a listing based on Product Facts.

<Product_Facts>
{{FACTS}}
</Product_Facts>

Product Facts are the single source of truth. You MUST strictly base your description ONLY on the <Product_Facts>. NEVER invent, infer, or fabricate any technical specifications, numerical values, battery life, wireless versions (e.g., Bluetooth 5.0), materials, or certifications (eco-friendly/anti-bacterial etc.) that are not explicitly listed.

Requirements (Amazon 2026.07.27):
1. Output exactly 1 Title (Item Name) + 1 Item Highlights + 5 Bullet Points. Both Title and Highlights are searchable, do not duplicate keywords between them.
   - Title (Item Name): characterCount <= 75 including spaces. Must front-load Brand + Product Type + 1-2 core keywords within first 60 chars for mobile. Use Title Case (English: "Waterproof Bluetooth Speaker for Outdoor Use"; German: noun capitalization). NOT ALL CAPS. No markdown, no emoji, no special chars ! $ ? _ { } ^ ¬ ¦ ™ ® © € £ ¥, no promotional words (best/guaranteed/on sale/free shipping/premium/high-quality), no keyword stuffing (same word <=2 times), no repeated words, no invented specs. The title you output MUST already be <=75 characters - the validator will reject any title over 75 and trigger regeneration, do not output a truncated title with substring.
   - Item Highlights: characterCount <=125 including spaces. Provide 1 concise line for secondary attributes (material/dimensions/compatibility/use case). No markdown, no emoji, no special chars, no promotional words, no repetition. Must differ from Title.
   - Bullets: Exactly 5. Each bullet must start with ALL CAPS keyword + colon (e.g., "IP67 WATERPROOF DESIGN:"), then FACT + BENEFIT structure. Each bullet 10-255 chars, recommended <=200 for mobile, at least 100 chars. Use sentence fragments with semicolons to separate phrases. Write numbers one to nine in full except model/measurement. Absolutely prohibited words: perfect, amazing, ultimate, reliable and other meaningless adjectives. Absolutely prohibited sentence patterns: Whether you're..., you can trust..., etc. No markdown, no emoji, no special chars ™ ® © € £ ¥, no placeholder N/A/TBD, no guarantee phrases, no external links, no ASINs, no unverified claims (eco-friendly/anti-bacterial/made from bamboo unless explicitly in Product Facts). Use cold, objective, direct pain-point language.
2. Output language must be【${lang}】, translate Chinese facts into idiomatic target language, never copy Chinese verbatim. For German, apply German capitalization rules.
3. Strictly follow plain text format: "【商品标题】" then "【商品亮点】" then "【五点描述】" sections only, no extra explanations or greetings.`;
}

/** 生成完整 Listing */
export async function generateListing(opts: {
  apiKey: string;
  productName: string;
  sellingPoints: string;
  platform: Platform;
  timeoutMs?: number;
}): Promise<string> {
  const normalized = normalizeSellingPoints(opts.sellingPoints);
  const systemPrompt = buildGenerateSystemPrompt(opts.platform)
    .replace("{{FACTS}}", normalized);
  const userPrompt = `产品中文名称：${opts.productName.trim()}\n中文核心卖点：<Product_Facts>${normalized}</Product_Facts>`;
  return chat(
    opts.apiKey,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.7, maxTokens: 2000, topP: 0.9, timeoutMs: opts.timeoutMs ?? 45000 },
  );
}

/** 压缩标题（超时更短，用于二次精修） */
export async function compressTitle(opts: {
  apiKey: string;
  title: string;
  productName: string;
  normalizedPoints: string;
  platform: Platform;
  timeoutMs?: number;
}): Promise<string> {
  const tLimit = opts.platform === "tiktok-en" ? 80 : 75;
  const prompt = `Compress this ${opts.platform === "tiktok-en" ? "TikTok" : "Amazon"} ${opts.platform === "amazon-de" ? "DE" : "US"} title to <=${tLimit} characters including spaces, keep natural ${opts.platform === "amazon-de" ? "German" : "Title Case"}, no ALL CAPS, no markdown, ${opts.platform === "tiktok-en" ? "" : "no emoji,"} no promotional words, front-load brand within 60 chars: "${opts.title}" Product: "${(opts.productName || "").trim()}" Facts: "${opts.normalizedPoints.slice(0, 300)}" Platform: ${opts.platform}. Output ONLY the title.`;
  const raw = await chat(
    opts.apiKey,
    [{ role: "user", content: prompt }],
    { temperature: 0.3, maxTokens: 200, timeoutMs: opts.timeoutMs ?? 30000 },
  );
  return raw.trim().split("\n")[0].replace(/^["“”]+|["“”]+$/g, "").trim();
}

/** 压缩亮点（超时更短） */
export async function compressHighlights(opts: {
  apiKey: string;
  highlights: string;
  title: string;
  normalizedPoints: string;
  timeoutMs?: number;
}): Promise<string> {
  const prompt = `Compress this Amazon Item Highlights to <=125 characters including spaces, keep concise, no promotional words, no repetition with title "${opts.title || ""}": "${opts.highlights}" Facts: "${opts.normalizedPoints.slice(0, 300)}". Output ONLY the highlights line.`;
  const raw = await chat(
    opts.apiKey,
    [{ role: "user", content: prompt }],
    { temperature: 0.3, maxTokens: 200, timeoutMs: opts.timeoutMs ?? 30000 },
  );
  return raw.trim().split("\n")[0].replace(/^["“”]+|["“”]+$/g, "").trim();
}
