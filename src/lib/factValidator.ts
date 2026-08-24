/**
 * Fact Validator - 防幻觉确定性校验
 * 纯正则提取 + 白名单 + 与原始事实比对
 */

export type FactViolationType = "UNSUPPORTED_VERSION" | "UNSUPPORTED_NUMBER";
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

function isInOriginalFacts(extracted: string, originalFacts: string[]): boolean {
  const needle = extracted.toLowerCase().trim();
  // 提取核心数字/版本部分用于比对：如 Bluetooth 5.0 -> 5.0, 24 hours -> 24
  // 直接检查 extracted 是否被任一 fact 包含（大小写不敏感）
  for (const fact of originalFacts) {
    const f = fact.toLowerCase();
    if (f.includes(needle)) return true;
    // 反向：fact 的核心数字是否在 extracted 中？如 fact "蓝牙" 不含 "5.0"，则不算包含
    // 对于中文 fact，直接字符串包含判断即可
    if (needle.includes(f) && f.length > 1) return true;
  }
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
  const preciseRegex = /\b\d+(?:\.\d+)?\s*(?:W|mAh|hours?|hour|hrs?|meters?|metres?|m)\b|\b\d+\s*-\s*hour\b/gi;

  // 使用 preciseRegex 为主
  while ((n = preciseRegex.exec(text)) !== null) {
    const raw = n[0].trim().replace(/\s+/g, " ");
    // 扩展：向右多取一个词以捕获 "10 meters" vs "10m"
    // precise 已含单位，无需扩展
    candidates.push(raw);
  }

  // 去重并校验
  for (const raw of candidates) {
    const key = raw.toLowerCase();
    if (numberSeen.has(key)) continue;
    numberSeen.add(key);
    if (isWhitelisted(raw)) continue;
    // 若原始事实中已包含该数值（如 IP67 中的 67 不应被当成数值幻觉，但 IP67 不会被 numberRegex 匹配到，因为后无单位）
    // 对于 24 hours，若 originalFacts 包含 "24" 或 "24 hours" 则放行
    if (isInOriginalFacts(raw, originalFacts)) continue;
    // 白名单中 360 已在 isWhitelisted 处理
    violations.push({ type: "UNSUPPORTED_NUMBER", value: raw });
  }

  return violations;
}
