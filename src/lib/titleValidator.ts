/**
 * Title Validator - 纯确定性校验，不依赖 AI
 * Amazon US 2026.07.27 规则：标题 <=75 字符，清晰简洁，避免 ALL CAPS/促销词/关键词堆砌/特殊字符
 */

export type TitleViolationType =
  | "OVER_LENGTH"
  | "ALL_CAPS"
  | "MARKDOWN"
  | "EMOJI"
  | "PROMOTIONAL"
  | "SPECIAL_CHAR"
  | "REPEATED_WORD"
  | "EMPTY";

export type TitleValidationResult = {
  valid: boolean;
  length: number;
  violations: { type: TitleViolationType; message: string; detail?: string }[];
  cleanedTitle?: string;
};

// 促销词 - 仅检测，不静默删除（对齐 Amazon 2025.01.21 + 2026.07.27 禁促销语）
const PROMOTIONAL_WORDS = [
  "best", "amazing", "top rated", "top-rated", "#1", "number 1", "no.1", "no 1",
  "best seller", "bestseller", "best-seller",
  "perfect", "incredible", "unbeatable", "must-have", "must have",
  "guaranteed", "on sale", "sale", "free shipping", "discount", "discounted", "discounted price",
  "limited offer", "limited time", "limited time offer", "shop now",
  "premium", "high-quality", "high quality", "ultimate", "reliable", "best on the market", "top rated", "top-rated"
];

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "if", "in", "nor", "of", "on", "or", "per", "so", "to", "up", "via", "with", "for", "from"]);

// 需保持原样的 token：包含数字、或已知缩写
const PRESERVE_EXACT = new Set(["IP67", "IP68", "IPX7", "IPX8", "360°", "Bluetooth", "USB", "USB-C", "Wi-Fi", "WiFi"]);

function isPreserveToken(word: string): boolean {
  if (/\d/.test(word) && /[A-Za-z]/.test(word)) return true;
  if (word.includes("°")) return true;
  if (PRESERVE_EXACT.has(word)) return true;
  if (PRESERVE_EXACT.has(word.toUpperCase())) return true;
  if (/^[A-Z]{2,5}$/.test(word)) return true;
  if (/^[a-z]{2,5}$/.test(word) && ["ip", "led", "usb"].includes(word.toLowerCase())) return true;
  return false;
}

function normalizePreserveToken(core: string): string {
  const lower = core.toLowerCase();
  if (lower === "ip67") return "IP67";
  if (lower === "ip68") return "IP68";
  if (lower === "ipx7") return "IPX7";
  if (lower === "ipx8") return "IPX8";
  if (lower === "bluetooth") return "Bluetooth";
  if (lower === "usb" || lower === "usb-c") return core.toUpperCase();
  if (lower === "wifi" || lower === "wi-fi") return "Wi-Fi";
  // 包含数字的型号，字母部分大写：如 360° 保持
  if (core.includes("°")) return core;
  if (/\d/.test(core) && /[a-z]/i.test(core)) {
    // 规范型号：字母在前数字在后（如 ip67 -> IP67）
    if (/^[a-z]+\d+$/i.test(core)) return core.toUpperCase();
    // 数字在前的计量/规格（如 5000mah、368mAh）：保留原字母大小写，不做整词转大写
    if (/^\d+[a-z]+$/i.test(core)) return core;
  }
  return core;
}

/**
 * 判断单词大小写是否"混乱"（需规范化），而非合法的驼峰/全大/全小。
 * - 驼峰（iPhone, mAh）、全大写（IP）、全小写：认为是规范的，返回 false
 * - 乱序大写（waterPROOF, spEaker）：返回 true，需转 Title Case
 */
function isIrregularCase(core: string): boolean {
  const letters = (core.match(/[A-Za-z]/g) || []).join("");
  // 仅 1~2 个字母或阿拉伯数字，无需判断
  if (letters.length < 3) return false;
  const hasUpper = /[A-Z]/.test(letters);
  const hasLower = /[a-z]/.test(letters);
  if (!hasUpper || !hasLower) return false; // 全大或全小，不在此处理
  const firstIsUpper = /^[A-Z]/.test(letters);
  // 驼峰：首字母大写，其余至多一个后续大写切换（如 iPhone） -> 保留
  if (firstIsUpper) {
    // 后续大写段长度（去掉首字符后看最长连续大写段长度）
    const rest = letters.slice(1);
    const runs = rest.match(/[A-Z]+/g) || [];
    const maxRun = runs.reduce((m, r) => Math.max(m, r.length), 0);
    return maxRun > 1; // iPhone/PubMed -> 1 段单大写, 规范; 如此处 >1 -> 混乱
  }
  // 首字母小写：若后续有大写，一律视为混乱（如 waterPROOF、ipHone）
  return hasUpper;
}

/**
 * 智能 Title Case：保留 IP67/360° 等，仅对普通单词首字母大写，小词保持小写
 */
export function toTitleCaseSmart(input: string): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  return words
    .map((raw, idx) => {
      if (!raw) return raw;
      const match = raw.match(/^([^A-Za-z0-9]*)([A-Za-z0-9°]+)([^A-Za-z0-9]*)$/);
      if (!match) return raw;
      const [, prefix, core, suffix] = match;
      if (!/[A-Za-z]/.test(core)) return raw; // 纯数字/符号
      if (isPreserveToken(core)) {
        return prefix + normalizePreserveToken(core) + suffix;
      }
      // 合法驼峰大小写：保留原样，避免破坏品牌/单位（如 iPhone、mAh）
      const inMixedCase = /[A-Z]/.test(core) && /[a-z]/.test(core);
      if (inMixedCase && !isIrregularCase(core)) {
        return prefix + core + suffix;
      }
      const lower = core.toLowerCase();
      if (idx !== 0 && SMALL_WORDS.has(lower)) {
        return prefix + lower + suffix;
      }
      return prefix + lower.charAt(0).toUpperCase() + lower.slice(1) + suffix;
    })
    .join(" ");
}

/**
 * 判断整串是否包含"乱序大写"单词（用于 clean 时是否需要规范化）。
 * 只检查有字母的单词片段，驼峰/全大/全小不被视为乱序。
 */
function containsIrregularCase(text: string): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  return tokens.some((tok) => {
    const core = (tok.match(/[A-Za-z]+/) || [""])[0];
    if (!core || core.length < 3) return false;
    return isIrregularCase(core);
  });
}

export function containsMarkdown(text: string): boolean {
  return /\*\*/.test(text) || /__/.test(text) || /~~/.test(text);
}

export function containsEmoji(text: string): boolean {
  // 简化的 emoji 检测：Unicode 扩展
  return /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(text);
}

export function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 5) return false;
  return letters === letters.toUpperCase();
}

export function detectPromotional(text: string): string[] {
  const lower = text.toLowerCase();
  return PROMOTIONAL_WORDS.filter((w) => lower.includes(w.toLowerCase()));
}

export function detectRepeatedWords(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Map<string, number>();
  const dups: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const curr = words[i].replace(/[^a-z0-9]/g, "");
    const next = words[i + 1].replace(/[^a-z0-9]/g, "");
    if (curr && curr === next && curr.length > 2) {
      if (!dups.includes(curr)) dups.push(curr);
    }
    // 连续重复词统计
    const count = seen.get(curr) || 0;
    seen.set(curr, count + 1);
  }
  // 同一词出现 >2 次也算堆砌
  for (const [w, c] of seen) {
    if (c > 2 && w.length > 3 && !dups.includes(w)) dups.push(w);
  }
  return dups;
}

export function containsSpecialChar(text: string): string[] {
  const invalid: string[] = [];
  // 严格禁止：! $ ? _ { } ^ ¬ ¦ ™ ® © € £ ¥ † ‡ … ± （除非品牌名，此处先严格检出）
  if (/[!！]/.test(text)) invalid.push("!");
  if (/[$＄]/.test(text)) invalid.push("$");
  if (/\?[？]/.test(text)) invalid.push("?");
  if (/_/.test(text)) invalid.push("_");
  if (/[{]/.test(text)) invalid.push("{");
  if (/[}]/.test(text)) invalid.push("}");
  if (/\^/.test(text)) invalid.push("^");
  if (/¬/.test(text)) invalid.push("¬");
  if (/¦/.test(text)) invalid.push("¦");
  if (/[™®©]/.test(text)) invalid.push("trademark");
  if (/[€£¥]/.test(text)) invalid.push("currency");
  if (/[†‡]/.test(text)) invalid.push("†‡");
  if (/[…±]/.test(text)) invalid.push("…±");
  // 条件禁止：# 仅 in "Style #131" 允许，其余 # 均违规（逐段判断，避免全局豁免）
  for (const boundary of text.split(/\s+/)) {
    const styleHash = boundary.match(/\#(\d+)/);
    if (boundary.includes("#") && !styleHash) {
      invalid.push("#");
      break;
    }
  }
  // ~ 仅 in "60~80"（数字~数字）允许，其余违规
  if (/~/.test(text) && !/\d\s*~\s*\d/.test(text)) invalid.push("~");
  // < > 仅在 "<" 或 ">" 紧跟数字（如 >3lb, <5kg）时允许；否则裸符号违规
  const ltGtRemaining = text.replace(/[<>]\s*\d/g, "");
  if (/[<>]/.test(ltGtRemaining)) invalid.push("<>");
  // * 仅 in "5*"（数字后跟 *）允许；否则违规
  const starRemaining = text.replace(/\d\s*\*/g, "");
  if (/\*/.test(starRemaining)) invalid.push("*");
  // 装饰符号
  if (/★|☆|♥|♦|◆|●|■|✔|✘/.test(text)) invalid.push("decorative symbol");
  // 去重
  return [...new Set(invalid)];
}

/**
 * 逐字符清理条件字符（# ~ < > *）：
 * - # 仅当紧跟 "Style + 数字" 风格声明时保留，其余删除
 * - ~ 仅当 "数字~数字"（如 60~80）时保留，其余删除
 * - < > 仅当后跟数字（如 >3lb / <5kg）时保留该一个符号，其余删除
 * - * 仅当前面是数字（如 5*）时保留，其余删除
 * 相比"全篇一次判断"，此实现不会因存在一个合法用法而放行其他裸符号。
 */
function cleanConditionalChars(input: string): string {
  const chars = input.split("");
  const isDigit = (i: number) => /[0-9]/.test(chars[i] || "");
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "#") {
      // 有效风格号：# 后跟数字，且其后可解析为 "数字..."，同时前一 token 为 "Style"
      // 简化：若 # 后紧跟数字，保留；否则删除
      out.push(isDigit(i + 1) ? "#" : "");
      continue;
    }
    if (ch === "~") {
      out.push(isDigit(i - 1) && isDigit(i + 1) ? "~" : "");
      continue;
    }
    if (ch === "<" || ch === ">") {
      out.push(isDigit(i + 1) ? ch : "");
      continue;
    }
    if (ch === "*") {
      out.push(isDigit(i - 1) ? "*" : "");
      continue;
    }
    out.push(ch);
  }
  return out.join("");
}

export function cleanTitleDeterministic(title: string): string {
  let cleaned = title;
  cleaned = cleaned.replace(/\*\*/g, "").replace(/__/g, "").replace(/~~/g, "");
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "");
  cleaned = cleaned.replace(/^["「『“]+|["」』”]+$/g, "");
  // 规范无意义特殊字符：!!! -> 去除, ### -> 去除, ?? -> ?，并清理新增禁用字符
  cleaned = cleaned.replace(/!{1,}/g, "").replace(/\$/g, "").replace(/\?{1,}/g, "").replace(/_/g, " ").replace(/[{]/g, "").replace(/[}]/g, "").replace(/\^/g, "").replace(/¬/g, "").replace(/¦/g, "").replace(/[™®©€£¥†‡…±]/g, "");
  cleaned = cleaned.replace(/★|☆|♥|♦|◆|●|■|✔|✘/g, "");
  // 条件字符：# ~ < > * 仅功能性保留，否则去除（逐字符判断，避免"合法+裸符号"被全局豁免）
  cleaned = cleanConditionalChars(cleaned);
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/^[.,;:!?\-—\s]+|[.,;:!?\-—\s]+$/g, "");
  if (isAllCaps(cleaned)) {
    cleaned = toTitleCaseSmart(cleaned);
  } else if (/[A-Z]/.test(cleaned) && /[a-z]/.test(cleaned) && containsIrregularCase(cleaned)) {
    // 乱序大写：局部 gobble 大写（如 "waterPROOF bluetooth SPEAKER"）需转规范 Title Case
    cleaned = toTitleCaseSmart(cleaned);
  }
  return cleaned;
}

export function cleanHighlightsDeterministic(highlights: string): string {
  let cleaned = highlights;
  cleaned = cleaned.replace(/\*\*/g, "").replace(/__/g, "").replace(/~~/g, "");
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "");
  cleaned = cleaned.replace(/^["「『“]+|["」』”]+$/g, "");
  cleaned = cleaned.replace(/!{1,}/g, "").replace(/\$/g, "").replace(/\?{1,}/g, "").replace(/_/g, " ").replace(/[{]/g, "").replace(/[}]/g, "").replace(/\^/g, "").replace(/¬/g, "").replace(/¦/g, "").replace(/[™®©€£¥†‡…±]/g, "");
  cleaned = cleaned.replace(/★|☆|♥|♦|◆|●|■|✔|✘/g, "");
  cleaned = cleanConditionalChars(cleaned);
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/^[.,;:!?\-—\s]+|[.,;:!?\-—\s]+$/g, "");
  return cleaned;
}

export function validateTitle(title: string): TitleValidationResult {
  const violations: TitleValidationResult["violations"] = [];
  const trimmed = title.trim();
  const length = [...trimmed].length; // 按字符计，含空格，符合 Amazon 75 含空格

  if (!trimmed) {
    violations.push({ type: "EMPTY", message: "标题为空" });
    return { valid: false, length, violations };
  }

  if (length > 75) {
    violations.push({ type: "OVER_LENGTH", message: `超出标题长度限制（${length} / 75）`, detail: `${length - 75} chars over` });
  }

  if (isAllCaps(trimmed)) {
    violations.push({ type: "ALL_CAPS", message: "避免全部大写" });
  }

  if (containsMarkdown(trimmed)) {
    violations.push({ type: "MARKDOWN", message: "包含 Markdown 符号" });
  }

  if (containsEmoji(trimmed)) {
    violations.push({ type: "EMOJI", message: "包含 Emoji" });
  }

  const promo = detectPromotional(trimmed);
  if (promo.length) {
    violations.push({ type: "PROMOTIONAL", message: `包含促销词: ${promo.join(", ")}` });
  }

  const special = containsSpecialChar(trimmed);
  if (special.length) {
    violations.push({ type: "SPECIAL_CHAR", message: `包含无意义特殊字符: ${special.join(", ")}` });
  }

  const repeated = detectRepeatedWords(trimmed);
  if (repeated.length) {
    violations.push({ type: "REPEATED_WORD", message: `重复词: ${repeated.join(", ")}` });
  }

  return {
    valid: violations.length === 0,
    length,
    violations,
  };
}

export function getTitleDisplay(title: string) {
  const result = validateTitle(title);
  if (result.valid) {
    return { text: `${result.length} / 75`, status: "ok" as const, message: "✓ 符合 Amazon 标题长度要求" };
  }
  const over = result.violations.find((v) => v.type === "OVER_LENGTH");
  if (over) {
    return { text: `${result.length} / 75`, status: "over" as const, message: "✕ 超出标题长度限制" };
  }
  return { text: `${result.length} / 75`, status: "warning" as const, message: "⚠ 建议优化" };
}

export function getTitleLimitForPlatform(platform: string): number {
  if (platform === "tiktok-en") return 80;
  return 75;
}

export function validateTitleForPlatform(title: string, platform: string): TitleValidationResult {
  if (platform === "tiktok-en") {
    // TikTok: 80字符，允许emoji，促销词仅警告
    const base = validateTitle(title);
    const limit = 80;
    const length = [...title.trim()].length;
    // 重算 OVER_LENGTH 按80
    const filtered = base.violations.filter(v => v.type !== "OVER_LENGTH");
    if (length > limit) {
      filtered.push({ type: "OVER_LENGTH", message: `超出标题长度限制（${length} / ${limit}）`, detail: `${length - limit} chars over` });
    }
    // TikTok 允许 emoji，移除 EMOJI 违规
    const withoutEmoji = filtered.filter(v => v.type !== "EMOJI");
    // 促销词在 TikTok 仅警告，不阻断：移除 PROMOTIONAL 的阻断，改为保留但 valid 仍 true 若仅有促销词
    const hasOnlyPromo = withoutEmoji.length === 1 && withoutEmoji[0].type === "PROMOTIONAL";
    const valid = hasOnlyPromo ? true : withoutEmoji.length === 0;
    // 若仅有促销词，仍返回 warning 长度
    return { valid, length, violations: withoutEmoji };
  }
  return validateTitle(title);
}

export function getTitleDisplayForPlatform(title: string, platform: string) {
  const limit = getTitleLimitForPlatform(platform);
  const result = platform === "tiktok-en" ? validateTitleForPlatform(title, platform) : validateTitle(title);
  if (result.valid) {
    return { text: `${result.length} / ${limit}`, status: "ok" as const, message: platform === "tiktok-en" ? "✓ 符合 TikTok 标题要求" : "✓ 符合 Amazon 标题长度要求" };
  }
  const over = result.violations.find((v) => v.type === "OVER_LENGTH");
  if (over) {
    return { text: `${result.length} / ${limit}`, status: "over" as const, message: "✕ 超出标题长度限制" };
  }
  return { text: `${result.length} / ${limit}`, status: "warning" as const, message: "⚠ 建议优化" };
}

export type HighlightsValidationResult = {
  valid: boolean;
  length: number;
  violations: { type: TitleViolationType; message: string; detail?: string }[];
};

export function validateHighlights(highlights: string): HighlightsValidationResult {
  const violations: HighlightsValidationResult["violations"] = [];
  const trimmed = highlights.trim();
  const length = [...trimmed].length;
  if (!trimmed) {
    // Highlights 允许为空，非必填
    return { valid: true, length: 0, violations: [] };
  }
  if (length > 125) {
    violations.push({ type: "OVER_LENGTH", message: `超出亮点长度限制（${length} / 125）`, detail: `${length - 125} chars over` });
  }
  if (isAllCaps(trimmed)) violations.push({ type: "ALL_CAPS", message: "避免全部大写" });
  if (containsMarkdown(trimmed)) violations.push({ type: "MARKDOWN", message: "包含 Markdown 符号" });
  if (containsEmoji(trimmed)) violations.push({ type: "EMOJI", message: "包含 Emoji" });
  const promo = detectPromotional(trimmed);
  if (promo.length) violations.push({ type: "PROMOTIONAL", message: `包含促销词: ${promo.join(", ")}` });
  const special = containsSpecialChar(trimmed);
  if (special.length) violations.push({ type: "SPECIAL_CHAR", message: `包含无意义特殊字符: ${special.join(", ")}` });
  const repeated = detectRepeatedWords(trimmed);
  if (repeated.length) violations.push({ type: "REPEATED_WORD", message: `重复词: ${repeated.join(", ")}` });
  return { valid: violations.length === 0, length, violations };
}

export function getHighlightsDisplay(highlights: string) {
  const result = validateHighlights(highlights);
  if (!highlights.trim()) return { text: `0 / 125`, status: "ok" as const, message: "可选，未填写不影响" };
  if (result.valid) return { text: `${result.length} / 125`, status: "ok" as const, message: "✓ 符合亮点长度要求" };
  const over = result.violations.find((v) => v.type === "OVER_LENGTH");
  if (over) return { text: `${result.length} / 125`, status: "over" as const, message: "✕ 超出亮点长度限制" };
  return { text: `${result.length} / 125`, status: "warning" as const, message: "⚠ 建议优化" };
}

export function validateTitleMobile(title: string, brand?: string) {
  const trimmed = title.trim();
  const first60 = [...trimmed].slice(0, 60).join("");
  const hasBrandIn60 = brand ? first60.toLowerCase().includes(brand.toLowerCase()) : true;
  const warnings: string[] = [];
  if (!hasBrandIn60 && brand) warnings.push(`品牌 "${brand}" 未在前60字符内，移动端可能截断`);
  if ([...trimmed].length > 60 && [...trimmed].length <= 75) warnings.push("标题在移动端约60字符截断，核心卖点已前置");
  return { hasBrandIn60, warnings, first60Length: [...first60].length };
}

// 德文 Title Case：按空格+连字符分段，每段首字母大写
export function toTitleCaseGerman(input: string): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  return words.map((raw) => {
    if (!raw) return raw;
    // 处理连字符：bluetooth-lautsprecher -> Bluetooth-Lautsprecher
    const parts = raw.split("-");
    const mapped = parts.map((part) => {
      if (!part) return part;
      const match = part.match(/^([^A-Za-z0-9ÄÖÜäöüß]*)([A-Za-z0-9ÄÖÜäöüß°]+)([^A-Za-z0-9ÄÖÜäöüß]*)$/);
      if (!match) return part;
      const [, prefix, core, suffix] = match;
      if (isPreserveToken(core)) return prefix + normalizePreserveToken(core) + suffix;
      const lower = core.toLowerCase();
      return prefix + lower.charAt(0).toUpperCase() + lower.slice(1) + suffix;
    });
    return mapped.join("-");
  }).join(" ");
}
