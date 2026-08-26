/**
 * 跨境电商平台（重点针对 Amazon 2024/2026 规则）高危违规词库与五点描述校验器
 */

// ==============================
// 1. 高危违规词与侵权词库
// ==============================

export interface BannedWordRule {
  pattern: RegExp;
  word: string;
  category: 'pesticide' | 'medical' | 'promotional' | 'trademark' | 'environmental' | 'restricted';
  reason: string;
}

export const BANNED_RULES: BannedWordRule[] = [
  // 1. 农药与杀虫相关误判词（Pesticide Claims）
  { pattern: /\b(anti[- ]?microbial)\b/i, word: 'antimicrobial', category: 'pesticide', reason: '易触发亚马逊农药杀虫剂（Pesticide）算法误判下架' },
  { pattern: /\b(anti[- ]?bacterial)\b/i, word: 'antibacterial', category: 'pesticide', reason: '抗菌宣称需 EPA 认证，普通商品禁止使用' },
  { pattern: /\b(anti[- ]?fungal)\b/i, word: 'antifungal', category: 'pesticide', reason: '防真菌属于农药/医疗管控宣称' },
  { pattern: /\b(anti[- ]?mold|mildew[- ]?resistant)\b/i, word: 'anti-mold', category: 'pesticide', reason: '防霉/抗霉宣称极易触发农药审核' },
  { pattern: /\b(disinfectant|disinfecting|disinfect)\b/i, word: 'disinfectant', category: 'pesticide', reason: '消毒宣称属于农药监管范畴' },
  { pattern: /\b(sanitize|sanitizing|sanitizer)\b/i, word: 'sanitize', category: 'pesticide', reason: '除菌/消毒宣称极易被系统抓取下架' },
  { pattern: /\b(sterilize|sterilizing|sterilization)\b/i, word: 'sterilize', category: 'pesticide', reason: '杀菌/灭菌属于高危违规词' },
  { pattern: /\b(repel(s|ling)? insects?|mosquito repellent)\b/i, word: 'insect repellent', category: 'pesticide', reason: '驱虫宣称属于杀虫剂类目' },

  // 2. 医疗与疗效宣称（Medical Claims - FDA 监管红线）
  { pattern: /\b(fda approved|fda certified)\b/i, word: 'FDA approved', category: 'medical', reason: '严禁擅自使用 FDA 认证标识或宣称' },
  { pattern: /\b(cure(s|d)?|healing)\b/i, word: 'cure', category: 'medical', reason: '治疗宣称属于医疗药物管控' },
  { pattern: /\b(treat(s|ment)? disease|prevent(s|ing)? disease)\b/i, word: 'treat disease', category: 'medical', reason: '防病/治病宣称属于医疗违规' },
  { pattern: /\b(relieve(s)? pain|pain relief)\b/i, word: 'pain relief', category: 'medical', reason: '止痛宣称需医疗器械合规资质' },
  { pattern: /\b(medical grade|hospital grade)\b/i, word: 'medical grade', category: 'medical', reason: '非专业医疗用品禁止使用医用级宣称' },

  // 3. 绝对化、虚假宣传与促销引导词（Promotional）
  { pattern: /\b(#1|number one|no\.1)\b/i, word: '#1', category: 'promotional', reason: '亚马逊政策禁止使用绝对化第一宣称' },
  { pattern: /\b(best seller|bestseller)\b/i, word: 'best seller', category: 'promotional', reason: '平台禁止在文案中声称自己是畅销榜首' },
  { pattern: /\b(top[- ]?rated)\b/i, word: 'top rated', category: 'promotional', reason: '主观评价词汇，违背亚马逊 Listing 规则' },
  { pattern: /\b(money[- ]?back guarantee|satisfaction guarantee)\b/i, word: 'money back guarantee', category: 'promotional', reason: '禁止在描述中包含退款承诺或售后保证条款' },
  { pattern: /\b(free shipping|free delivery)\b/i, word: 'free shipping', category: 'promotional', reason: '运费信息属于 Offer 字段，禁止写入 Listing 详情' },
  { pattern: /\b(cheapest|lowest price|discount|sale)\b/i, word: 'lowest price', category: 'promotional', reason: '价格与折扣促销词禁止写入标题与五点' },
  { pattern: /\b(lifetime warranty)\b/i, word: 'lifetime warranty', category: 'promotional', reason: '终身保修宣传在部分站点受到严格合规限制' },

  // 4. 常见第三方注册商标侵权词（Trademark）
  { pattern: /\b(velcro)\b/i, word: 'Velcro', category: 'trademark', reason: 'Velcro 为注册商标，建议改为 hook and loop fastener' },
  { pattern: /\b(thermos)\b/i, word: 'Thermos', category: 'trademark', reason: 'Thermos 为膳魔师注册商标，建议改为 insulated flask' },
  { pattern: /\b(gore[- ]?tex)\b/i, word: 'Gore-Tex', category: 'trademark', reason: 'Gore-Tex 为注册商标，建议改为 waterproof breathable fabric' },
  { pattern: /\b(band[- ]?aid)\b/i, word: 'Band-Aid', category: 'trademark', reason: 'Band-Aid 为强生注册商标，建议改为 adhesive bandage' },

  // 5. 环保与材质宣称（Environmental）
  { pattern: /\b(eco[- ]?friendly|environmentally friendly)\b/i, word: 'eco-friendly', category: 'environmental', reason: '亚马逊 2024 新规要求环保宣称必须提供对应认证' },
  { pattern: /\b(100% biodegradable|fully biodegradable)\b/i, word: '100% biodegradable', category: 'environmental', reason: '降解宣称需提供第三方合规证书' },
  { pattern: /\b(contains bamboo)\b/i, word: 'contains bamboo', category: 'restricted', reason: '纺织类目竹纤维需标注 Viscose/Rayon 否则违规' },
];

/**
 * 校验文本中的所有违规词
 */
export function checkBannedWords(text: string): { word: string; reason: string; category: string }[] {
  const violations: { word: string; reason: string; category: string }[] = [];
  for (const rule of BANNED_RULES) {
    if (rule.pattern.test(text)) {
      violations.push({
        word: rule.word,
        reason: rule.reason,
        category: rule.category,
      });
    }
  }
  return violations;
}

// ==============================
// 2. 五点描述校验逻辑
// ==============================

export interface BulletValidationResult {
  bulletIndex: number;
  text: string;
  charCount: number;
  wordCount: number;
  isValid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateSingleBullet(text: string, index: number): BulletValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const trimmed: string = text.trim();
  const charCount: number = trimmed.length;
  const wordCount: number = trimmed ? trimmed.split(/\s+/).length : 0;

  if (charCount === 0) {
    errors.push('五点描述不能为空');
  } else if (charCount < 50) {
    warnings.push(`描述过短（当前 ${charCount} 字符），建议在 150~250 字符之间`);
  } else if (charCount > 500) {
    errors.push(`字符数超限（当前 ${charCount} 字符），单条五点上限为 500 字符`);
  } else if (charCount > 250) {
    warnings.push(`字符数偏长（当前 ${charCount} 字符），亚马逊官方推荐 150~250 字符以内`);
  }

  const bannedViolations = checkBannedWords(trimmed);
  for (const violation of bannedViolations) {
    errors.push(`包含高危/违禁词【${violation.word}】：${violation.reason}`);
  }

  const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  if (emojiRegex.test(trimmed)) {
    errors.push('包含 Emoji 表情符号，亚马逊政策严禁在五点中使用表情符号');
  }

  const specialSymbols = /[★☆✔✓✕✖✗✈➢➤►▶●◆■▲]/;
  if (specialSymbols.test(trimmed)) {
    warnings.push('包含特殊字符图标（如 ★、✔、● 等），建议移除以防被亚马逊降权');
  }

  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    errors.push('包含 HTML 标签，亚马逊禁止在五点中使用任何 HTML 代码');
  }

  if (/(\bhttps?:\/\/|www\.|\.com\b|\.net\b|@|email|tel:|phone:)/i.test(trimmed)) {
    errors.push('包含外部链接、邮箱或联系方式，属于严重违规行为');
  }

  if (/\bB0[A-Z0-9]{8}\b/.test(trimmed)) {
    errors.push('包含 ASIN 编号，禁止在描述中直接引用竞品或自身 ASIN');
  }

  return {
    bulletIndex: index + 1,
    text: trimmed,
    charCount,
    wordCount,
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}

export function validateAllBullets(bullets: string[]): {
  results: BulletValidationResult[];
  totalCharCount: number;
  isAllValid: boolean;
  generalWarnings: string[];
} {
  const results: BulletValidationResult[] = bullets.map((b: string, i: number) => validateSingleBullet(b, i));
  const totalCharCount: number = bullets.reduce((sum: number, b: string) => sum + b.trim().length, 0);
  const generalWarnings: string[] = [];

  if (totalCharCount > 1000) {
    generalWarnings.push(`五点总字符数（${totalCharCount} 字符）超过官方推荐的 1000 字符限制`);
  }

  if (bullets.length !== 5) {
    generalWarnings.push(`当前五点数量为 ${bullets.length} 条，建议完整填满 5 条`);
  }

  const isAllValid: boolean = results.every((r: BulletValidationResult) => r.isValid);

  return {
    results,
    totalCharCount,
    isAllValid,
    generalWarnings,
  };
}

// 兼容性导出函数
export function validateBullets(bullets: string[]) {
  return validateAllBullets(bullets);
}

export function getBulletDisplay(bullet: string): string {
  return bullet;
}
