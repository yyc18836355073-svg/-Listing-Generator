import { useState, useEffect, useRef } from "react";
import { cleanTitleDeterministic, validateHighlights, cleanHighlightsDeterministic, getHighlightsDisplay, validateTitleMobile, toTitleCaseGerman, validateTitleForPlatform, getTitleDisplayForPlatform, getTitleLimitForPlatform } from "./lib/titleValidator";
import { validateFacts } from "./lib/factValidator";
import { validateBullets, getBulletDisplay } from "./lib/bulletValidator";

type Platform = "amazon-us" | "amazon-de" | "amazon-uk" | "amazon-jp" | "temu" | "tiktok-shop";

const PLATFORM_OPTIONS: { value: Platform; label: string; hint: string }[] = [
  { value: "amazon-us", label: "Amazon 美国站", hint: "75+125 2026新规" },
  { value: "amazon-de", label: "Amazon 德国站", hint: "75+125 德语" },
  { value: "amazon-uk", label: "Amazon 英国站", hint: "75+125 英式" },
  { value: "amazon-jp", label: "Amazon 日本站", hint: "75+125 日式" },
  { value: "temu", label: "Temu", hint: "60-100 核心品名" },
  { value: "tiktok-shop", label: "TikTok Shop", hint: "40-80 爆款钩子" },
];

const PLATFORM_PROMPTS: Record<Platform, string> = {
  'amazon-us': `【Amazon 美国站规则】:
- 标题: 严格控制在 75 字符内，首字母大写，包含大词与核心卖点。
- 亮点: 输出 3 条 Item Highlights，每条 <= 125 字符。
- 五点描述: 严格输出 5 条，每条 10-255 字符，严禁句末标点及 Emoji。
- 搜索词: 严禁超过 249 字节，仅用空格分隔，严禁逗号。`,
  'amazon-de': `【Amazon 德国站规则】:
- 标题: 严格控制在 75 字符内，德语本土化表达，首字母大写。
- 亮点: 输出 3 条 Item Highlights，每条 <= 125 字符。
- 五点描述: 严格输出 5 条，每条 10-255 字符，严禁句末标点及 Emoji。
- 搜索词: 严禁超过 249 字节，仅用空格分隔，严禁逗号。`,
  'amazon-uk': `【Amazon 英国站规则】:
- 标题: 严格控制在 75 字符内，英式英语表达，首字母大写。
- 亮点: 输出 3 条 Item Highlights，每条 <= 125 字符。
- 五点描述: 严格输出 5 条，每条 10-255 字符，严禁句末标点及 Emoji。
- 搜索词: 严禁超过 249 字节，仅用空格分隔，严禁逗号。`,
  'amazon-jp': `【Amazon 日本站规则】:
- 标题: 严格控制在 75 字符内，符合日本消费者搜索和阅读习惯。
- 亮点: 输出 3 条 Item Highlights，每条 <= 125 字符。
- 五点描述: 严格输出 5 条，每条 10-255 字符，严禁句末标点及 Emoji。
- 搜索词: 严禁超过 249 字节，仅用空格分隔，严禁逗号。`,
  'temu': `【Temu 全托管/半托管规则】:
- 标题: 60-100 字符，格式强制为：[核心品名] + [规格/材质] + [适用场景]。
- 亮点: 提取 3 条核心材质与规格属性。
- 五点描述: 3-5 条纯参数化描述（如尺寸、材质、装箱清单），去除所有主观修饰词。
- 搜索词: 输出 5-10 个核心属性同义词，空格分隔。`,
  'tiktok-shop': `【TikTok Shop 兴趣电商规则】:
- 标题: 40-80 字符，强调使用场景、感官冲击与爆款钩子，一秒抓人眼球。
- 亮点: 提取 3 条最能打动用户的痛点解决方案。
- 五点描述: 3-4 条极简短句，突出高颜值、痛点解决与开箱即用体验。
- 搜索词: 提取 5-8 个高频 Trending 标签词（如 #hashtag）。`,
};

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

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen 2.5 72B" },
  { value: "THUDM/glm-4-9b-chat", label: "GLM-4 9B" },
  { value: "deepseek-ai/DeepSeek-V2-Chat", label: "DeepSeek V2" },
];

export default function App() {
  const [apiKey, setApiKey] = useState<string>(localStorage.getItem('siliconflow_key') || '');
  const [selectedModel, setSelectedModel] = useState<string>(localStorage.getItem('siliconflow_model') || 'Qwen/Qwen2.5-72B-Instruct');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [coreKeywords, setCoreKeywords] = useState<string>("");
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [platform, setPlatform] = useState<Platform>("amazon-us");
  const [result, setResult] = useState<ListingResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hallucinationAlerts, setHallucinationAlerts] = useState<Array<{ type: string; value: string }>>([]);

  // Task3: Draft
  type Draft = { id: string; timestamp: number; productName: string; sellingPoints: string; platform: Platform; coreKeywords: string; result: ListingResult | null; selectedModel: string };
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    try { return JSON.parse(localStorage.getItem('listing_drafts') || '[]'); } catch { return []; }
  });
  const [isDraftDrawerOpen, setIsDraftDrawerOpen] = useState(false);
  const draftTimerRef = useRef<number | null>(null);

  // Task4: Variants
  type Variant = { title: string; highlights: string; strategy: string };
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [activeVariant, setActiveVariant] = useState(0);

  const keywordsList = coreKeywords.split(/[,，\n]+/).map(s=>s.trim()).filter(Boolean);
  const highlightKeywords = (text: string) => {
    if (!keywordsList.length || !text) return text;
    const escaped = keywordsList.map(k=>k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join("|")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) => 
      keywordsList.some(k=>k.toLowerCase()===part.toLowerCase()) 
        ? <mark key={i} className="bg-yellow-200 font-bold px-0.5 rounded">{part}</mark> 
        : part
    );
  };
  const coverage = (() => {
    if (!keywordsList.length || !result) return null;
    const fullText = `${result.title} ${result.bullets.join(" ")}`.toLowerCase();
    const hit = keywordsList.filter(k=> fullText.includes(k.toLowerCase()));
    const missing = keywordsList.filter(k=> !fullText.includes(k.toLowerCase()));
    return { hit: hit.length, total: keywordsList.length, missing, hitList: hit };
  })();

  // Task3: Auto-save drafts every 5s (debounce)
  useEffect(() => {
    if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      if (!productName && !sellingPoints && !result) return;
      const draft: Draft = { id: Date.now().toString(), timestamp: Date.now(), productName, sellingPoints, platform, coreKeywords, result, selectedModel };
      setDrafts(prev => {
        const next = [draft, ...prev].slice(0, 10);
        try { localStorage.setItem('listing_drafts', JSON.stringify(next)); } catch {}
        return next;
      });
    }, 5000);
    return () => { if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current); };
  }, [productName, sellingPoints, platform, coreKeywords, result, selectedModel]);

  const canGenerate = productName.trim().length > 0 && sellingPoints.trim().length > 0;

  const restoreDraft = (d: Draft) => {
    setProductName(d.productName);
    setSellingPoints(d.sellingPoints);
    setPlatform(d.platform as Platform);
    setCoreKeywords(d.coreKeywords);
    setSelectedModel(d.selectedModel || 'Qwen/Qwen2.5-72B-Instruct');
    localStorage.setItem('siliconflow_model', d.selectedModel || 'Qwen/Qwen2.5-72B-Instruct');
    if (d.result) {
      setResult(d.result);
      setVariants(null);
      setActiveVariant(0);
    }
    setIsDraftDrawerOpen(false);
  };
  const deleteDraft = (id: string) => {
    setDrafts(prev => {
      const next = prev.filter(d=>d.id!==id);
      localStorage.setItem('listing_drafts', JSON.stringify(next));
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!apiKey || apiKey.trim() === "") {
      setError("请先配置 API Key");
      return;
    }
    if (!canGenerate || isGenerating) return;
    setIsGenerating(true);
    setCopied(false);
    setError(null);
    setResult(null);
    setHallucinationAlerts([]);

    const normalizedPoints = sellingPoints.trim().replace(/[\/／]/g, "、").replace(/[,，]/g, "、");
    const originalFacts = normalizedPoints.split(/[、\n]+/).map((s) => s.trim()).filter(Boolean);
    if (productName.trim()) originalFacts.unshift(productName.trim());

    const platformRule = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS["amazon-us"];
    const systemPrompt = `你是一名精通多平台出海运营的资深 Listing 专家。当前目标平台为：${platform}。
你的任务是生成或修复高转化、零违规的 Listing。

【当前目标平台专属规则】：
${platformRule}

【通用安全与格式铁律（所有平台适用）】：
1. 严禁自行捏造任何用户未提及的具体尺寸、精确重量或虚构功能。
2. 严禁提及任何第三方知名品牌及商标进行蹭流侵权。
3. 严禁使用医疗疗效词（cure, treat, relief, FDA approved）及违规农药词。
4. 必须严格按照以下标签输出，标签内直接输出纯文本内容：
【商品标题 - 变体矩阵】请为标题和亮点各输出3套差异化变体，策略A-极简参数风、策略B-痛点解决风、策略C-感官营销风，以JSON格式输出：
{"variants":[{"strategy":"极简参数风","title":"...","highlights":"..."},{"strategy":"痛点解决风","title":"...","highlights":"..."},{"strategy":"感官营销风","title":"...","highlights":"..."}]}
【五点描述】(极端严格：必须且只能以数字序号 "1. "、"2. "、"3. "、"4. "、"5. " 开头进行分行，严禁使用短横线 - 或圆点 • ！)
【搜索词】`;

    const userPrompt = `产品中文名称：${productName.trim()}
中文核心卖点：<Product_Facts>${normalizedPoints}</Product_Facts>`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: selectedModel,
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
      // Task4: Try to parse 3 variants JSON
      try {
        const jsonMatch = content.match(/\{[\s\S]*"variants"[\s\S]*\}/);
        if (jsonMatch) {
          const j = JSON.parse(jsonMatch[0]);
          if (j.variants && Array.isArray(j.variants) && j.variants.length >= 3) {
            const vs = j.variants.slice(0,3).map((v:any)=>({title: String(v.title||""), highlights: String(v.highlights||""), strategy: String(v.strategy||"")}));
            setVariants(vs);
            setActiveVariant(0);
            parsed = { ...parsed, title: vs[0].title || parsed.title, highlights: vs[0].highlights || parsed.highlights };
          } else {
            setVariants(null);
          }
        } else {
          // Fallback: try delimiter based parsing
          const varSections = content.split(/【变体[一二三123]/).filter(s=>s.includes("【商品标题】")||s.includes("标题"));
          if (varSections.length>=3) {
            const vs = varSections.slice(0,3).map((sec,i)=> {
              const p = parseListingContent(sec);
              return {title: p.title, highlights: p.highlights, strategy: ["极简参数风","痛点解决风","感官营销风"][i]||`变体${i+1}`};
            });
            if (vs[0].title) { setVariants(vs); setActiveVariant(0); parsed = {...parsed, title: vs[0].title, highlights: vs[0].highlights}; } else setVariants(null);
          } else setVariants(null);
        }
      } catch { setVariants(null); }
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
              const c2 = new AbortController();
              const t2 = setTimeout(() => c2.abort(), 30000);
              const compressed = await (async () => {
                const prompt = `Compress this ${platform === "tiktok-shop" ? "TikTok" : "Amazon"} ${platform === "amazon-de" ? "DE" : "US"} title to <=${tLimit} characters including spaces, keep natural ${platform === "amazon-de" ? "German" : "Title Case"}, no ALL CAPS, no markdown, ${platform === "tiktok-shop" ? "" : "no emoji,"} no promotional words, front-load brand within 60 chars: "${lastTitle}" Product: "${productName.trim()}" Facts: "${normalizedPoints}" Platform: ${platform}. Output ONLY the title.`;
                const r = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                  body: JSON.stringify({           model: selectedModel, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 200 }),
                  signal: c2.signal,
                });
                clearTimeout(t2);
                if (!r.ok) throw new Error(`Compress HTTP ${r.status}`);
                const d = await r.json();
                return (d?.choices?.[0]?.message?.content?.trim().split("\n")[0] || "").replace(/^["“”]+|["“”]+$/g, "").trim();
              })();
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
              const c3 = new AbortController();
              const t3 = setTimeout(() => c3.abort(), 30000);
              const compressedH = await (async () => {
                const prompt = `Compress this Amazon Item Highlights to <=125 characters including spaces, keep concise, no promotional words, no repetition with title "${parsed.title}": "${lastH}" Facts: "${normalizedPoints}". Output ONLY the highlights line.`;
                const r = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                  body: JSON.stringify({           model: selectedModel, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 200 }),
                  signal: c3.signal,
                });
                clearTimeout(t3);
                if (!r.ok) throw new Error(`Compress Highlights HTTP ${r.status}`);
                const d = await r.json();
                return (d?.choices?.[0]?.message?.content?.trim().split("\n")[0] || "").replace(/^["“”]+|["“”]+$/g, "").trim();
              })();
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
      clearTimeout(timer);
      console.error(err);
      const msg = err instanceof Error && err.name === "AbortError" ? "请求超时（45s），请重试或切回 7B" : "生成失败，请检查网络或 API 配置";
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAutoFix = async () => {
    if (!apiKey || apiKey.trim() === "") {
      setError("请先配置 API Key");
      return;
    }
    if (!result) return;
    setIsFixing(true);
    setError(null);
    try {
      const currentListing = {
        title: result.title,
        highlights: result.highlights ? [result.highlights] : [],
        bullets: result.bullets,
        searchTerms: "",
      };
      const allBulletViolations = hallucinationAlerts.map(a => `${a.type}: ${a.value}`);
      const violations = allBulletViolations;
      const userPrompt = `【全局智能合规审计与修复任务】
当前 Listing 已被前端系统拦截，部分已知违规项如下：
${violations.length > 0 ? violations.map((v, i) => `${i + 1}. ${v}`).join('\n') : '未检测到明显格式错误，请进行深度语义与侵权审查'}


【当前 Listing 内容】：
【当前标题】：${currentListing.title || ''}
【当前亮点】：${(currentListing.highlights || []).join(' | ')}
【当前五点】：
${(currentListing.bullets || []).join('\n')}
【当前搜索词】：${currentListing.searchTerms || ''}


🟟【最高修复指令（AI 独立审查权）】：
1. 突破前端限制：即使上方【已知违规项】未提及，你也必须主动扫描并清除文本中隐藏的任何第三方品牌（如 Apple, Sony）、医疗宣称及绝对化极限词！
2. 彻底洗白：将所有违规词重写为安全中性的功能描述。
3. 严格遵循上方【${platform} 专属规则】的字数截断与格式约束！
4. 严格按照标签格式输出修复后的完整内容。
5. 🟟最高铁律：必须 100% 使用【${platform}】对应的本土化外语输出，严禁在结果中出现任何中文字符！`;

      const platformRule = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS["amazon-us"];
      const systemPrompt = `你是一名精通多平台出海运营的资深 Listing 专家。当前目标平台为：${platform}。
你的任务是生成或修复高转化、零违规的 Listing。

【当前目标平台专属规则】：
${platformRule}

【通用安全与格式铁律（所有平台适用）】：
1. 严禁自行捏造任何用户未提及的具体尺寸、精确重量或虚构功能。
2. 严禁提及任何第三方知名品牌及商标进行蹭流侵权。
3. 严禁使用医疗疗效词（cure, treat, relief, FDA approved）及违规农药词。
4. 必须严格按照以下标签输出，标签内直接输出纯文本内容：
【商品标题】
【商品亮点】
【五点描述】(极端严格：必须且只能以数字序号 "1. "、"2. "、"3. "、"4. "、"5. " 开头进行分行，严禁使用短横线 - 或圆点 • ！)
【搜索词】`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.5,
          max_tokens: 2048,
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
      const parsed = parseListingContent(content);
      setResult(parsed);
      const fullText = `${parsed.title}\n${parsed.highlights}\n${parsed.bullets.join("\n")}`;
      const normalizedPoints = sellingPoints.trim().replace(/[\/／]/g, "、").replace(/[,，]/g, "、");
      const originalFacts = normalizedPoints.split(/[、\n]+/).map((s) => s.trim()).filter(Boolean);
      if (productName.trim()) originalFacts.unshift(productName.trim());
      setHallucinationAlerts(validateFacts(fullText, originalFacts));
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error && err.name === "AbortError" ? "请求超时（45s），请重试" : "自动修复失败，请检查网络或 API 配置";
      setError(msg);
    } finally {
      setIsFixing(false);
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
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">硅基流动 · {MODEL_OPTIONS.find(m=>m.value===selectedModel)?.label || selectedModel}</span>
        </div>
      </header>
      <div className="mx-auto max-w-[1160px] px-4 sm:px-6 lg:px-8 pt-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button onClick={()=>setIsSettingsOpen(!isSettingsOpen)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <span className="flex items-center gap-2">⚙️ 系统设置 <span className="text-xs font-normal text-slate-400">密钥与模型</span></span>
            <span className="text-slate-400">{isSettingsOpen ? "▲" : "▼"}</span>
          </button>
          {isSettingsOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">SiliconFlow API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); localStorage.setItem('siliconflow_key', e.target.value); }}
                  placeholder="填入硅基流动 sk-...（仅本地存储）"
                  className="w-full bg-white rounded-lg border border-amber-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                />
                <p className="mt-1 text-xs text-slate-400">仅本地存储，不上传服务器</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">模型选择</label>
                <select
                  value={selectedModel}
                  onChange={(e) => { setSelectedModel(e.target.value); localStorage.setItem('siliconflow_model', e.target.value); }}
                  className="w-full bg-white rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                >
                  {MODEL_OPTIONS.map(o=> <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
      <main className="mx-auto max-w-[1160px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-[88px] lg:h-fit">
            <h2 className="text-sm font-semibold tracking-wide text-slate-900">操作输入区</h2>
            <p className="mt-1 text-sm text-slate-500">填写后调用硅基流动生成多语言 Listing</p>
            <div className="mt-6 space-y-5">
              <div><label className="mb-2 block text-sm font-medium text-slate-700">产品中文名称 <span className="text-red-500">*</span></label><input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="例如：便携式蓝牙音箱" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">中文核心卖点 <span className="text-red-500">*</span></label><textarea value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} placeholder="例如：防水、长续航、便携、360°环绕音..." rows={4} className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /><p className="mt-2 text-xs text-slate-400">用逗号或换行分隔多个卖点</p></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">核心搜索词（SEO）</label><input value={coreKeywords} onChange={(e) => setCoreKeywords(e.target.value)} placeholder="例如：waterproof, bluetooth, portable（逗号分隔）" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /><p className="mt-1 text-xs text-slate-400">用于标题/五点埋词检测与高亮</p></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">目标平台与语种</label><div className="relative"><select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100">{PLATFORM_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}</select><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></span></div><p className="mt-2 text-xs text-slate-400">{PLATFORM_OPTIONS.find((o) => o.value === platform)?.hint}</p></div>
              <button onClick={handleGenerate} disabled={!canGenerate || isGenerating || isFixing} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isGenerating ? (<><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />生成中...</>) : (<><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6z" /></svg>一键生成本土化Listing</>)}</button>
              <button onClick={()=>setIsDraftDrawerOpen(true)} className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                📋 历史草稿箱 ({drafts.length}/10) {drafts.length>0 && <span className="text-xs text-slate-400">· {new Date(drafts[0].timestamp).toLocaleTimeString()}</span>}
              </button>
              <p className="text-center text-xs text-slate-400">已接入硅基流动 {MODEL_OPTIONS.find(m=>m.value===selectedModel)?.label || "Qwen2.5-72B"} · 密钥本地存储 · 自动保存5秒防丢</p>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><h2 className="text-sm font-semibold text-slate-900">生成结果</h2><div className="flex items-center gap-2"><button onClick={handleAutoFix} disabled={!result || isFixing || isGenerating} className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">{isFixing ? (<><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />修复中...</>) : "⚡ 一键合规修复"}</button><button onClick={handleCopy} disabled={!result} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{copied ? (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M5 13l4 4L19 7" /></svg><span className="text-green-600">已复制</span></>) : (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v3" /></svg>一键复制</>)}</button></div></div>
            <div className="p-6">
              {error ? (<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center"><p className="text-sm font-medium text-red-700">生成失败，请检查网络或 API 配置</p><p className="mt-2 text-xs text-red-500">{error}</p></div>) : !result ? (<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg></div><p className="mt-4 text-sm font-medium text-slate-700">暂无生成结果</p><p className="mt-1 max-w-[320px] text-sm leading-5 text-slate-500">请在左侧填写产品信息并选择目标平台，点击“生成”即可在此预览</p></div>) : (<div className="space-y-6">{variants && variants.length===3 && (<div className="flex gap-2 p-1 bg-slate-100 rounded-xl">{variants.map((v,i)=> <button key={i} onClick={()=>{setActiveVariant(i); setResult(prev=> prev ? {...prev, title: v.title, highlights: v.highlights} : prev);}} className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition ${activeVariant===i?"bg-white shadow text-violet-700":"text-slate-600 hover:bg-white/50"}`}>{`变体${i+1}·${v.strategy}`}</button>)}</div>)}{coverage && (<div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between"><div className="text-sm"><span className="font-medium text-blue-900">SEO 关键词覆盖率：</span><span className="text-blue-700">已埋入 {coverage.hit}/{coverage.total}</span>{coverage.missing.length>0 && <span className="text-amber-700"> 未命中：{coverage.missing.join(", ")}</span>}</div><span className={`text-xs px-2 py-1 rounded-full font-medium ${coverage.hit===coverage.total?"bg-emerald-100 text-emerald-800":"bg-amber-100 text-amber-800"}`}>{coverage.hit===coverage.total?"✅ 全覆盖":"⚠️ 待优化"}</span></div>)}<div><div className="mb-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-violet-600" /><h3 className="text-sm font-semibold text-slate-900">标题</h3>{(() => {const disp = getTitleDisplayForPlatform(result.title, platform);const v = validateTitleForPlatform(result.title, platform);const over = v.violations.find((x) => x.type === "OVER_LENGTH");const other = v.violations.filter((x) => x.type !== "OVER_LENGTH");const brand = productName.trim().split(/\s+/)[0] || "";const mobile = platform === "tiktok-shop" ? {warnings:[]} : validateTitleMobile(result.title, brand);return (<><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${disp.status === "ok" ? "bg-emerald-50 text-emerald-700" : disp.status === "over" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{disp.text}</span><span className={`text-xs ${disp.status === "ok" ? "text-emerald-600" : disp.status === "over" ? "text-red-600" : "text-amber-600"}`}>{disp.message}</span>{over ? null : other.length ? <span className="text-xs text-amber-600">⚠ {other[0].message}</span> : null}{mobile.warnings.length ? <span className="text-xs text-amber-600">⚠ {mobile.warnings[0]}</span> : null}</>);})()}</div><div className={`rounded-xl border p-4 text-sm leading-6 ${getTitleDisplayForPlatform(result.title, platform).status === "over" ? "border-red-200 bg-red-50/50 text-slate-800" : "border-violet-100 bg-violet-50/50 text-slate-800"}`}>{highlightKeywords(result.title)}</div></div><div><div className="mb-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /><h3 className="text-sm font-semibold text-slate-900">商品亮点</h3>{(() => {const dispH = getHighlightsDisplay(result.highlights);const vH = validateHighlights(result.highlights);const overH = vH.violations.find((x) => x.type === "OVER_LENGTH");const otherH = vH.violations.filter((x) => x.type !== "OVER_LENGTH");return (<><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${dispH.status === "ok" ? "bg-emerald-50 text-emerald-700" : dispH.status === "over" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{dispH.text}</span><span className={`text-xs ${dispH.status === "ok" ? "text-emerald-600" : dispH.status === "over" ? "text-red-600" : "text-amber-600"}`}>{dispH.message}</span>{overH ? null : otherH.length ? <span className="text-xs text-amber-600">⚠ {otherH[0].message}</span> : null}</>);})()}</div><div className={`rounded-xl border p-4 text-sm leading-6 ${getHighlightsDisplay(result.highlights).status === "over" ? "border-red-200 bg-red-50/50 text-slate-600" : result.highlights ? "border-amber-100 bg-amber-50/50 text-slate-800" : "border-dashed border-slate-200 bg-slate-50 text-slate-400"}`}>{result.highlights || "— 暂无亮点"}</div></div><div><div className="mb-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-violet-600" /><h3 className="text-sm font-semibold text-slate-900">五点描述</h3></div><ul className="space-y-3">{result.bullets.map((b, idx) => {const disp = getBulletDisplay(b);const v = validateBullets([b]).bulletResults[0];const hasError = v.violations.some(x=> x.type==="OVER_LENGTH"||x.type==="BANNED_PHRASE"||x.type==="PLACEHOLDER"||x.type==="GUARANTEE");return (<li key={idx} className={`flex flex-col gap-1 rounded-xl border p-3.5 text-sm leading-6 ${hasError ? "border-red-200 bg-red-50/50 text-slate-800" : disp.status==="warning" ? "border-amber-200 bg-amber-50/50 text-slate-700" : "border-slate-200 bg-slate-50/50 text-slate-700"}`}><div className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-violet-700 shadow-sm">{idx + 1}</span><span className="flex-1">{highlightKeywords(b)}</span></div><div className="ml-9 flex items-center gap-2 text-xs"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${disp.status==="ok" ? "bg-emerald-50 text-emerald-700" : disp.status==="over" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{disp.text}</span><span className={`${disp.status==="ok" ? "text-emerald-600" : disp.status==="over" ? "text-red-600" : "text-amber-600"}`}>{disp.message}</span>{v.violations.filter(x=>x.type!=="OVER_RECOMMENDED"&&x.type!=="MISSING_HEADER").slice(0,1).map((vv,i)=>(<span key={i} className="text-amber-600">⚠ {vv.message}</span>))}</div></li>);})}</ul></div>{(() => {const bv = validateBullets(result.bullets);return (<>{hallucinationAlerts.length > 0 && (<div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-start gap-2"><span className="mt-0.5 text-amber-600">⚠</span><div><p className="text-sm font-medium text-amber-800">Listing Health Alert: 发现疑似未验证参数 [{hallucinationAlerts.map((a) => a.value).join(", ")}]。AI 可能产生了幻觉，请人工核对是否需要保留。</p><p className="mt-1 text-xs text-amber-700">已基于 &lt;Product_Facts&gt; 进行比对，上述数值/版本未在原始事实中出现。{hallucinationAlerts.some(a=>a.type==="UNSUPPORTED_CLAIM") && " 含禁用声明需包装证明。"}</p></div></div></div>)}{bv.hasDuplicates && (<div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-medium text-amber-800">⚠ 五点存在重复内容，建议差异化</p></div>)}{bv.totalLength > 1000 && (<div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-medium text-amber-800">⚠ 五点总长 {bv.totalLength} &gt; 1000，建议压缩以适配移动端</p></div>)}</>);})()}</div>)}
            </div>
          </section>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">已接入硅基流动 · {MODEL_OPTIONS.find(m=>m.value===selectedModel)?.label || "Qwen2.5-72B"} · 75字符标题 + 125字符亮点 均可被搜索 · 密钥本地存储</p>
      </main>
      {isDraftDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={()=>setIsDraftDrawerOpen(false)} />
          <div className="w-96 max-w-[85vw] bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900">历史草稿箱</h3>
              <button onClick={()=>setIsDraftDrawerOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {drafts.length===0 ? <p className="text-sm text-slate-400 text-center py-8">暂无草稿，编辑后5秒自动保存</p> : drafts.map(d=> (
                <div key={d.id} className="rounded-xl border border-slate-200 p-3 hover:border-violet-200 hover:bg-violet-50/50 transition">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-700 truncate pr-2">{d.productName || "未命名产品"}</span>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{new Date(d.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">{d.sellingPoints.slice(0,60) || "无卖点"}</p>
                  <p className="text-xs text-violet-600 mt-1">{d.platform} · {d.result ? "已生成" : "未生成"}</p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={()=>restoreDraft(d)} className="flex-1 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700">恢复</button>
                    <button onClick={()=>deleteDraft(d.id)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">删除</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-100">
              <button onClick={()=>{localStorage.removeItem('listing_drafts'); setDrafts([]);}} className="w-full py-2 rounded-lg border border-rose-200 text-rose-600 text-xs hover:bg-rose-50">清空全部</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
