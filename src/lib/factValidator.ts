/**
 * Fact Validator - 防幻觉确定性校验
 * 纯正则提取 + 白名单 + 与原始事实比对
 */

export type FactViolationType = "UNSUPPORTED_VERSION" | "UNSUPPORTED_NUMBER" | "UNSUPPORTED_CLAIM";
export type FactViolation = { type: FactViolationType; value: string };

const WHITELIST_EXACT = new Set(["100%", "360", "360°", "24/7", "365", "360-degree", "360° sound"]);
// 白名单模糊匹配：包含这些则豁免
const WHITELIST_CONTAINS = ["100%", "24/7", "365"];

function isWhitelisted(raw: string): boolean {
  const v = raw.trim();
  if (WHITELIST_EXACT.has(v)) return true;
  if (WHITELIST_EXACT.has(v.replace(/°/g, ""))) return true;
  // 100% waterproof -> 包含 100% 则豁免
  for (const w of WHITELIST_CONTAINS) {
    if (v.includes(w)) return true;
  }
  // 纯 360 数字豁免
  if (/^360\b/.test(v)) return true;
  return false;
}

function extractNumericKey(s: string): string | null {
  const m = s.match(/\d+(?:\.\d+)?/);
  return m ? m[0] : null;
}

function isNumericMatch(extracted: string, facts: string[]): boolean {
  const num = extractNumericKey(extracted);
  if (!num) return false;
  for (const fact of facts) {
    if (fact.includes(num)) return true;
    // 中英单位归一：小时/hours  天/days
    const factLower = fact.toLowerCase();
    if (factLower.includes(num) && /小时|天|毫安|瓦/.test(fact)) {
      // 若 fact 含中文单位且数值匹配，视为匹配
      return true;
    }
  }
  return false;
}

function isInOriginalFacts(extracted: string, originalFacts: string[]): boolean {
  const needle = extracted.toLowerCase().trim();
  for (const fact of originalFacts) {
    const f = fact.toLowerCase();
    if (f.includes(needle)) return true;
    if (needle.includes(f) && f.length > 1) return true;
  }
  // 数值归一兜底：11 Hours vs 11小时
  if (isNumericMatch(extracted, originalFacts)) return true;
  return false;
}

/**
 * 提取 AI 文案中的幻觉特征
 * @param generatedListing AI 生成的文案
 * @param originalFacts 用户原始事实数组
 */
export function validateFacts(generatedListing: string, originalFacts: string[]): FactViolation[] {
  const violations: FactViolation[] = [];
  const text = generatedListing;

  // 规则1：版本号 - Bluetooth 5.0, Wi-Fi 6, BT 5.3 等
  const versionRegex = /\b(?:Bluetooth|Wi-?Fi|BT)\s*V?\s*\d+(?:\.\d+)?\b/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = versionRegex.exec(text)) !== null) {
    const raw = m[0].trim().replace(/\s+/g, " ");
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isWhitelisted(raw)) continue;
    if (isInOriginalFacts(raw, originalFacts)) continue;
    violations.push({ type: "UNSUPPORTED_VERSION", value: raw });
  }

  const numberSeen = new Set<string>();
  const candidates: string[] = [];

  let n: RegExpExecArray | null;
  const preciseRegex = /\b\d+(?:\.\d+)?\s*(?:W|mAh|Wh|GB|TB|MB|mAh|dB|Hz|GHz|V|A|mm|cm|inch|in|kg|g|lbs?|hours?|hour|hrs?|days?|meters?|metres?|m)\b|\b\d+\s*-\s*hour\b/gi;

  // 使用 preciseRegex 为主
  while ((n = preciseRegex.exec(text)) !== null) {
    const raw = n[0].trim().replace(/\s+/g, " ");
    candidates.push(raw);
  }

  // 去重并校验
  for (const raw of candidates) {
    const key = raw.toLowerCase();
    if (numberSeen.has(key)) continue;
    numberSeen.add(key);
    if (isWhitelisted(raw)) continue;
    if (isInOriginalFacts(raw, originalFacts)) continue;
    violations.push({ type: "UNSUPPORTED_NUMBER", value: raw });
  }

  // 规则3：未验证声明 - eco/anti-bamboo/soy 等需包装证明
  const claimRegex = /\b(?:eco-friendly|environmentally friendly|ecologically friendly|anti-microbial|anti-bacterial|antibacterial|anti bacterial|made from bamboo|contains bamboo|made from soy|contains soy|best on the market|top rated|best seller)\b/gi;
  let c: RegExpExecArray | null;
  const claimSeen = new Set<string>();
  while ((c = claimRegex.exec(text)) !== null) {
    const raw = c[0].trim();
    const key = raw.toLowerCase();
    if (claimSeen.has(key)) continue;
    claimSeen.add(key);
    if (isInOriginalFacts(raw, originalFacts)) continue;
    // 即使 originalFacts 含中文“环保”，英文声明仍需英文原文才放行，避免中文泛化
    violations.push({ type: "UNSUPPORTED_CLAIM", value: raw });
  }

  return violations;
}
