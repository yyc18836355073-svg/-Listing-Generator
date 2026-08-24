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
  | "MISSING_HEADER";

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

  // 头部格式：应以大写词+冒号开头（允许数字，如 IP67）
  if (!/^[A-Z0-9][A-Z0-9\s\-]{2,30}:/.test(trimmed)) {
    violations.push({ type: "MISSING_HEADER", message: "建议以全大写头+冒号开头（如 'IP67 WATERPROOF:'）" });
  }

  return { valid: violations.filter(v => v.type !== "OVER_RECOMMENDED" && v.type !== "MISSING_HEADER").length === 0, length, violations };
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
