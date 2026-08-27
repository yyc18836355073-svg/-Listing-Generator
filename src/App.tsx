import React, { useState } from 'react';
import { validateAllBullets } from './lib/bulletValidator';
import type { BulletValidationResult } from './lib/bulletValidator';

// 计算 UTF-8 字节长度（亚马逊 Search Terms 严格以字节计算）
function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

// 安全提取正则捕获组文本（严格类型校验）
function getMatchedGroup(str: string, regex: RegExp): string {
  const match: RegExpExecArray | null = regex.exec(str);
  
  // 校验 match 是否存在，以及我们需要的捕获组（通常是 match[1]）是否存在
  if (!match || !match[1]) {
    return '';
  }
  
  // 直接对捕获到的字符串执行 trim
  return match[1].trim();
}

// 智能提取五点（精准按 1-5 序号分割，即使内部换行也会自动合并为 5 条）
function parseBulletPoints(rawBulletsText: string): string[] {
  if (!rawBulletsText) return [];
  const segments: string[] = rawBulletsText
    .split(/(?:^|\n)\s*(?:\d+[\.、\)]|Point\s*\d+[:\.]?|【\d+】)\s*/i)
    .map((s: string) => s.trim())
    .filter((s: string) => Boolean(s));

  return segments.slice(0, 5).map((item: string) => {
    return item.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  });
}

// 清理 Search Terms，剔除提示词残留并去重
function cleanSearchTerms(rawSt: string, titleText: string): string {
  if (!rawSt) return '';
  let cleaned: string = rawSt
    .replace(/\b(249|250)\s*(bytes?|字节)?\b/gi, '')
    .replace(/\b(search\s*terms?|后台搜索词|搜索词)\b/gi, '')
    .replace(/[:：]/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words: string[] = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  const titleWords: Set<string> = new Set(titleText.toLowerCase().split(/\s+/).filter(Boolean));
  
  const uniqueWords: string[] = [];
  const seen: Set<string> = new Set();
  for (const w of words) {
    if (!seen.has(w) && !titleWords.has(w) && w.length > 1) {
      seen.add(w);
      uniqueWords.push(w);
    }
  }

  let result: string = '';
  for (const w of uniqueWords) {
    const candidate: string = result ? `${result} ${w}` : w;
    if (getByteLength(candidate) <= 249) {
      result = candidate;
    } else {
      break;
    }
  }

  return result || cleaned;
}

export function App() {
  const [productName, setProductName] = useState<string>('');
  const [sellingPoints, setSellingPoints] = useState<string>('');
  const [platform, setPlatform] = useState<string>('amazon-us');
  const [loading, setLoading] = useState<boolean>(false);
  const [fixing, setFixing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // 解析后的 Listing 各字段状态
  const [title, setTitle] = useState<string>('');
  const [highlights, setHighlights] = useState<string[]>([]);
  const [bullets, setBullets] = useState<string[]>([]);
  const [searchTerms, setSearchTerms] = useState<string>('');
  const [bulletValidation, setBulletValidation] = useState<{
    results: BulletValidationResult[];
    totalCharCount: number;
    isAllValid: boolean;
    generalWarnings: string[];
  } | null>(null);

  // 一键复制辅助函数
  const copyToClipboard = (text: string, sectionKey: string): void => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionKey);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  // 生成全部文案合并内容
  const getAllContentText = (): string => {
    let text: string = `【商品标题】\n${title}\n\n【商品亮点】\n${highlights.join('\n')}\n\n【五点描述】\n`;
    text += bullets.map((b: string, i: number) => `${i + 1}. ${b}`).join('\n');
    if (searchTerms) {
      text += `\n\n【Search Terms 后台搜索词】\n${searchTerms}`;
    }
    return text;
  };

  // 解析大模型返回的标签内容
  const parseAIResult = (raw: string): void => {
    const parsedTitle: string = getMatchedGroup(raw, /【商品标题】\s*([\s\S]*?)(?=【商品亮点】|【五点描述】|【搜索词】|$)/);
    
    const hlText: string = getMatchedGroup(raw, /【商品亮点】\s*([\s\S]*?)(?=【五点描述】|【搜索词】|$)/);
    const parsedHighlights: string[] = hlText
      ? hlText
          .split('\n')
          .map((line: string) => line.replace(/^(\d+[\.、\)]|[-*•])\s*/, '').trim())
          .filter((line: string) => Boolean(line))
      : [];

    const bulletText: string = getMatchedGroup(raw, /【五点描述】\s*([\s\S]*?)(?=【搜索词】|$)/);
    const parsedBullets: string[] = parseBulletPoints(bulletText);

    const rawSt: string = getMatchedGroup(raw, /【搜索词】\s*([\s\S]*?)$/);
    const parsedSearchTerms: string = cleanSearchTerms(rawSt, parsedTitle);

    setTitle(parsedTitle);
    setHighlights(parsedHighlights);
    setBullets(parsedBullets);
    setSearchTerms(parsedSearchTerms);

    if (parsedBullets.length > 0) {
      const validation = validateAllBullets(parsedBullets);
      setBulletValidation(validation);
    }
  };

  // ================= 核心：一键合规修复逻辑 =================
  const handleAutoFix = async () => {
    // 防呆：如果根本没有生成过数据，直接退出
    if (!title && bullets.length === 0) return; 

    // 触发你第 78 行预留的 loading 状态
    setFixing(true);
    setError('');

    try {
      // 1. 将你散落在各处的旧数据打包
      const currentListingData = {
        title: title,
        highlights: highlights,
        bullets: bullets,
        searchTerms: searchTerms
      };

      // 2. 提取当前违规的警告信息（假设存在你第 91 行的 generalWarnings 里）
      const currentViolations = bulletValidation?.generalWarnings || [];

      // 3. 向你的 Serverless 后端发送抢救请求
      const response = await fetch('/api/generate', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'autoFix',             // 触发后端的一键修复分支
          platform: platform,            // 对应你第 76 行的站点变量
          currentListing: currentListingData, 
          violations: currentViolations  
        })
      });

      if (!response.ok) throw new Error('网络超时或后端修复失败');
      
      const fixedData = await response.json();

      // 4. 用后端洗白后的合规数据，强行覆盖页面的旧状态
      if (fixedData.title) setTitle(fixedData.title);
      if (fixedData.highlights) setHighlights(fixedData.highlights);
      if (fixedData.bullets) setBullets(fixedData.bullets);
      if (fixedData.searchTerms) setSearchTerms(fixedData.searchTerms);

      // 5. 修复成功后，强行清空页面的飘红报警状态
      setBulletValidation(null); 

    } catch (err: any) {
      console.error("修复失败:", err);
      setError(err.message || "自动修复失败，请重试");
    } finally {
      // 关闭你第 78 行的 loading 状态
      setFixing(false);
    }
  };
  // ========================================================

  // 提交生成请求
  const handleGenerate = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!productName.trim() || !sellingPoints.trim()) {
      setError('请填写商品名称和核心卖点');
      return;
    }

    setLoading(true);
    setError('');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName, sellingPoints, platform }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = (await res.json()) as { error?: string; details?: string; result?: string };

      if (!res.ok) {
        throw new Error(data.error || data.details || '生成失败，请重试');
      }

      if (data.result) {
        parseAIResult(data.result);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          setError('请求超时（45秒），大模型响应较慢，请稍后重试');
        } else {
          setError(err.message || '网络请求异常');
        }
      } else {
        setError('未知错误，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  // 【一键合规智能修复】
  const handleAutoFix = async (): Promise<void> => {
    const collectedViolations: string[] = [];
    if (title.length > 200) {
      collectedViolations.push(`标题长度（${title.length} 字符）超过 200 字符上限，需精简`);
    }
    if (bullets.length !== 5) {
      collectedViolations.push(`五点数量当前为 ${bullets.length} 条，需严格规范为 5 条`);
    }
    if (bulletValidation) {
      bulletValidation.results.forEach((r, idx) => {
        if (r.errors.length > 0) {
          collectedViolations.push(`Point ${idx + 1} 错误: ${r.errors.join('; ')}`);
        }
        if (r.charCount < 120 || r.charCount > 220) {
          collectedViolations.push(`Point ${idx + 1} 字数（${r.charCount} 字符）偏离推荐的 120-220 字符范围`);
        }
      });
      if (bulletValidation.totalCharCount > 1000) {
        collectedViolations.push(`五点总字数（${bulletValidation.totalCharCount} 字符）超过 1000 字符限制`);
      }
    }
    if (getByteLength(searchTerms) > 249) {
      collectedViolations.push(`Search Terms（${getByteLength(searchTerms)} Bytes）超过 249 字节限制`);
    }

    setFixing(true);
    setError('');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'autoFix',
          platform,
          currentListing: { title, highlights, bullets, searchTerms },
          violations: collectedViolations,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = (await res.json()) as { error?: string; details?: string; result?: string };

      if (!res.ok) {
        throw new Error(data.error || data.details || '自动修复失败，请重试');
      }

      if (data.result) {
        parseAIResult(data.result);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(`修复异常: ${err.message}`);
      } else {
        setError('自动修复失败，请重试');
      }
    } finally {
      setFixing(false);
    }
  };

  const stByteLength: number = getByteLength(searchTerms);
  const isStOverLimit: boolean = stByteLength > 249;
  const isOverallCompliant: boolean = Boolean(
    title &&
    title.length <= 200 &&
    bullets.length === 5 &&
    bulletValidation?.isAllValid &&
    (bulletValidation?.totalCharCount ?? 0) <= 1000 &&
    !isStOverLimit
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 顶部标题栏 */}
        <header className="text-center space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            跨境电商 AI Listing 智能合规生成器
          </h1>
          <p className="text-sm text-slate-500">
            内置亚马逊 2024/2026 最新合规校验引擎 · 违规词替换 · 一键智能修复 · 智能五点聚合
          </p>
        </header>

        {/* 输入表单 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 sm:p-6">
          <form onSubmit={handleGenerate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  商品名称 / 品类核心词 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProductName(e.target.value)}
                  placeholder="例如：Stainless Steel Insulated Water Bottle 32oz"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  disabled={loading || fixing}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">目标平台 / 站点</label>
                <select
                  value={platform}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPlatform(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  disabled={loading || fixing}
                >
                  <option value="amazon-us">Amazon 美国站 (US)</option>
                  <option value="amazon-de">Amazon 德国站 (DE)</option>
                  <option value="amazon-uk">Amazon 英国站 (UK)</option>
                  <option value="amazon-jp">Amazon 日本站 (JP)</option>
                  <option value="temu">Temu 平台</option>
                  <option value="tiktok-shop">TikTok Shop</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                核心卖点 / 参数与规格 <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={sellingPoints}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSellingPoints(e.target.value)}
                rows={4}
                placeholder="例如：
1. 316食品级不锈钢内胆，24小时保温/12小时保冷
2. 双层真空锁温，防漏手柄盖，带吸管
3. 容积 32oz / 1000ml，附带清洁刷"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                disabled={loading || fixing}
              />
            </div>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || fixing}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg text-sm shadow transition-colors flex items-center justify-center space-x-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>正在合规生成中（包含违规词校验与 Search Terms）...</span>
                </>
              ) : (
                <span>立即生成高转化 Listing</span>
              )}
            </button>
          </form>
        </div>

        {/* 结果展示区 */}
        {(title || bullets.length > 0 || searchTerms) && (
          <div className="space-y-5">
            {/* 顶栏操作与【一键合规修复按钮】 */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-semibold text-slate-800">生成结果与合规检查</span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${isOverallCompliant ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                  {isOverallCompliant ? '✓ 完美合规' : '⚠️ 需要检查'}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                {/* 仅在不合规时高亮显示【一键修复按钮】 */}
                {!isOverallCompliant && (
                  <button
                    type="button"
                    onClick={handleAutoFix}
                    disabled={fixing || loading}
                    className="text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-md font-medium shadow-sm transition-colors flex items-center space-x-1"
                  >
                    {fixing ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>正在智能合规修复...</span>
                      </>
                    ) : (
                      <span>⚡ 一键合规修复 (替换违禁词 & 压缩字数)</span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => copyToClipboard(getAllContentText(), 'all')}
                  className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium transition-colors"
                >
                  {copiedSection === 'all' ? '✓ 已复制全部内容' : '📋 一键复制全部'}
                </button>
                <button
  onClick={handleAutoFix}
  disabled={fixing}
  className="ml-3 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded hover:bg-amber-600 disabled:opacity-50 transition-colors"
>
  {fixing ? '✨ AI 紧急修复中...' : '🛠️ 一键合规重写'}
              </button>
              </div>
            </div>

            {/* 1. 商品标题 */}
            {title && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-semibold text-slate-800 text-sm">【商品标题】</h3>
                    <span className={`text-xs px-2 py-0.5 rounded font-mono ${title.length <= 200 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {title.length} / 200 字符
                    </span>
                    {title.length > 75 && (
                      <span className="text-xs text-slate-400 hidden sm:inline">
                        (前 75 字符将在移动端首屏展示)
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(title, 'title')}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {copiedSection === 'title' ? '✓ 已复制' : '复制标题'}
                  </button>
                </div>
                <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 leading-relaxed font-sans select-all">
                  {title}
                </p>
              </div>
            )}

            {/* 2. 商品亮点 */}
            {highlights.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800 text-sm">【核心亮点】</h3>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(highlights.join('\n'), 'highlights')}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {copiedSection === 'highlights' ? '✓ 已复制' : '复制亮点'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {highlights.map((hl: string, i: number) => (
                    <div key={i} className="text-xs text-slate-700 bg-blue-50 border border-blue-100 p-2.5 rounded-lg">
                      <div className="flex items-center justify-between text-slate-400 mb-1 text-[10px]">
                        <span>亮点 {i + 1}</span>
                        <span>{hl.length} 字符</span>
                      </div>
                      <p className="font-medium text-slate-800">{hl}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. 五点描述与合规校验 */}
            {bullets.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-semibold text-slate-800 text-sm">【五点描述 Bullet Points】</h3>
                    {bulletValidation && (
                      <span className={`text-xs px-2 py-0.5 rounded font-mono ${bulletValidation.totalCharCount <= 1000 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        共 {bullets.length} 条 · 总计 {bulletValidation.totalCharCount} / 1000 字符
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(bullets.map((b: string, i: number) => `${i + 1}. ${b}`).join('\n'), 'bullets')}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {copiedSection === 'bullets' ? '✓ 已复制' : '复制五点'}
                  </button>
                </div>

                <div className="space-y-3">
                  {bullets.map((bullet: string, index: number) => {
                    const val = bulletValidation?.results[index];
                    const isLengthOk = bullet.length >= 120 && bullet.length <= 250;
                    return (
                      <div key={index} className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span className="font-medium text-slate-700">Point {index + 1}</span>
                          <span className={`font-mono ${isLengthOk ? 'text-emerald-700' : 'text-amber-600'}`}>
                            {bullet.length} 字符 {isLengthOk ? '(合规)' : '(建议 120-220 字符)'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-800 leading-relaxed select-all">{bullet}</p>

                        {/* 违规错误提示 */}
                        {val && val.errors.length > 0 && (
                          <div className="space-y-1">
                            {val.errors.map((err: string, ei: number) => (
                              <div key={ei} className="text-xs text-rose-700 bg-rose-50 px-2 py-1 rounded border border-rose-200">
                                ❌ {err}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 警告提示 */}
                        {val && val.warnings.length > 0 && (
                          <div className="space-y-1">
                            {val.warnings.map((warn: string, wi: number) => (
                              <div key={wi} className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                                ⚠️ {warn}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4. Search Terms 后台搜索词 */}
            {searchTerms && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-semibold text-slate-800 text-sm">【后台 Search Terms】</h3>
                    <span className={`text-xs px-2 py-0.5 rounded font-mono font-medium ${!isStOverLimit ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {stByteLength} / 249 字节 (Bytes) {!isStOverLimit ? '✓ 合规' : '❌ 超限'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(searchTerms, 'st')}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {copiedSection === 'st' ? '✓ 已复制' : '复制搜索词'}
                  </button>
                </div>
                <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 leading-relaxed font-mono select-all break-all">
                  {searchTerms}
                </p>
                <p className="text-xs text-slate-400">
                  💡 提示：系统已自动去除标题重复词并清理掉特殊字符，可直接一键复制到亚马逊后台使用。
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
