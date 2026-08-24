import { useState } from "react";
import { validateTitle, cleanTitleDeterministic, getTitleDisplay } from "./lib/titleValidator";
import { validateFacts } from "./lib/factValidator";

type Platform = "amazon-en" | "amazon-de" | "tiktok-en";

const PLATFORM_OPTIONS: { value: Platform; label: string; hint: string }[] = [
  { value: "amazon-en", label: "Amazon-英文", hint: "符合 Amazon 英文规范" },
  { value: "amazon-de", label: "Amazon-德文", hint: "适配德国站" },
  { value: "tiktok-en", label: "TikTok-英文", hint: "短视频带货风格" },
];

type ListingResult = {
  title: string;
  bullets: string[];
};

function parseListingContent(content: string): ListingResult {
  const trimmed = content.trim();
  let title = "";
  let bullets: string[] = [];
  const titleMatch = trimmed.match(/【商品标题】\s*[:：]?\s*([\s\S]*?)(?=【五点描述】|$)/);
  if (titleMatch) {
    const raw = titleMatch[1].trim();
    const firstNonEmpty = raw.split("\n").map((s) => s.trim()).find((s) => s.length > 0) || raw;
    title = firstNonEmpty.replace(/^["「『]|["」』]$/g, "").trim();
  } else {
    const firstBracket = trimmed.match(/【\s*([^】]{2,60})\s*】/);
    if (firstBracket) title = firstBracket[1].trim();
  }
  const bulletsMatch = trimmed.match(/【五点描述】\s*[:：]?\s*([\s\S]*)/);
  const bulletsRaw = bulletsMatch ? bulletsMatch[1].trim() : "";
  if (bulletsRaw) {
    const lines = bulletsRaw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[0-9]+[.\、\)\]]\s*/, "").replace(/^[-•●]\s*/, "").trim()).filter(Boolean);
    bullets = lines.slice(0, 5);
  }
  title = title.replace(/\*\*/g, "").trim();
  bullets = bullets.map((b) => b.replace(/\*\*/g, "").trim());
  if (!title) {
    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    const firstLine = lines.find((l) => l.length > 4) || trimmed.slice(0, 120);
    const inner = firstLine.match(/【\s*([^】]+)\s*】/);
    title = (inner ? inner[1].trim() : firstLine.replace(/【[^】]*】/g, "").trim()).replace(/\*\*/g, "").slice(0, 220);
    if (!title) title = firstLine.replace(/\*\*/g, "").slice(0, 220);
  }
  if (bullets.length === 0) {
    const linesAll = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    let titleIdx = linesAll.findIndex((l) => l.includes(title) || /【[^】]*】/.test(l));
    if (titleIdx === -1) titleIdx = 0;
    const candidate = linesAll.slice(titleIdx + 1);
    const bulletLines = candidate.map((l) => l.replace(/^[0-9]+[.\、\)\]]\s*/, "").replace(/^[-•●]\s*/, "").trim()).filter((l) => l.length > 8);
    if (bulletLines.length) bullets = bulletLines.slice(0, 5);
    else {
      const fallback = trimmed.split(/[。\n]/).map((s) => s.trim()).filter((s) => s.length > 8 && !s.includes(title)).slice(0, 5);
      bullets = fallback.length ? fallback : candidate.slice(0, 5);
    }
  }
  title = title.replace(/\*\*/g, "").trim();
  bullets = bullets.map((b) => b.replace(/\*\*/g, "").trim()).filter(Boolean);
  if (title && title === title.toUpperCase() && /[A-Z]{2,}/.test(title)) {
    title = title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(ble|usb|ipx7|360°)\b/gi, (m) => m.toUpperCase());
  }
  while (bullets.length < 5) bullets.push(bullets[bullets.length - 1] || "—");
  bullets = bullets.slice(0, 5);
  return { title, bullets };
}

export default function App() {
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [platform, setPlatform] = useState<Platform>("amazon-en");
  const [result, setResult] = useState<ListingResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hallucinationAlerts, setHallucinationAlerts] = useState<Array<{ type: string; value: string }>>([]);

  const canGenerate = productName.trim().length > 0 && sellingPoints.trim().length > 0;

  const handleGenerate = async () => {
    if (!canGenerate || isGenerating) return;
    setIsGenerating(true);
    setCopied(false);
    setError(null);
    setResult(null);
    setHallucinationAlerts([]);

    const apiKey = import.meta.env.VITE_SILICONFLOW_API_KEY as string | undefined;
    const platformLabel = PLATFORM_OPTIONS.find((o) => o.value === platform)?.label || platform;
    if (!apiKey || apiKey.trim() === "" || apiKey.includes("请在此")) {
      setError("未配置 API 密钥：请在项目根目录创建 .env 并设置 VITE_SILICONFLOW_API_KEY");
      setIsGenerating(false);
      return;
    }

    const langMap: Record<Platform, string> = {
      "amazon-en": "英文（Amazon.com）",
      "amazon-de": "德文（Amazon.de）",
      "tiktok-en": "英文（TikTok Shop）",
    };

    const normalizedPoints = sellingPoints.trim().replace(/[\/／]/g, "、").replace(/[,，]/g, "、");
    const originalFacts = normalizedPoints.split(/[、\n]+/).map((s) => s.trim()).filter(Boolean);
    if (productName.trim()) originalFacts.unshift(productName.trim());

    const systemPrompt = `You are a senior cross-border e-commerce listing specialist. Your task is to write a listing for 【${platformLabel}】 based on Product Facts.

<Product_Facts>
${normalizedPoints}
</Product_Facts>

Product Facts are the single source of truth. You MUST strictly base your description ONLY on the <Product_Facts>. NEVER invent, infer, or fabricate any technical specifications, numerical values, battery life, wireless versions (e.g., Bluetooth 5.0), or materials that are not explicitly listed.

Requirements:
1. Output exactly 1 Title and 5 Bullet Points. Title must include core category keywords, be concise and natural.
   - Title: characterCount <= 75 including spaces. Use normal English title formatting (Title Case like "Waterproof Bluetooth Speaker for Outdoor Use"), NOT ALL CAPS. No markdown, no emoji, no "!" promotional symbols, no Best/Amazing/Top Rated/#1 unless part of a legitimate brand, no keyword stuffing, no repeated words, no invented specs.
   - Bullets: Each bullet must start with ALL CAPS keyword + colon (e.g., "IP67 WATERPROOF DESIGN:"), then extremely concise FACT + BENEFIT structure. Absolutely prohibited words: perfect, amazing, ultimate, reliable and other meaningless adjectives. Absolutely prohibited sentence patterns: Whether you're..., you can trust..., etc. Use cold, objective, direct pain-point language. At least 100 characters, no markdown, no emoji, no invented specs.
2. Output language must be【${langMap[platform]}】, translate Chinese facts into idiomatic target language, never copy Chinese verbatim.
3. Strictly follow plain text format: "【商品标题】" and "【五点描述】" sections only, no extra explanations or greetings. The title you output MUST already be <=75 characters - the validator will reject any title over 75 and trigger regeneration, do not output a truncated title with substring.`;

    const userPrompt = `产品中文名称：${productName.trim()}
中文核心卖点：<Product_Facts>${normalizedPoints}</Product_Facts>`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
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
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }
      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("返回数据为空");
      let parsed = parseListingContent(content);
      const initialValidation = validateTitle(parsed.title);
      const overLength = initialValidation.violations.some((v) => v.type === "OVER_LENGTH");
      if (!parsed.title || initialValidation.violations.some((v) => v.type === "EMPTY")) throw new Error("标题为空，生成失败");
      if (overLength) {
        const cleaned = cleanTitleDeterministic(parsed.title);
        const cleanedValidation = validateTitle(cleaned);
        if (cleaned.length <= 75 && cleanedValidation.valid) {
          parsed = { ...parsed, title: cleaned };
        } else {
          let lastTitle = parsed.title;
          let success = false;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const c2 = new AbortController();
              const t2 = setTimeout(() => c2.abort(), 30000);
              const compressed = await (async () => {
                const prompt = `Compress this Amazon US title to <=75 characters including spaces, keep natural Title Case, no ALL CAPS, no markdown, no emoji, no promotional words: "${lastTitle}" Product: "${productName.trim()}" Facts: "${normalizedPoints}" Platform: ${platformLabel}. Output ONLY the title.`;
                const r = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                  body: JSON.stringify({ model: "Qwen/Qwen2.5-72B-Instruct", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 200 }),
                  signal: c2.signal,
                });
                clearTimeout(t2);
                if (!r.ok) throw new Error(`Compress HTTP ${r.status}`);
                const d = await r.json();
                return (d?.choices?.[0]?.message?.content?.trim().split("\n")[0] || "").replace(/^["“”]+|["“”]+$/g, "").trim();
              })();
              const compCleaned = cleanTitleDeterministic(compressed);
              const compV = validateTitle(compCleaned);
              if (compCleaned.length <= 75 && compV.valid) {
                parsed = { ...parsed, title: compCleaned };
                success = true;
                break;
              }
              lastTitle = compCleaned;
            } catch (e) {
              console.warn(`Compression attempt ${attempt + 1} failed`, e);
              break;
            }
          }
          if (!success) {
            setError("Title generation failed / Please regenerate - 标题超过75字符且压缩失败，请点击重新生成");
            setIsGenerating(false);
            return;
          }
        }
      } else if (!initialValidation.valid) {
        parsed = { ...parsed, title: cleanTitleDeterministic(parsed.title) };
      }
      // Phase 2: 防幻觉校验（非阻断）
      const fullText = `${parsed.title}\n${parsed.bullets.join("\n")}`;
      const alerts = validateFacts(fullText, originalFacts);
      setHallucinationAlerts(alerts);
      setResult(parsed);
    } catch (err: unknown) {
      clearTimeout(timer);
      console.error(err);
      const msg = err instanceof Error && err.name === "AbortError" ? "请求超时（45s），请重试或切回 7B" : "生成失败，请检查网络或 API 配置";
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    const text = `标题:\n${result.title}\n\n五点描述:\n${result.bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1160px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l7 4v6l-7 4-7-4V7l7-4z" /><path d="M12 11v8" /><path d="M12 11L5 7" /><path d="M12 11l7-4" /></svg>
            </div>
            <div>
              <h1 className="text-[17px] font-semibold leading-none text-slate-900">跨境电商 Listing 智能生成台</h1>
              <p className="mt-1 hidden text-xs text-slate-500 sm:block">一键生成符合平台规范的本土化标题与五点描述</p>
            </div>
          </div>
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">硅基流动 · Qwen2.5-72B</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1160px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-[88px] lg:h-fit">
            <h2 className="text-sm font-semibold tracking-wide text-slate-900">操作输入区</h2>
            <p className="mt-1 text-sm text-slate-500">填写后调用硅基流动生成多语言 Listing</p>
            <div className="mt-6 space-y-5">
              <div><label className="mb-2 block text-sm font-medium text-slate-700">产品中文名称 <span className="text-red-500">*</span></label><input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="例如：便携式蓝牙音箱" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">中文核心卖点 <span className="text-red-500">*</span></label><textarea value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} placeholder="例如：防水、长续航、便携、360°环绕音..." rows={4} className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /><p className="mt-2 text-xs text-slate-400">用逗号或换行分隔多个卖点</p></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">目标平台与语种</label><div className="relative"><select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100">{PLATFORM_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}</select><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></span></div><p className="mt-2 text-xs text-slate-400">{PLATFORM_OPTIONS.find((o) => o.value === platform)?.hint}</p></div>
              <button onClick={handleGenerate} disabled={!canGenerate || isGenerating} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isGenerating ? (<><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />生成中...</>) : (<><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6z" /></svg>一键生成本土化Listing</>)}</button>
              <p className="text-center text-xs text-slate-400">已接入硅基流动 Qwen2.5-72B，需配置 .env</p>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><h2 className="text-sm font-semibold text-slate-900">生成结果</h2><button onClick={handleCopy} disabled={!result} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{copied ? (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M5 13l4 4L19 7" /></svg><span className="text-green-600">已复制</span></>) : (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v3" /></svg>一键复制</>)}</button></div>
            <div className="p-6">
              {error ? (<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center"><p className="text-sm font-medium text-red-700">生成失败，请检查网络或 API 配置</p><p className="mt-2 text-xs text-red-500">{error}</p></div>) : !result ? (<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg></div><p className="mt-4 text-sm font-medium text-slate-700">暂无生成结果</p><p className="mt-1 max-w-[320px] text-sm leading-5 text-slate-500">请在左侧填写产品信息并选择目标平台，点击“生成”即可在此预览</p></div>) : (<div className="space-y-6"><div><div className="mb-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-violet-600" /><h3 className="text-sm font-semibold text-slate-900">标题</h3>{(() => {const disp = getTitleDisplay(result.title);const v = validateTitle(result.title);const over = v.violations.find((x) => x.type === "OVER_LENGTH");const other = v.violations.filter((x) => x.type !== "OVER_LENGTH");return (<><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${disp.status === "ok" ? "bg-emerald-50 text-emerald-700" : disp.status === "over" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{disp.text}</span><span className={`text-xs ${disp.status === "ok" ? "text-emerald-600" : disp.status === "over" ? "text-red-600" : "text-amber-600"}`}>{disp.message}</span>{over ? null : other.length ? <span className="text-xs text-amber-600">⚠ {other[0].message}</span> : null}</>);})()}</div><div className={`rounded-xl border p-4 text-sm leading-6 ${getTitleDisplay(result.title).status === "over" ? "border-red-200 bg-red-50/50 text-slate-800" : "border-violet-100 bg-violet-50/50 text-slate-800"}`}>{result.title}</div></div><div><div className="mb-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-violet-600" /><h3 className="text-sm font-semibold text-slate-900">五点描述</h3></div><ul className="space-y-3">{result.bullets.map((b, idx) => (<li key={idx} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-sm leading-6 text-slate-700"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-violet-700 shadow-sm">{idx + 1}</span><span>{b}</span></li>))}</ul></div>{hallucinationAlerts.length > 0 && (<div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-start gap-2"><span className="mt-0.5 text-amber-600">⚠</span><div><p className="text-sm font-medium text-amber-800">Listing Health Alert: 发现疑似未验证参数 [{hallucinationAlerts.map((a) => a.value).join(", ")}]。AI 可能产生了幻觉，请人工核对是否需要保留。</p><p className="mt-1 text-xs text-amber-700">已基于 &lt;Product_Facts&gt; 进行比对，上述数值/版本未在原始事实中出现。</p></div></div></div>)}</div>)}
            </div>
          </section>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">已接入硅基流动 · model: Qwen/Qwen2.5-72B-Instruct · 密钥通过 .env 的 VITE_SILICONFLOW_API_KEY 注入</p>
      </main>
    </div>
  );
}
