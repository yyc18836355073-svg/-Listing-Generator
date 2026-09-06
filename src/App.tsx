import { useState, useEffect, useRef } from "react";
// factValidator reserved for Ozon extension

type Platform = 'WB' | 'Ozon';
const PLATFORM_OPTIONS: { value: Platform; label: string; hint: string }[] = [
  { value: 'WB', label: 'Wildberries', hint: 'WB 60-100标题 · 5-8标签' },
  { value: 'Ozon', label: 'Ozon', hint: '保留扩展接口' },
];
// langMap reserved for Ozon extension (platform display)
const PLATFORM_PROMPTS: Record<Platform, string> = {
  'WB': `【Wildberries 规则】:\n- 标题: 60-100 字符，俄文，含核心品名+关键属性，首字母大写。\n- 标签: 5-8 个高频俄文搜索标签，逗号分隔。\n- 描述: 地道俄文详情，含空行排版与表情符号，突出卖点与场景。\n- 合规: 严禁医疗/货币/绝对化等俄广告法敏感词。`,
  'Ozon': `【Ozon 规则（预留）】:\n- 标题: 60-100 字符，俄文。\n- 标签: 5-8 个俄文标签。\n- 描述: 俄文详情，空行+表情。\n- 合规: 同俄广告法。`,
};

export interface WBListingResult {
  title: string;
  tags: string[];
  description: string;
  complianceWarnings?: string[];
}
type ListingResult = WBListingResult & { highlights: string; bullets: string[] };

function parseWBListingContent(content: string): WBListingResult {
  const trimmed = content.trim();
  let title = "";
  let tags: string[] = [];
  let description = "";
  const titleMatch = trimmed.match(/【商品标题】\s*[:：]?\s*([\s\S]*?)(?=【标签】|【搜索标签】|【商品详情】|【描述】|$)/);
  if (titleMatch) title = titleMatch[1].trim().split("\n")[0].trim();
  const tagsMatch = trimmed.match(/【(?:标签|搜索标签)】\s*[:：]?\s*([\s\S]*?)(?=【商品详情】|【描述】|$)/);
  if (tagsMatch) {
    const raw = tagsMatch[1].trim();
    tags = raw.split(/[,，\n]+/).map(s=>s.trim()).filter(Boolean).slice(0,8);
  }
  const descMatch = trimmed.match(/【(?:商品详情|描述)】\s*[:：]?\s*([\s\S]*)/);
  if (descMatch) description = descMatch[1].trim();
  // Fallback to old highlights/bullets parsing for backward compat
  if (!description) {
    const hlMatch = trimmed.match(/【商品亮点】\s*[:：]?\s*([\s\S]*?)(?=【五点描述】|$)/);
    if (hlMatch) description = hlMatch[1].trim();
  }
  return { title, tags, description };
}

function parseListingContent(content: string): ListingResult {
  const wb = parseWBListingContent(content);
  // Fallback: if WB parse yields empty, try old Amazon parse
  if (!wb.title && !wb.description) {
    const trimmed = content.trim();
    let title = "";
    let highlights = "";
    let bullets: string[] = [];
    const titleMatch = trimmed.match(/【商品标题】\s*[:：]?\s*([\s\S]*?)(?=【商品亮点】|【五点描述】|$)/);
    if (titleMatch) title = titleMatch[1].trim().split("\n")[0].trim();
    const hlMatch = trimmed.match(/【商品亮点】\s*[:：]?\s*([\s\S]*?)(?=【五点描述】|$)/);
    if (hlMatch) highlights = hlMatch[1].trim().split("\n")[0].trim();
    const bMatch = trimmed.match(/【五点描述】\s*[:：]?\s*([\s\S]*)/);
    if (bMatch) bullets = bMatch[1].trim().split("\n").map(l=>l.trim()).filter(Boolean).slice(0,5);
    return { title: wb.title || title, tags: wb.tags, description: wb.description || highlights || bullets.join("\n"), highlights: wb.tags.join(", ") || highlights, bullets };
  }
  return { ...wb, highlights: wb.tags.join(", "), bullets: wb.description.split("\n").filter(Boolean).slice(0,5) };
}

const MODEL_OPTIONS = [
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
  const [platform, setPlatform] = useState<Platform>("WB");
  const [result, setResult] = useState<WBListingResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [copied, setCopied] = useState(false);
  void copied;
  const [error, setError] = useState<string | null>(null);

  // WB校验
  const validateWBTitle = (t: string) => {
    const len = [...t.trim()].length;
    if (!t.trim()) return { valid: false, msg: "标题为空" };
    if (len < 60) return { valid: false, msg: `标题过短 ${len}/60` };
    if (len > 100) return { valid: false, msg: `标题超长 ${len}/100` };
    return { valid: true, msg: `${len}/100` };
  };
  const validateWBT = (r: WBListingResult | null) => {
    if (!r) return { valid: false, warnings: [] as string[] };
    const warnings: string[] = [];
    const tv = validateWBTitle(r.title);
    if (!tv.valid) warnings.push(tv.msg);
    if (r.tags.length < 5) warnings.push(`标签过少 ${r.tags.length}/5`);
    if (r.tags.length > 8) warnings.push(`标签过多 ${r.tags.length}/8`);
    // 俄广告法敏感词示例
    const sensitive = ["гарантия", "лучший", "№1", "бесплатно"];
    const lowerDesc = (r.description + " " + r.title).toLowerCase();
    sensitive.forEach(w => { if (lowerDesc.includes(w)) warnings.push(`命中敏感词: ${w}`); });
    return { valid: warnings.length === 0, warnings };
  };
  const wbValidation = validateWBT(result);

  type Draft = { id: string; timestamp: number; productName: string; sellingPoints: string; platform: Platform; coreKeywords: string; result: WBListingResult | null; selectedModel: string };
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    try { return JSON.parse(localStorage.getItem('listing_drafts') || '[]'); } catch { return []; }
  });
  const [isDraftDrawerOpen, setIsDraftDrawerOpen] = useState(false);
  const draftTimerRef = useRef<number | null>(null);
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
    const fullText = `${result.title} ${result.description}`.toLowerCase();
    const hit = keywordsList.filter(k=> fullText.includes(k.toLowerCase()));
    const missing = keywordsList.filter(k=> !fullText.includes(k.toLowerCase()));
    return { hit: hit.length, total: keywordsList.length, missing, hitList: hit };
  })();

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
    const normalizedPoints = sellingPoints.trim().replace(/[/／]/g, "、").replace(/[,，]/g, "、");
    const platformRule = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS["WB"];
    const systemPrompt = `你是一名精通${platform}的资深运营。当前目标平台为：${platform}。\n【规则】：${platformRule}\n【铁律】：严禁捏造未提及参数；严禁品牌侵权；严禁医疗疗效词；必须输出俄文。\n标签：【商品标题】\n【搜索标签】\n【商品详情】`;
    const userPrompt = `商品名称：${productName.trim()}\n核心卖点：<Product_Facts>${normalizedPoints}</Product_Facts>`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: selectedModel, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], temperature: 0.5, max_tokens: 1800, top_p: 0.85 }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("返回数据为空");
      const parsed = parseListingContent(content) as WBListingResult;
      // Try variants
      try {
        const m = content.match(/\{[\s\S]*"variants"[\s\S]*\}/);
        if (m) {
          const j = JSON.parse(m[0].replace(/```json|```/g, ""));
          if (j.variants && Array.isArray(j.variants) && j.variants.length >= 3) {
            const vs = j.variants.slice(0,3).map((v:any)=>({title: String(v.title||""), highlights: String(v.highlights||""), strategy: String(v.strategy||"")}));
            setVariants(vs);
            setActiveVariant(0);
          } else setVariants(null);
        } else setVariants(null);
      } catch { setVariants(null); }
      setResult(parsed as any);
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error && err.name === "AbortError" ? "请求超时（45s）" : "生成失败";
      setError(msg);
    } finally { setIsGenerating(false); }
  };

  const handleGenerateVariants = async () => {
    if (!apiKey || apiKey.trim() === "") { setError("请先配置 API Key"); return; }
    if (!result) return;
    setIsGenerating(true);
    try {
      const variantPrompt = `基于标题：${result.title} 亮点：${result.tags?.join(",") || ""} 再生成2套变体，策略B-痛点解决风、C-感官营销风，保持卖点：${sellingPoints} 平台：${platform}。以JSON {"variants":[{"strategy":"...","title":"...","highlights":"..."}]} 输出`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: selectedModel, messages: [{ role: "user", content: variantPrompt }], temperature: 0.6, max_tokens: 1000 }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || "";
      const m = content.match(/\{[\s\S]*"variants"[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0].replace(/```json|```/g, ""));
        if (j.variants && Array.isArray(j.variants)) {
          const vs = j.variants.slice(0,2).map((v:any, i:number)=>({title: String(v.title||""), highlights: String(v.highlights||""), strategy: String(v.strategy||`变体${i+2}`)}));
          const cur: Variant = { title: result.title, highlights: result.tags?.join(", ") || "", strategy: "极简参数风" };
          setVariants([cur, ...vs].slice(0,3));
          setActiveVariant(0);
        }
      }
    } catch (e) { console.warn("Variants failed", e); }
    finally { setIsGenerating(false); }
  };

  const handleAutoFix = async () => {
    if (!apiKey || apiKey.trim() === "") { setError("请先配置 API Key"); return; }
    if (!result) return;
    setIsFixing(true);
    setError(null);
    try {
      const currentTab = variants && variants[activeVariant] ? variants[activeVariant] : { title: result.title, highlights: result.tags?.join(", ") || "", strategy: "当前" };
      const userPrompt = `【最高优先级：微创合规清洗任务】
你现在的角色是一位极其严谨的跨境电商风控法务。
以下是当前【唯一】需要修复的商品文案，它已被系统拦截，包含以下致命违规项：
请进行深度语义与侵权盲区审查


【待修复文案】：
[标题]：${currentTab.title}
[亮点]：${currentTab.highlights}
[五点]：${(result as any).bullets?.join('\n') || result.description}


【强制执行铁律】：
1. 定向切除：精准锁定病灶，将违禁声明（如 anti-microbial）和侵权品牌（如 Apple）替换为安全中性的词汇（如 clean and fresh, smart home systems）。
2. 无损替换：严禁推翻重写！必须 100% 保留原有的句式结构、营销逻辑和字符长度。
3. 单一纯净：只需返回这【一套】修复完毕的文案，严禁输出多个变体，严禁在正文外附加任何解释性文字。`;
      const platformRule = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS["WB"];
      const systemPrompt = `你是一名精通多平台出海运营的资深 Listing 专家。当前目标平台为：${platform}。
【当前目标平台专属规则】：${platformRule}
【通用安全与格式铁律】：严禁捏造；严禁品牌侵权；严禁医疗疗效词；必须输出俄文。
必须严格按照标签输出：
【商品标题】
【搜索标签】
【商品详情】`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: selectedModel, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], temperature: 0.5, max_tokens: 2048 }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("返回数据为空");
      const parsed = parseListingContent(content) as any;
      if (variants && variants.length === 3) {
        const newVariants = [...variants];
        newVariants[activeVariant] = { title: parsed.title || currentTab.title, highlights: parsed.highlights || currentTab.highlights, strategy: currentTab.strategy };
        setVariants(newVariants);
        setResult(prev => prev ? { ...prev, title: newVariants[activeVariant].title, tags: newVariants[activeVariant].highlights.split(/[,，]/).map((s:string)=>s.trim()).filter(Boolean) } as any : parsed);
      } else {
        setResult(parsed as any);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && err.name === "AbortError" ? "请求超时（45s）" : "自动修复失败";
      setError(msg);
    } finally { setIsFixing(false); }
  };

  const handleCopy = async () => {
    if (!result) return;
    const text = `标题:\n${result.title}\n\n标签:\n${result.tags?.join(", ") || ""}\n\n详情:\n${result.description}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const handleExport = async () => {
    if (!result) return;
    const XLSX = await import("xlsx");
    const isWB = platform === "WB";
    const sheetData: Record<string, string>[] = [{
      "Title": result.title,
      "Tags": result.tags?.join(", ") || "",
      "Description": result.description,
      "Platform": platform,
    }];
    if (variants && variants.length) {
      variants.forEach((v,i)=>{
        sheetData.push({ "Title": v.title, "Tags": v.highlights, "Description": result.description, "Platform": `${platform} - 变体${i+1} ${v.strategy}` });
      });
    }
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isWB ? "WB" : "Ozon");
    XLSX.writeFile(wb, `${platform}_${Date.now()}.xlsx`);
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
              <h1 className="text-[17px] font-semibold leading-none text-slate-900">Wildberries 运营工作台</h1>
              <p className="mt-1 hidden text-xs text-slate-500 sm:block">WB 60-100标题 · 5-8标签 · 俄文详情</p>
            </div>
          </div>
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
                <div className="flex gap-2">
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="填入硅基流动 sk-...（仅本地存储）" className="flex-1 bg-white rounded-lg border border-amber-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                  <button onClick={() => { localStorage.setItem('siliconflow_key', apiKey); const el=document.createElement('div'); el.textContent='已保存'; el.className='fixed top-4 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50'; document.body.appendChild(el); setTimeout(()=>el.remove(),1500); }} className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 whitespace-nowrap">保存</button>
                </div>
                <p className="mt-1 text-xs text-slate-400">仅本地存储，不上传服务器 · 修改后点保存</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">模型选择</label>
                <select value={selectedModel} onChange={(e) => { setSelectedModel(e.target.value); localStorage.setItem('siliconflow_model', e.target.value); }} className="w-full bg-white rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100">
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
            <p className="mt-1 text-sm text-slate-500">填写后生成 WB/Ozon 俄文 Listing</p>
            <div className="mt-6 space-y-5">
              <div><label className="mb-2 block text-sm font-medium text-slate-700">产品中文名称 <span className="text-red-500">*</span></label><input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="例如：不锈钢保温杯" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">中文核心卖点 <span className="text-red-500">*</span></label><textarea value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} placeholder="例如：316不锈钢，24小时保温..." rows={4} className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /><p className="mt-2 text-xs text-slate-400">用逗号或换行分隔</p></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">核心搜索词（SEO）</label><input value={coreKeywords} onChange={(e) => setCoreKeywords(e.target.value)} placeholder="例如：термос, стальной（逗号分隔）" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100" /><p className="mt-1 text-xs text-slate-400">用于标题/详情埋词高亮</p></div>
              <div><label className="mb-2 block text-sm font-medium text-slate-700">目标平台</label><div className="relative"><select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100">{PLATFORM_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}</select><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></span></div><p className="mt-2 text-xs text-slate-400">{PLATFORM_OPTIONS.find((o) => o.value === platform)?.hint}</p></div>
              <button onClick={handleGenerate} disabled={!canGenerate || isGenerating || isFixing} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isGenerating ? (<><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />生成中...</>) : "生成 WB Listing"}</button>
              <button onClick={()=>setIsDraftDrawerOpen(true)} className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">📋 历史草稿箱 ({drafts.length}/10)</button>
              <p className="text-center text-xs text-slate-400">WB 60-100标题 · 5-8标签 · 自动保存5秒</p>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><h2 className="text-sm font-semibold text-slate-900">生成结果</h2><div className="flex items-center gap-2"><button onClick={handleAutoFix} disabled={!result || isFixing || isGenerating} className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">{isFixing ? "修复中..." : "⚡ 一键合规修复"}</button><button onClick={handleCopy} disabled={!result} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">一键复制</button></div></div>
            <div className="p-6">
              {error ? (<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center"><p className="text-sm font-medium text-red-700">生成失败</p><p className="mt-2 text-xs text-red-500">{error}</p></div>) : !result ? (<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center"><p className="mt-4 text-sm font-medium text-slate-700">暂无生成结果</p></div>) : (<div className="space-y-6">
                {variants && variants.length===3 && (<div className="flex gap-2 p-1 bg-slate-100 rounded-xl">{variants.map((v,i)=> <button key={i} onClick={()=>{setActiveVariant(i); setResult(prev=> prev ? {...prev, title: v.title, highlights: v.highlights} as any : prev);}} className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition ${activeVariant===i?"bg-white shadow text-violet-700":"text-slate-600 hover:bg-white/50"}`}>{`变体${i+1}·${v.strategy}`}</button>)}</div>)}
                {!variants && result && <button onClick={handleGenerateVariants} disabled={isGenerating} className="w-full py-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-sm font-medium hover:bg-violet-100">✨ 再生成2套变体对比</button>}
                {coverage && (<div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between"><div className="text-sm"><span className="font-medium text-blue-900">SEO 覆盖率：</span><span className="text-blue-700">已埋入 {coverage.hit}/{coverage.total}</span>{coverage.missing.length>0 && <span className="text-amber-700"> 未命中：{coverage.missing.join(", ")}</span>}</div></div>)}
                <div><h3 className="text-sm font-semibold text-slate-900 mb-2">标题 {validateWBTitle(result.title).msg}</h3><div className="rounded-xl border p-4 text-sm bg-slate-50">{highlightKeywords(result.title)}</div></div>
                <div><h3 className="text-sm font-semibold text-slate-900 mb-2">标签 ({result.tags.length}/8)</h3><div className="rounded-xl border p-4 text-sm bg-slate-50">{result.tags.join(", ")}</div></div>
                <div><h3 className="text-sm font-semibold text-slate-900 mb-2">详情</h3><div className="rounded-xl border p-4 text-sm bg-slate-50 whitespace-pre-wrap">{highlightKeywords(result.description)}</div></div>
                {wbValidation.warnings.length>0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{wbValidation.warnings.join("; ")}</div>}
              </div>)}
            </div>
          </section>
        </div>
        <div className="mt-6 flex justify-center">
          <button onClick={handleExport} disabled={!result} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300">📊 一键导出为刊登模板 (.xlsx)</button>
        </div>
        <p className="mt-3 text-center text-xs text-slate-400">WB 60-100标题 · 5-8标签 · 密钥本地存储</p>
      </main>
      {isDraftDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={()=>setIsDraftDrawerOpen(false)} />
          <div className="w-96 max-w-[85vw] bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200"><h3 className="font-semibold text-slate-900">历史草稿箱</h3><button onClick={()=>setIsDraftDrawerOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button></div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {drafts.length===0 ? <p className="text-sm text-slate-400 text-center py-8">暂无草稿</p> : drafts.map(d=> (
                <div key={d.id} className="rounded-xl border border-slate-200 p-3 hover:border-violet-200 hover:bg-violet-50/50 transition">
                  <div className="flex items-center justify-between mb-1"><span className="text-xs font-medium text-slate-700 truncate pr-2">{d.productName || "未命名"}</span><span className="text-xs text-slate-400 whitespace-nowrap">{new Date(d.timestamp).toLocaleString()}</span></div>
                  <p className="text-xs text-slate-500 line-clamp-2">{d.sellingPoints.slice(0,60) || "无卖点"}</p>
                  <div className="flex gap-2 mt-2"><button onClick={()=>restoreDraft(d)} className="flex-1 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700">恢复</button><button onClick={()=>deleteDraft(d.id)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">删除</button></div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-100"><button onClick={()=>{localStorage.removeItem('listing_drafts'); setDrafts([]);}} className="w-full py-2 rounded-lg border border-rose-200 text-rose-600 text-xs hover:bg-rose-50">清空全部</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
