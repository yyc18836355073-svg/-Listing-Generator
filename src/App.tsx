import { useEffect, useState } from "react";
import { cleanTitleDeterministic, validateHighlights, cleanHighlightsDeterministic, getHighlightsDisplay, validateTitleMobile, toTitleCaseGerman, validateTitleForPlatform, getTitleDisplayForPlatform, getTitleLimitForPlatform } from "./lib/titleValidator";
import { validateFacts } from "./lib/factValidator";
import { validateBullets, getBulletDisplay } from "./lib/bulletValidator";
import { generateListing, compressTitle, compressHighlights, getApiKey, setApiKey, hasApiKey, normalizeSellingPoints, type Platform } from "./lib/siliconFlow";

const PLATFORM_OPTIONS: { value: Platform; label: string; hint: string }[] = [
  { value: "amazon-en", label: "Amazon-英文", hint: "75字符标题+125亮点 2026新规" },
  { value: "amazon-de", label: "Amazon-德文", hint: "75+125 德语名词大写" },
  { value: "tiktok-en", label: "TikTok-英文", hint: "80字符 口语化 允许emoji" },
];

type ListingResult = {
  title: string;
  highlights: string;
  bullets: string[];
};

function parseListingContent(content: string): ListingResult {
  const trimmed = content.trim();
  let title = "";
  let highlights = "";
  let bullets: string[] = [];
  const titleMatch = trimmed.match(/【商品标题】\s*[:：]?\s*([\s\S]*?)(?=【商品亮点】|【五点描述】|$)/);
  if (titleMatch) {
    const raw = titleMatch[1].trim();
    const firstNonEmpty = raw.split("\n").map((s) => s.trim()).find((s) => s.length > 0) || raw;
    title = firstNonEmpty.replace(/^["「『]|["」』]$/g, "").trim();
  } else {
    const firstBracket = trimmed.match(/【\s*([^】]{2,60})\s*】/);
    if (firstBracket) title = firstBracket[1].trim();
  }
  const highlightsMatch = trimmed.match(/【商品亮点】\s*[:：]?\s*([\s\S]*?)(?=【五点描述】|$)/);
  if (highlightsMatch) {
    const rawH = highlightsMatch[1].trim();
    const firstNonEmptyH = rawH.split("\n").map((s) => s.trim()).find((s) => s.length > 0) || rawH;
    highlights = firstNonEmptyH.replace(/^["「『]|["」』]$/g, "").trim().replace(/\*\*/g, "").slice(0, 300);
  }
  if (!highlights) {
    const altH = trimmed.match(/【Item Highlights】\s*[:：]?\s*([\s\S]*?)(?=【五点描述】|$)/);
    if (altH) highlights = altH[1].trim().split("\n")[0].trim().replace(/\*\*/g, "").slice(0, 300);
  }
  const bulletsMatch = trimmed.match(/【五点描述】\s*[:：]?\s*([\s\S]*)/);
  const bulletsRaw = bulletsMatch ? bulletsMatch[1].trim() : "";
  if (bulletsRaw) {
    const lines = bulletsRaw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[0-9]+[.\、\)\]]\s*/, "").replace(/^[-•●]\s*/, "").trim()).filter(Boolean);
    bullets = lines.slice(0, 5);
  }
  title = title.replace(/\*\*/g, "").trim();
  highlights = highlights.replace(/\*\*/g, "").trim();
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
  highlights = highlights.replace(/\*\*/g, "").trim();
  bullets = bullets.map((b) => b.replace(/\*\*/g, "").trim()).filter(Boolean);
  if (title && title === title.toUpperCase() && /[A-Z]{2,}/.test(title)) {
    title = title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(ble|usb|ipx7|360°)\b/gi, (m) => m.toUpperCase());
  }
  while (bullets.length < 5) bullets.push(bullets[bullets.length - 1] || "—");
  bullets = bullets.slice(0, 5);
  if (highlights && highlights.toLowerCase() === title.toLowerCase()) highlights = "";
  return { title, highlights, bullets };
}

export default function App() {
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [platform, setPlatform] = useState<Platform>("amazon-en");
  const [apiKey, setApiKeyState] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [result, setResult] = useState<ListingResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hallucinationAlerts, setHallucinationAlerts] = useState<Array<{ type: string; value: string }>>([]);

  useEffect(() => {
    setApiKeyState(getApiKey());
  }, []);

  const keyReady = hasApiKey();
  const canGenerate = productName.trim().length > 0 && sellingPoints.trim().length > 0;

  const persistKey = () => setApiKey(apiKey);
  const clearKey = () => {
    setApiKey("");
    setApiKeyState("");
  };

  const handleGenerate = async () => {
    const apiKeyValue = getApiKey();
    if (!apiKeyValue.trim()) {
      setError("请先粘贴你的硅基流动 API Key（仅保存在本地浏览器，不会上传）");
      return;
    }
    if (!canGenerate || isGenerating) return;
    setIsGenerating(true);
    setCopied(false);
    setError(null);
    setResult(null);
    setHallucinationAlerts([]);

    const normalizedPoints = normalizeSellingPoints(sellingPoints);
    const originalFacts = normalizedPoints.split(/[、\n]+/).map((s) => s.trim()).filter(Boolean);
    if (productName.trim()) originalFacts.unshift(productName.trim());

    try {
      const content = await generateListing({
        apiKey: apiKeyValue,
        productName: productName.trim(),
        sellingPoints,
        platform,
      });
      let parsed = parseListingContent(content);
      if (platform === "amazon-de") {
        parsed = { ...parsed, title: toTitleCaseGerman(parsed.title) };
      }
      const initialValidation = validateTitleForPlatform(parsed.title, platform);
      const highlightsValidation = validateHighlights(parsed.highlights);
      const overLength = initialValidation.violations.some((v) => v.type === "OVER_LENGTH");
      const highlightsOver = highlightsValidation.violations.some((v) => v.type === "OVER_LENGTH");
      if (!parsed.title || initialValidation.violations.some((v) => v.type === "EMPTY")) throw new Error("标题为空，生成失败");
      if (overLength) {
        const cleaned = cleanTitleDeterministic(parsed.title);
        const cleanedValidation = validateTitleForPlatform(cleaned, platform);
        const tLimit = getTitleLimitForPlatform(platform);
        if (cleaned.length <= tLimit && cleanedValidation.valid) {
          parsed = { ...parsed, title: cleaned };
        } else {
          let lastTitle = parsed.title;
          let success = false;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const compressed = await compressTitle({
                apiKey: apiKeyValue,
                title: lastTitle,
                productName: productName.trim(),
                normalizedPoints,
                platform,
              });
              const compCleaned = cleanTitleDeterministic(compressed);
              const compV = validateTitleForPlatform(compCleaned, platform);
              if (compCleaned.length <= tLimit && compV.valid) {
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
            setError(`Title generation failed / Please regenerate - 标题超过${tLimit}字符且压缩失败，请点击重新生成`);
            setIsGenerating(false);
            return;
          }
        }
      } else if (!initialValidation.valid) {
        parsed = { ...parsed, title: cleanTitleDeterministic(parsed.title) };
      }
      if (highlightsOver) {
        const cleanedH = cleanHighlightsDeterministic(parsed.highlights);
        const cleanedHV = validateHighlights(cleanedH);
        if (cleanedH.length <= 125 && cleanedHV.valid) {
          parsed = { ...parsed, highlights: cleanedH };
        } else {
          let lastH = parsed.highlights;
          let hSuccess = false;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const compressedH = await compressHighlights({
                apiKey: apiKeyValue,
                highlights: lastH,
                title: parsed.title,
                normalizedPoints,
              });
              const compCleanedH = cleanHighlightsDeterministic(compressedH);
              const compHV = validateHighlights(compCleanedH);
              if (compCleanedH.length <= 125 && compHV.valid) {
                parsed = { ...parsed, highlights: compCleanedH };
                hSuccess = true;
                break;
              }
              lastH = compCleanedH;
            } catch (e) {
              console.warn(`Highlights compression attempt ${attempt + 1} failed`, e);
              break;
            }
          }
          if (!hSuccess) {
            parsed = { ...parsed, highlights: cleanHighlightsDeterministic(parsed.highlights).slice(0, 125) };
          }
        }
      } else if (parsed.highlights && !highlightsValidation.valid) {
        parsed = { ...parsed, highlights: cleanHighlightsDeterministic(parsed.highlights) };
      }
      const fullText = `${parsed.title}\n${parsed.highlights}\n${parsed.bullets.join("\n")}`;
      const alerts = validateFacts(fullText, originalFacts);
      setHallucinationAlerts(alerts);
      setResult(parsed);
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error && err.name === "AbortError"
        ? "请求超时（45s），请重试或检查网络/API 连接"
        : (err instanceof Error ? err.message : "生成失败，请检查网络或 API 配置");
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    const text = `标题:\n${result.title}\n\n商品亮点:\n${result.highlights || "—"}\n\n五点描述:\n${result.bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")}`;
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
              <p className="mt-1 hidden text-xs text-slate-500 sm:block">一键生成符合2026新规的标题(75)+亮点(125)+五点描述</p>
            </div>
          </div>
          <span className="hidden rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 sm:block">硅基流动 · Qwen2.5-72B</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1160px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-[88px] lg:h-fit">
            <h2 className="text-sm font-semibold tracking-wide text-slate-900">操作输入区</h2>
            <p className="mt-1 text-sm text-slate-500">填写后调用硅基流动生成多语言 Listing</p>
            <div className="mt-6 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">硅基流动 API Key <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKeyState(e.target.value)}
                    onBlur={persistKey}
                    placeholder="sk-... 仅存储在本机浏览器"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
                  />
                  <button
                    onClick={() => setShowKey((s) => !s)}
                    className="shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-500 hover:bg-slate-50"
                    title={showKey ? "隐藏" : "显示"}
                  >
                    {showKey ? "隐藏" : "显示"}
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="pt-0.5 text-xs text-slate-400">密钥仅保存在本机，不会上传任何服务器</p>
                  {keyReady ? (
                    <button onClick={clearKey} className="text-xs font-medium text-red-500 hover:text-red-700">清除</button>
                  ) : null}
                </div>
                {keyReady ? (
                  <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7" /></svg>
                    密钥已保存到本地
                  </p>
                ) : null}
              </div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">产品中文名称 <span className="text-red-500">*</span></label><input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="例如：便携式蓝牙音箱" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">中文核心卖点 <span className="text-red-500">*</span></label><textarea value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} placeholder="例如：防水、长续航、便携、360°环绕音..." rows={4} className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /><p className="mt-2 text-xs text-slate-400">用逗号或换行分隔多个卖点</p></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">目标平台与语种</label><div className="relative"><select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100">{PLATFORM_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}</select><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></span></div><p className="mt-2 text-xs text-slate-400">{PLATFORM_OPTIONS.find((o) => o.value === platform)?.hint}</p></div>
              <button onClick={handleGenerate} disabled={!canGenerate || isGenerating} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isGenerating ? (<><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />生成中...</>) : (<><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6z" /></svg>一键生成本土化Listing</>)}</button>
              <p className="text-center text-xs text-slate-400">直连硅基流动 Qwen2.5-72B，密钥仅存本地</p>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><h2 className="text-sm font-semibold text-slate-900">生成结果</h2><button onClick={handleCopy} disabled={!result} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{copied ? (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M5 13l4 4L19 7" /></svg><span className="text-green-600">已复制</span></>) : (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v3" /></svg>一键复制</>)}</button></div>
            <div className="p-6">
              {!keyReady ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-10 text-center">
                  <p className="text-sm font-medium text-amber-800">请先填写上方的硅基流动 API Key</p>
                  <p className="mt-2 text-xs text-amber-700">密钥仅保存在本机浏览器 localStorage，不会上传。平台原生直连，无需服务器，连接更快更稳。</p>
                </div>
              ) : error ? (<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center"><p className="text-sm font-medium text-red-700">生成失败，请检查网络或 API 配置</p><p className="mt-2 text-xs text-red-500">{error}</p></div>) : !result ? (<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg></div><p className="mt-4 text-sm font-medium text-slate-700">暂无生成结果</p><p className="mt-1 max-w-[320px] text-sm leading-5 text-slate-500">请在左侧填写产品信息并选择目标平台，点击“生成”即可在此预览</p></div>) : (<div className="space-y-6"><div><div className="mb-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-violet-600" /><h3 className="text-sm font-semibold text-slate-900">标题</h3>{(() => {const disp = getTitleDisplayForPlatform(result.title, platform);const v = validateTitleForPlatform(result.title, platform);const over = v.violations.find((x) => x.type === "OVER_LENGTH");const other = v.violations.filter((x) => x.type !== "OVER_LENGTH");const brand = productName.trim().split(/\s+/)[0] || "";const mobile = platform === "tiktok-en" ? {warnings:[]} : validateTitleMobile(result.title, brand);return (<><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${disp.status === "ok" ? "bg-emerald-50 text-emerald-700" : disp.status === "over" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{disp.text}</span><span className={`text-xs ${disp.status === "ok" ? "text-emerald-600" : disp.status === "over" ? "text-red-600" : "text-amber-600"}`}>{disp.message}</span>{over ? null : other.length ? <span className="text-xs text-amber-600">⚠ {other[0].message}</span> : null}{mobile.warnings.length ? <span className="text-xs text-amber-600">⚠ {mobile.warnings[0]}</span> : null}</>);})()}</div><div className={`rounded-xl border p-4 text-sm leading-6 ${getTitleDisplayForPlatform(result.title, platform).status === "over" ? "border-red-200 bg-red-50/50 text-slate-800" : "border-violet-100 bg-violet-50/50 text-slate-800"}`}>{result.title}</div></div><div><div className="mb-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /><h3 className="text-sm font-semibold text-slate-900">商品亮点</h3>{(() => {const dispH = getHighlightsDisplay(result.highlights);const vH = validateHighlights(result.highlights);const overH = vH.violations.find((x) => x.type === "OVER_LENGTH");const otherH = vH.violations.filter((x) => x.type !== "OVER_LENGTH");return (<><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${dispH.status === "ok" ? "bg-emerald-50 text-emerald-700" : dispH.status === "over" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{dispH.text}</span><span className={`text-xs ${dispH.status === "ok" ? "text-emerald-600" : dispH.status === "over" ? "text-red-600" : "text-amber-600"}`}>{dispH.message}</span>{overH ? null : otherH.length ? <span className="text-xs text-amber-600">⚠ {otherH[0].message}</span> : null}</>);})()}</div><div className={`rounded-xl border p-4 text-sm leading-6 ${getHighlightsDisplay(result.highlights).status === "over" ? "border-red-200 bg-red-50/50 text-slate-600" : result.highlights ? "border-amber-100 bg-amber-50/50 text-slate-800" : "border-dashed border-slate-200 bg-slate-50 text-slate-400"}`}>{result.highlights || "— 暂无亮点"}</div></div><div><div className="mb-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-violet-600" /><h3 className="text-sm font-semibold text-slate-900">五点描述</h3></div><ul className="space-y-3">{result.bullets.map((b, idx) => {const disp = getBulletDisplay(b);const v = validateBullets([b]).bulletResults[0];const hasError = v.violations.some(x=> x.type==="OVER_LENGTH"||x.type==="BANNED_PHRASE"||x.type==="PLACEHOLDER"||x.type==="GUARANTEE");return (<li key={idx} className={`flex flex-col gap-1 rounded-xl border p-3.5 text-sm leading-6 ${hasError ? "border-red-200 bg-red-50/50 text-slate-800" : disp.status==="warning" ? "border-amber-200 bg-amber-50/50 text-slate-700" : "border-slate-200 bg-slate-50/50 text-slate-700"}`}><div className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-violet-700 shadow-sm">{idx + 1}</span><span className="flex-1">{b}</span></div><div className="ml-9 flex items-center gap-2 text-xs"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${disp.status==="ok" ? "bg-emerald-50 text-emerald-700" : disp.status==="over" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{disp.text}</span><span className={`${disp.status==="ok" ? "text-emerald-600" : disp.status==="over" ? "text-red-600" : "text-amber-600"}`}>{disp.message}</span>{v.violations.filter(x=>x.type!=="OVER_RECOMMENDED"&&x.type!=="MISSING_HEADER").slice(0,1).map((vv,i)=>(<span key={i} className="text-amber-600">⚠ {vv.message}</span>))}</div></li>);})}</ul></div>{(() => {const bv = validateBullets(result.bullets);return (<>{hallucinationAlerts.length > 0 && (<div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-start gap-2"><span className="mt-0.5 text-amber-600">⚠</span><div><p className="text-sm font-medium text-amber-800">Listing Health Alert: 发现疑似未验证参数 [{hallucinationAlerts.map((a) => a.value).join(", ")}]。AI 可能产生了幻觉，请人工核对是否需要保留。</p><p className="mt-1 text-xs text-amber-700">已基于 &lt;Product_Facts&gt; 进行比对，上述数值/版本未在原始事实中出现。{hallucinationAlerts.some(a=>a.type==="UNSUPPORTED_CLAIM") && " 含禁用声明需包装证明。"}</p></div></div></div>)}{bv.hasDuplicates && (<div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-medium text-amber-800">⚠ 五点存在重复内容，建议差异化</p></div>)}{bv.totalLength > 1000 && (<div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-medium text-amber-800">⚠ 五点总长 {bv.totalLength} &gt; 1000，建议压缩以适配移动端</p></div>)}</>);})()}</div>)}
            </div>
          </section>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">直连硅基流动 · Qwen2.5-72B · 标题75字符 + 亮点125字符 · 密钥仅存本机浏览器</p>
      </main>
    </div>
  );
}
