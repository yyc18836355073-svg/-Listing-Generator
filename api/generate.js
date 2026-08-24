/**
 * Vercel Serverless Function - 模型代理层
 * 读取 process.env.SILICONFLOW_API_KEY，向硅基流动发起真实请求
 * 前端不再接触任何密钥
 */

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed, use POST" });
  }

  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: SILICONFLOW_API_KEY not set in Vercel Environment Variables" });
  }

  let body = req.body;
  // Vercel 有时 body 是字符串
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Invalid JSON body" }); }
  }

  const { action = "generate", productName, sellingPoints, platform, title, highlights, normalizedPoints } = body || {};

  try {
    if (action === "generate") {
      if (!productName || !sellingPoints || !platform) {
        return res.status(400).json({ error: "Missing required fields: productName, sellingPoints, platform" });
      }
      const normalized = (sellingPoints || "").trim().replace(/[\/／]/g, "、").replace(/[,，]/g, "、");
      const platformLabelMap = {
        "amazon-en": "Amazon-英文",
        "amazon-de": "Amazon-德文",
        "tiktok-en": "TikTok-英文",
      };
      const langMap = {
        "amazon-en": "英文（Amazon.com）",
        "amazon-de": "德文（Amazon.de）",
        "tiktok-en": "英文（TikTok Shop）",
      };
      const platformLabel = platformLabelMap[platform] || platform;
      const systemPrompt = `You are a senior cross-border e-commerce listing specialist for ${platformLabel}. Your task is to write a listing based on Product Facts.

<Product_Facts>
${normalized}
</Product_Facts>

Product Facts are the single source of truth. You MUST strictly base your description ONLY on the <Product_Facts>. NEVER invent, infer, or fabricate any technical specifications, numerical values, battery life, wireless versions (e.g., Bluetooth 5.0), materials, or certifications (eco-friendly/anti-bacterial etc.) that are not explicitly listed.

Requirements (Amazon 2026.07.27):
1. Output exactly 1 Title (Item Name) + 1 Item Highlights + 5 Bullet Points. Both Title and Highlights are searchable, do not duplicate keywords between them.
   - Title (Item Name): characterCount <= 75 including spaces. Must front-load Brand + Product Type + 1-2 core keywords within first 60 chars for mobile. Use Title Case (English: "Waterproof Bluetooth Speaker for Outdoor Use"; German: noun capitalization). NOT ALL CAPS. No markdown, no emoji, no special chars ! $ ? _ { } ^ ¬ ¦ ™ ® © € £ ¥, no promotional words (best/guaranteed/on sale/free shipping/premium/high-quality), no keyword stuffing (same word <=2 times), no repeated words, no invented specs. The title you output MUST already be <=75 characters - the validator will reject any title over 75 and trigger regeneration, do not output a truncated title with substring.
   - Item Highlights: characterCount <=125 including spaces. Provide 1 concise line for secondary attributes (material/dimensions/compatibility/use case). No markdown, no emoji, no special chars, no promotional words, no repetition. Must differ from Title.
   - Bullets: Exactly 5. Each bullet must start with ALL CAPS keyword + colon (e.g., "IP67 WATERPROOF DESIGN:"), then FACT + BENEFIT structure. Each bullet 10-255 chars, recommended <=200 for mobile, at least 100 chars. Use sentence fragments with semicolons to separate phrases. Write numbers one to nine in full except model/measurement. Absolutely prohibited words: perfect, amazing, ultimate, reliable and other meaningless adjectives. Absolutely prohibited sentence patterns: Whether you're..., you can trust..., etc. No markdown, no emoji, no special chars ™ ® © € £ ¥, no placeholder N/A/TBD, no guarantee phrases, no external links, no ASINs, no unverified claims (eco-friendly/anti-bacterial/made from bamboo unless explicitly in Product Facts). Use cold, objective, direct pain-point language.
2. Output language must be【${langMap[platform] || platform}】, translate Chinese facts into idiomatic target language, never copy Chinese verbatim. For German, apply German capitalization rules.
3. Strictly follow plain text format: "【商品标题】" then "【商品亮点】" then "【五点描述】" sections only, no extra explanations or greetings.`;

      const userPrompt = `产品中文名称：${productName.trim()}\n中文核心卖点：<Product_Facts>${normalized}</Product_Facts>`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      const r = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "Qwen/Qwen2.5-72B-Instruct",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 2000,
          top_p: 0.9,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: `SiliconFlow HTTP ${r.status}: ${errText.slice(0, 500)}` });
      }
      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) return res.status(502).json({ error: "Empty response from SiliconFlow" });
      return res.status(200).json({ content });
    }

    if (action === "compressTitle") {
      if (!title) return res.status(400).json({ error: "Missing title for compressTitle" });
      const tLimit = platform === "tiktok-en" ? 80 : 75;
      const prompt = `Compress this ${platform === "tiktok-en" ? "TikTok" : "Amazon"} ${platform === "amazon-de" ? "DE" : "US"} title to <=${tLimit} characters including spaces, keep natural ${platform === "amazon-de" ? "German" : "Title Case"}, no ALL CAPS, no markdown, ${platform === "tiktok-en" ? "" : "no emoji,"} no promotional words, front-load brand within 60 chars: "${title}" Product: "${(productName||"").trim()}" Facts: "${(normalizedPoints||sellingPoints||"").toString().slice(0,300)}" Platform: ${platform}. Output ONLY the title.`;
      const r = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "Qwen/Qwen2.5-72B-Instruct", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 200 }),
      });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: `CompressTitle HTTP ${r.status}: ${errText.slice(0,500)}` });
      }
      const data = await r.json();
      const content = (data?.choices?.[0]?.message?.content?.trim().split("\n")[0] || "").replace(/^["“”]+|["“”]+$/g, "").trim();
      return res.status(200).json({ content });
    }

    if (action === "compressHighlights") {
      if (!highlights) return res.status(400).json({ error: "Missing highlights for compressHighlights" });
      const prompt = `Compress this Amazon Item Highlights to <=125 characters including spaces, keep concise, no promotional words, no repetition with title "${title || ""}": "${highlights}" Facts: "${(normalizedPoints||sellingPoints||"").toString().slice(0,300)}". Output ONLY the highlights line.`;
      const r = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "Qwen/Qwen2.5-72B-Instruct", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 200 }),
      });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: `CompressHighlights HTTP ${r.status}: ${errText.slice(0,500)}` });
      }
      const data = await r.json();
      const content = (data?.choices?.[0]?.message?.content?.trim().split("\n")[0] || "").replace(/^["“”]+|["“”]+$/g, "").trim();
      return res.status(200).json({ content });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error("[api/generate] error", err);
    const isAbort = err && err.name === "AbortError";
    return res.status(isAbort ? 504 : 500).json({ error: isAbort ? "Upstream timeout (45s)" : (err.message || "Internal Server Error") });
  }
}
