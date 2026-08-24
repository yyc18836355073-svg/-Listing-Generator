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
    // 如 ip67 -> IP67, 5.0 保持
    if (/^[a-z]+\d+$/i.test(core) || /^\d+[a-z]+$/i.test(core)) return core.toUpperCase();
  }
  return core;
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
      if (isPreserveToken(core)) {
        return prefix + normalizePreserveToken(core) + suffix;
      }
      const lower = core.toLowerCase();
      if (idx !== 0 && SMALL_WORDS.has(lower)) {
        return prefix + lower + suffix;
      }
      return prefix + lower.charAt(0).toUpperCase() + lower.slice(1) + suffix;
    })
    .join(" ");
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
  // 条件禁止：~ # < > * 仅功能性使用允许（Style #131 / >3lb），否则视为违规
  if (/[#]/.test(text) && !/Style\s*#\s*\d+/i.test(text)) {
    // 单独 # 或 ## 均违规
    if (/[#]{1,}/.test(text)) invalid.push("#");
  }
  if (/[~]/.test(text) && !/\d+\s*~\s*\d+/.test(text)) invalid.push("~");
  if (/[<>]/.test(text) && !/[<>]\s*\d/.test(text)) invalid.push("<>");
  if (/\*/.test(text) && !/\d+\s*\*/.test(text)) invalid.push("*");
  // 装饰符号
  if (/★|☆|♥|♦|◆|●|■|✔|✘/.test(text)) invalid.push("decorative symbol");
  // 去重
  return [...new Set(invalid)];
}

/**
 * 确定性清理：仅清理无意义字符、Markdown、Emoji、多余空格，不截断、不删促销词
 * 注意：不会增加长度，只会减少或保持
 */
export function cleanTitleDeterministic(title: string): string {
  let cleaned = title;
  cleaned = cleaned.replace(/\*\*/g, "").replace(/__/g, "").replace(/~~/g, "");
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "");
  cleaned = cleaned.replace(/^["「『“]+|["」』”]+$/g, "");
  // 规范无意义特殊字符：!!! -> 去除, ### -> 去除, ?? -> ?，并清理新增禁用字符
  cleaned = cleaned.replace(/!{1,}/g, "").replace(/\$/g, "").replace(/\?{1,}/g, "").replace(/_/g, " ").replace(/[{]/g, "").replace(/[}]/g, "").replace(/\^/g, "").replace(/¬/g, "").replace(/¦/g, "").replace(/[™®©€£¥†‡…±]/g, "");
  cleaned = cleaned.replace(/★|☆|♥|♦|◆|●|■|✔|✘/g, "");
  // 条件字符：# ~ < > * 仅功能性保留，否则去除
  if (!/Style\s*#\s*\d+/i.test(cleaned)) cleaned = cleaned.replace(/#/g, "");
  if (!/\d+\s*~\s*\d+/.test(cleaned)) cleaned = cleaned.replace(/~/g, "");
  if (!/[<>]\s*\d/.test(cleaned)) cleaned = cleaned.replace(/[<>]/g, "");
  if (!/\d+\s*\*/.test(cleaned)) cleaned = cleaned.replace(/\*/g, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/^[.,;:!?\-—\s]+|[.,;:!?\-—\s]+$/g, "");
  if (isAllCaps(cleaned)) {
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
  if (!/Style\s*#\s*\d+/i.test(cleaned)) cleaned = cleaned.replace(/#/g, "");
  if (!/\d+\s*~\s*\d+/.test(cleaned)) cleaned = cleaned.replace(/~/g, "");
  if (!/[<>]\s*\d/.test(cleaned)) cleaned = cleaned.replace(/[<>]/g, "");
  if (!/\d+\s*\*/.test(cleaned)) cleaned = cleaned.replace(/\*/g, "");
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

// 德文 Title Case：名词首字母大写，小词规则不适用德语，保留原有 Preserve 逻辑但不过滤小词
export function toTitleCaseGerman(input: string): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  return words.map((raw) => {
    if (!raw) return raw;
    const match = raw.match(/^([^A-Za-z0-9ÄÖÜäöüß]*)([A-Za-z0-9ÄÖÜäöüß°]+)([^A-Za-z0-9ÄÖÜäöüß]*)$/);
    if (!match) return raw;
    const [, prefix, core, suffix] = match;
    if (isPreserveToken(core)) return prefix + normalizePreserveToken(core) + suffix;
    const lower = core.toLowerCase();
    return prefix + lower.charAt(0).toUpperCase() + lower.slice(1) + suffix;
  }).join(" ");
}
