import React, { useState } from 'react';
import {
  validateAllBullets,
  type BulletValidationResult,
} from './lib/bulletValidator';

function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

function getTitleStatus(length: number) {
  if (length === 0) {
    return {
      text: '未生成',
      className: 'bg-slate-100 text-slate-600',
    };
  }

  if (length > 200) {
    return {
      text: `${length} / 200 字符 · 超限`,
      className: 'bg-rose-100 text-rose-700',
    };
  }

  if (length > 180) {
    return {
      text: `${length} / 200 字符`,
      className: 'bg-amber-100 text-amber-700',
    };
  }

  return {
    text: `${length} / 200 字符`,
    className: 'bg-emerald-100 text-emerald-700',
  };
}

function getSearchTermStatus(bytes: number) {
  if (bytes === 0) {
    return {
      text: '0 / 249 Bytes',
      className: 'bg-slate-100 text-slate-600',
    };
  }

  if (bytes > 249) {
    return {
      text: `${bytes} / 249 Bytes · 超限`,
      className: 'bg-rose-100 text-rose-700',
    };
  }

  if (bytes >= 230) {
    return {
      text: `${bytes} / 249 Bytes · 接近上限`,
      className: 'bg-amber-100 text-amber-700',
    };
  }

  return {
    text: `${bytes} / 249 Bytes · 合规`,
    className: 'bg-emerald-100 text-emerald-700',
  };
}

export function App() {
  const [productName, setProductName] =
    useState<string>('');

  const [sellingPoints, setSellingPoints] =
    useState<string>('');

  const [platform, setPlatform] =
    useState<string>('amazon-us');

  const [loading, setLoading] =
    useState<boolean>(false);

  const [error, setError] =
    useState<string>('');

  const [copiedSection, setCopiedSection] =
    useState<string | null>(null);

  const [title, setTitle] =
    useState<string>('');

  const [highlights, setHighlights] =
    useState<string[]>([]);

  const [bullets, setBullets] =
    useState<string[]>([]);

  const [searchTerms, setSearchTerms] =
    useState<string>('');

  const [bulletValidation, setBulletValidation] =
    useState<{
      results: BulletValidationResult[];
      totalCharCount: number;
      isAllValid: boolean;
      generalWarnings: string[];
    } | null>(null);

  const copyToClipboard = async (
    text: string,
    sectionKey: string
  ) => {
    try {
      await navigator.clipboard.writeText(text);

      setCopiedSection(sectionKey);

      setTimeout(() => {
        setCopiedSection(null);
      }, 2000);
    } catch {
      setError('复制失败，请手动选择文字复制');
    }
  };

  const getAllContentText = () => {
    let text = '';

    if (title) {
      text += `【商品标题】\n${title}\n\n`;
    }

    if (highlights.length > 0) {
      text += `【核心亮点】\n`;
      text += highlights.join('\n');
      text += '\n\n';
    }

    if (bullets.length > 0) {
      text += `【五点描述】\n`;
      text += bullets
        .map(
          (bullet, index) =>
            `${index + 1}. ${bullet}`
        )
        .join('\n');

      text += '\n\n';
    }

    if (searchTerms) {
      text += `【Search Terms】\n${searchTerms}`;
    }

    return text.trim();
  };

  const parseAIResult = (raw: string) => {
    const titleMatch = raw.match(
      /【商品标题】\s*([\s\S]*?)(?=【商品亮点】|【核心亮点】|【五点描述】|【搜索词】|$)/
    );

    const highlightMatch = raw.match(
      /(?:【商品亮点】|【核心亮点】)\s*([\s\S]*?)(?=【五点描述】|【搜索词】|$)/
    );

    const bulletMatch = raw.match(
      /【五点描述】\s*([\s\S]*?)(?=【搜索词】|$)/
    );

    const searchMatch = raw.match(
      /【搜索词】\s*([\s\S]*?)$/
    );

    const parsedTitle =
      titleMatch?.[1]?.trim() || '';

    const parsedHighlights =
      highlightMatch?.[1]
        ? highlightMatch[1]
            .split('\n')
            .map((line) =>
              line
                .replace(
                  /^[-*•\d]+[.)、\s]*/,
                  ''
                )
                .trim()
            )
            .filter(Boolean)
        : [];

    const parsedBullets =
      bulletMatch?.[1]
        ? bulletMatch[1]
            .split('\n')
            .map((line) =>
              line
                .replace(
                  /^\d+[.)、\s]*/,
                  ''
                )
                .trim()
            )
            .filter(Boolean)
        : [];

    const parsedSearchTerms =
      searchMatch?.[1]
        ?.trim()
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ') || '';

    setTitle(parsedTitle);

    setHighlights(parsedHighlights);

    setBullets(parsedBullets);

    setSearchTerms(parsedSearchTerms);

    if (parsedBullets.length > 0) {
      const validation =
        validateAllBullets(
          parsedBullets
        );

      setBulletValidation(validation);
    } else {
      setBulletValidation(null);
    }
  };

  const handleGenerate = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (!productName.trim()) {
      setError(
        '请填写商品名称或品类核心词'
      );
      return;
    }

    if (!sellingPoints.trim()) {
      setError(
        '请填写核心卖点、参数或规格'
      );
      return;
    }

    setLoading(true);
    setError('');

    setTitle('');
    setHighlights([]);
    setBullets([]);
    setSearchTerms('');
    setBulletValidation(null);

    const controller =
      new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 60000);

    try {
      const response = await fetch(
        '/api/generate',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            productName,
            sellingPoints,
            platform,
          }),
          signal: controller.signal,
        }
      );

      const data = await response.json();

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          data?.error ||
            'AI 生成失败，请稍后重试'
        );
      }

      if (!data?.result) {
        throw new Error(
          'AI 没有返回有效内容'
        );
      }

      parseAIResult(data.result);
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (
        err instanceof Error &&
        err.name === 'AbortError'
      ) {
        setError(
          '生成时间较长，请检查网络后重新生成'
        );
      } else if (err instanceof Error) {
        setError(
          err.message ||
            '生成失败，请重新尝试'
        );
      } else {
        setError(
          '生成失败，请重新尝试'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const titleStatus =
    getTitleStatus(title.length);

  const searchBytes =
    getByteLength(searchTerms);

  const searchStatus =
    getSearchTermStatus(searchBytes);

  const allValid =
    bulletValidation?.isAllValid &&
    bullets.length === 5;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* ========================= */}
        {/* Header */}
        {/* ========================= */}

        <header className="text-center space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            跨境电商 AI Listing 智能生成器
          </h1>

          <p className="text-sm text-slate-500">
            Amazon Listing · 五点描述 · Search Terms · 合规检查
          </p>
        </header>

        {/* ========================= */}
        {/* 输入区域 */}
        {/* ========================= */}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6">

          <form
            onSubmit={handleGenerate}
            className="space-y-5"
          >

            {/* 商品名称 */}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                商品名称 / 品类核心词
                <span className="text-rose-500 ml-1">
                  *
                </span>
              </label>

              <input
                type="text"
                value={productName}
                onChange={(e) =>
                  setProductName(
                    e.target.value
                  )
                }
                placeholder="例如：Portable Bluetooth Speaker"
                disabled={loading}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-100"
              />
            </div>

            {/* 平台 */}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                目标平台 / 站点
              </label>

              <select
                value={platform}
                onChange={(e) =>
                  setPlatform(
                    e.target.value
                  )
                }
                disabled={loading}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="amazon-us">
                  Amazon 美国站 (US)
                </option>

                <option value="amazon-de">
                  Amazon 德国站 (DE)
                </option>

                <option value="amazon-uk">
                  Amazon 英国站 (UK)
                </option>

                <option value="amazon-jp">
                  Amazon 日本站 (JP)
                </option>

                <option value="temu">
                  Temu
                </option>

                <option value="tiktok-shop">
                  TikTok Shop
                </option>
              </select>

              <p className="mt-2 text-xs text-slate-400">
                当前版本以 Amazon US 的 Listing
                规则作为主要优化目标。
              </p>
            </div>

            {/* 卖点 */}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                核心卖点 / 参数与规格
                <span className="text-rose-500 ml-1">
                  *
                </span>
              </label>

              <textarea
                value={sellingPoints}
                onChange={(e) =>
                  setSellingPoints(
                    e.target.value
                  )
                }
                rows={7}
                disabled={loading}
                placeholder={`例如：

30W output power
12 hour playback
IP67 waterproof
Bluetooth 5.1
USB-C charging
Portable outdoor design
Dimensions: 7 x 2.6 x 2.8 inches`}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y disabled:bg-slate-100"
              />

              <p className="mt-2 text-xs text-slate-400">
                参数越完整，AI 越不容易编造产品信息。
              </p>
            </div>

            {/* Error */}

            {error && (
              <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">
                <div className="font-semibold mb-1">
                  生成失败
                </div>

                <div>
                  {error}
                </div>
              </div>
            )}

            {/* Button */}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl shadow-sm transition flex items-center justify-center"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5 mr-2"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />

                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>

                  正在生成 Listing...
                </>
              ) : (
                '立即生成高转化 Listing'
              )}
            </button>

          </form>
        </div>

        {/* ========================= */}
        {/* 结果区域 */}
        {/* ========================= */}

        {(title ||
          bullets.length > 0 ||
          searchTerms) && (

          <div className="space-y-5">

            {/* 总状态 */}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">

                <div>
                  <div className="font-semibold text-slate-900">
                    生成结果与合规检查
                  </div>

                  <div className="text-xs text-slate-500 mt-1">
                    AI 生成后再次进行前端规则检查
                  </div>
                </div>

                <div className="flex items-center gap-2">

                  <span
                    className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                      allValid
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {allValid
                      ? '✓ 基础检查通过'
                      : '⚠ 需要检查'}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        getAllContentText(),
                        'all'
                      )
                    }
                    className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium"
                  >
                    {copiedSection ===
                    'all'
                      ? '✓ 已复制'
                      : '一键复制全部'}
                  </button>

                </div>

              </div>

            </div>

            {/* ========================= */}
            {/* 标题 */}
            {/* ========================= */}

            {title && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">

                <div className="flex items-center justify-between gap-3 mb-3">

                  <div className="flex items-center gap-2">

                    <h3 className="font-semibold text-slate-900">
                      【商品标题】
                    </h3>

                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-mono ${titleStatus.className}`}
                    >
                      {titleStatus.text}
                    </span>

                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        title,
                        'title'
                      )
                    }
                    className="text-xs text-blue-600 font-medium"
                  >
                    {copiedSection ===
                    'title'
                      ? '✓ 已复制'
                      : '复制标题'}
                  </button>

                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm leading-7 select-all">
                  {title}
                </div>

              </div>
            )}

            {/* ========================= */}
            {/* 核心亮点 */}
            {/* ========================= */}

            {highlights.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">

                <div className="flex items-center justify-between mb-3">

                  <h3 className="font-semibold text-slate-900">
                    【核心亮点】
                  </h3>

                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        highlights.join('\n'),
                        'highlights'
                      )
                    }
                    className="text-xs text-blue-600 font-medium"
                  >
                    {copiedSection ===
                    'highlights'
                      ? '✓ 已复制'
                      : '复制亮点'}
                  </button>

                </div>

                <div className="space-y-2">

                  {highlights.map(
                    (highlight, index) => (
                      <div
                        key={index}
                        className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm"
                      >
                        {highlight}
                      </div>
                    )
                  )}

                </div>

              </div>
            )}

            {/* ========================= */}
            {/* 五点 */}
            {/* ========================= */}

            {bullets.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">

                  <div className="flex items-center gap-2 flex-wrap">

                    <h3 className="font-semibold text-slate-900">
                      【五点描述 Bullet Points】
                    </h3>

                    {bulletValidation && (
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-mono ${
                          bulletValidation.totalCharCount <=
                          1000
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        总计{' '}
                        {
                          bulletValidation.totalCharCount
                        }{' '}
                        / 1000 字符
                      </span>
                    )}

                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        bullets
                          .map(
                            (bullet, index) =>
                              `${index + 1}. ${bullet}`
                          )
                          .join('\n'),
                        'bullets'
                      )
                    }
                    className="text-xs text-blue-600 font-medium"
                  >
                    {copiedSection ===
                    'bullets'
                      ? '✓ 已复制'
                      : '复制五点'}
                  </button>

                </div>

                {/* 五点数量 */}

                {bullets.length !== 5 && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                    当前生成了{' '}
                    {bullets.length}
                    条，建议保持 5 条。
                  </div>
                )}

                <div className="space-y-3">

                  {bullets.map(
                    (bullet, index) => {

                      const validation =
                        bulletValidation
                          ?.results[index];

                      return (
                        <div
                          key={index}
                          className={`rounded-xl border p-4 ${
                            validation?.isValid
                              ? 'bg-slate-50 border-slate-200'
                              : 'bg-rose-50 border-rose-200'
                          }`}
                        >

                          <div className="flex items-center justify-between mb-2">

                            <span className="font-semibold text-sm text-slate-700">
                              Point {index + 1}
                            </span>

                            <span className="text-xs font-mono text-slate-500">
                              {bullet.length}{' '}
                              字符
                            </span>

                          </div>

                          <div className="text-sm leading-7 select-all">
                            {bullet}
                          </div>

                          {validation &&
                            validation.errors
                              .length >
                              0 && (

                              <div className="mt-3 space-y-1">

                                {validation.errors.map(
                                  (
                                    warning,
                                    errorIndex
                                  ) => (
                                    <div
                                      key={
                                        errorIndex
                                      }
                                      className="text-xs text-rose-700"
                                    >
                                      ❌{' '}
                                      {warning}
                                    </div>
                                  )
                                )}

                              </div>
                            )}

                          {validation &&
                            validation.warnings
                              .length >
                              0 && (

                              <div className="mt-2 space-y-1">

                                {validation.warnings.map(
                                  (
                                    warning,
                                    warningIndex
                                  ) => (
                                    <div
                                      key={
                                        warningIndex
                                      }
                                      className="text-xs text-amber-700"
                                    >
                                      ⚠️{' '}
                                      {warning}
                                    </div>
                                  )
                                )}

                              </div>
                            )}

                        </div>
                      );
                    }
                  )}

                </div>

                {/* 总体警告 */}

                {bulletValidation &&
                  bulletValidation
                    .generalWarnings.length >
                    0 && (

                    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">

                      {bulletValidation.generalWarnings.map(
                        (
                          warning,
                          index
                        ) => (
                          <div
                            key={index}
                            className="text-xs text-amber-700"
                          >
                            ⚠️ {warning}
                          </div>
                        )
                      )}

                    </div>
                  )}

              </div>
            )}

            {/* ========================= */}
            {/* Search Terms */}
            {/* ========================= */}

            {searchTerms && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">

                  <div className="flex items-center gap-2 flex-wrap">

                    <h3 className="font-semibold text-slate-900">
                      【后台 Search Terms】
                    </h3>

                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-mono ${searchStatus.className}`}
                    >
                      {searchStatus.text}
                    </span>

                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        searchTerms,
                        'search'
                      )
                    }
                    className="text-xs text-blue-600 font-medium"
                  >
                    {copiedSection ===
                    'search'
                      ? '✓ 已复制'
                      : '复制搜索词'}
                  </button>

                </div>

                <div
                  className={`rounded-xl p-4 text-sm font-mono leading-7 break-words border ${
                    searchBytes > 249
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  {searchTerms}
                </div>

                <div className="mt-3 text-xs text-slate-400">
                  系统会在服务端自动去重、清理标点，并控制在 249 Bytes 安全线以内。
                </div>

              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}

export default App;