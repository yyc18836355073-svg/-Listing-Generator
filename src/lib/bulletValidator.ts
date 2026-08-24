/**
 * Bullet Validator - 对齐 Amazon 2024.08.15 五点新规
 * 纯确定性校验，不依赖 AI
 */

export type BulletViolationType =
  | "TOO_SHORT"
  | "OVER_LENGTH"
  | "OVER_RECOMMENDED"
  | "BANNED_PHRASE"
  | "SPECIAL_CHAR"
  | "EMOJI"
  | "MARKDOWN"
  | "PLACEHOLDER"
  | "GUARANTEE"
  | "EXTERNAL_LINK"
  | "REPEATED_CONTENT"
  | "MISSING_HEADER"
  | "END_PUNCTUATION"
  | "NUMERAL_WORD"
  | "UNIT_SPACE";

export type BulletValidationResult = {
  valid: boolean;
  length: number;
  violations: { type: BulletViolationType; message: string }[];
};

const BANNED_PHRASES = [
  "eco-friendly", "environmentally friendly", "ecologically friendly",
  "anti-microbial", "anti-bacterial", "antibacterial",
  "made from bamboo", "contains bamboo", "made from soy", "contains soy",
  "best on the market", "top rated", "best seller", "bestseller"
];

const PLACEHOLDERS = ["n/a", "na", "not applicable", "tbd", "to be decided", "yet to decide", "copy pending"];

const GUARANTEE_PHRASES = ["money-back guarantee", "full refund", "money back", "100% guarantee", "satisfaction guarantee"];

const EXTERNAL_LINK_PATTERN = /(https?:\/\/|www\.|\.com|\.net|\.org|@\w+\.\w+|phone:|tel:)/i;
const ASIN_PATTERN = /\bB0[A-Z0-9]{8}\b/;

// 测量/技术单位：数字后跟这些单位视为"型号/测量"，不要求拼写1-9
const MEASURE_UNITS = /^(ml|l|oz|cm|mm|km|m|in|inch|inches|ft|kg|g|lb|lbs|w|wh|mah|v|a|hz|ghz|khz|db|min|mins|hr|hrs|hour|hours|day|days|°|degrees|%|x|pack|pcs|ct|count|gb|tb|mb|watt|watts|volt|volts|amp|amps)$/i;
// 物理单位：官方要求数字与单位间带空格（60 ml），这些连写时提示
const SPACE_UNITS = /^(ml|oz|cm|mm|km|kg|lb|lbs|inch|inches|ft|g|in)$/i;

export function validateBullet(bullet: string): BulletValidationResult {
  const violations: BulletValidationResult["violations"] = [];
  const trimmed = bullet.trim();
  const length = [...trimmed].length;

  if (length < 10) {
    violations.push({ type: "TOO_SHORT", message: `过短（${length} < 10）` });
  }
  if (length > 255) {
    violations.push({ type: "OVER_LENGTH", message: `超出五点长度限制（${length} / 255）` });
  } else if (length > 200) {
    violations.push({ type: "OVER_RECOMMENDED", message: `超过推荐长度（${length} > 200，移动端可能截断）` });
  }

  const lower = trimmed.toLowerCase();

  // 禁用声明
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      violations.push({ type: "BANNED_PHRASE", message: `包含禁用声明: ${phrase}` });
      break;
    }
  }

  // 占位符
  for (const ph of PLACEHOLDERS) {
    if (lower === ph || lower.includes(ph)) {
      // 避免误判正常 "not applicable" 在长句中？仅当单独或明确占位时
      if (trimmed.length < 30 && lower.includes(ph)) {
        violations.push({ type: "PLACEHOLDER", message: `包含占位符: ${ph}` });
        break;
      }
    }
  }

  // 担保
  for (const g of GUARANTEE_PHRASES) {
    if (lower.includes(g)) {
      violations.push({ type: "GUARANTEE", message: `包含担保承诺: ${g}` });
      break;
    }
  }

  // 外链/ASIN
  if (EXTERNAL_LINK_PATTERN.test(trimmed)) {
    violations.push({ type: "EXTERNAL_LINK", message: "包含外链/联系方式" });
  }
  if (ASIN_PATTERN.test(trimmed)) {
    violations.push({ type: "EXTERNAL_LINK", message: "包含 ASIN" });
  }

  // 特殊字符 & Emoji & Markdown
  if (/\*\*/.test(trimmed) || /__/.test(trimmed) || /~~/.test(trimmed)) {
    violations.push({ type: "MARKDOWN", message: "包含 Markdown 符号" });
  }
  if (/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(trimmed)) {
    violations.push({ type: "EMOJI", message: "包含 Emoji" });
  }
  if (/[™®©€£¥†‡…±]/.test(trimmed) || /[!$?_{}^¬¦]/.test(trimmed)) {
    violations.push({ type: "SPECIAL_CHAR", message: "包含禁用特殊字符" });
  }

  // 头部格式：应以大写词+冒号开头（允许数字/点，如 7.5W/5.2）
  if (!/^[A-Z0-9][A-Z0-9\s\-\.]{2,30}:/.test(trimmed)) {
    violations.push({ type: "MISSING_HEADER", message: "建议以全大写头+冒号开头（如 'IP67 WATERPROOF:'）" });
  }

  // 句尾标点：句段式不使用句尾标点
  if (/[.!?。]$/.test(trimmed)) {
    violations.push({ type: "END_PUNCTUATION", message: "句段式结尾不应使用句号/叹号等标点" });
  }

  // 数字1-9拼写（型号/测量豁免）
  const numeralRegex = /(?<![\d.\-])[1-9](?![\d.])/g;
  let nm: RegExpExecArray | null;
  while ((nm = numeralRegex.exec(trimmed)) !== null) {
    const num = nm[0];
    const idx = nm.index;
    // 向后取紧跟的词，判断是否测量/技术单位
    const rest = trimmed.slice(idx + 1);
    const nextWordMatch = rest.match(/^\s*([A-Za-z%°]+)/);
    const nextWord = nextWordMatch ? nextWordMatch[1] : "";
    // 数字后紧跟连字符（2-in-1 / 3-in-1）视为技术词
    const dashAfter = /^\s*-/.test(rest);
    if (MEASURE_UNITS.test(nextWord) || dashAfter) continue;
    violations.push({ type: "NUMERAL_WORD", message: `数字 ${num} 建议拼写为英文（非型号/测量）` });
  }

  // 数字与单位空格：物理单位应带空格（60 ml）
  const unitSpaceRegex = /(\d+(?:\.\d+)?)(ml|oz|cm|mm|km|kg|lb|lbs|inch|inches|ft|g|in)\b/gi;
  let us: RegExpExecArray | null;
  while ((us = unitSpaceRegex.exec(trimmed)) !== null) {
    const unit = us[2];
    // 若数字与单位紧贴（无空格）则提示
    if (SPACE_UNITS.test(unit)) {
      violations.push({ type: "UNIT_SPACE", message: `数字与单位建议加空格（如 "${us[1]} ${unit}"）` });
    }
  }

  const WARNING_ONLY = new Set(["OVER_RECOMMENDED", "MISSING_HEADER", "END_PUNCTUATION", "NUMERAL_WORD", "UNIT_SPACE"]);
  return { valid: violations.filter(v => !WARNING_ONLY.has(v.type)).length === 0, length, violations };
}

export function validateBullets(bullets: string[]): {
  bulletResults: BulletValidationResult[];
  totalLength: number;
  hasDuplicates: boolean;
  duplicateMessages: string[];
} {
  const bulletResults = bullets.map(validateBullet);
  const totalLength = bullets.reduce((sum, b) => sum + [...b].length, 0);
  const seen = new Map<string, number>();
  const duplicateMessages: string[] = [];
  for (const b of bullets) {
    const key = b.toLowerCase().trim().slice(0, 40);
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (count >= 1) duplicateMessages.push(`重复内容: "${b.slice(0, 30)}..."`);
  }
  // 校验五点间高度重复（前40字符相同）
  const uniqueKeys = new Set(bullets.map(b => b.toLowerCase().trim().slice(0, 40)));
  const hasDuplicates = uniqueKeys.size < bullets.length;
  return { bulletResults, totalLength, hasDuplicates, duplicateMessages };
}

export function getBulletDisplay(bullet: string) {
  const result = validateBullet(bullet);
  if (result.valid && result.length <= 200) {
    return { text: `${result.length} / 255`, status: "ok" as const, message: "✓ 合规" };
  }
  const over = result.violations.find(v => v.type === "OVER_LENGTH");
  if (over) return { text: `${result.length} / 255`, status: "over" as const, message: "✕ 超出长度" };
  const warn = result.violations.find(v => v.type === "OVER_RECOMMENDED");
  if (warn) return { text: `${result.length} / 255`, status: "warning" as const, message: "⚠ 超200建议优化" };
  return { text: `${result.length} / 255`, status: "warning" as const, message: "⚠ 建议优化" };
}
