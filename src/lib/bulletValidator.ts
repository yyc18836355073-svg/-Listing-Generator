/**
 * 跨境电商平台（重点针对 Amazon 2024/2026 规则）高危违规词与侵权词库
 */

export interface BannedWordRule {
  pattern: RegExp;
  word: string;
  category: 'pesticide' | 'medical' | 'promotional' | 'trademark' | 'environmental' | 'restricted';
  reason: string;
}

export const BANNED_RULES: BannedWordRule[] = [
  // 1. 农药与杀虫相关误判词（Pesticide Claims - 亚马逊最易触发下架的高危词）
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

  // 3. 绝对化、虚假宣传与促销引导词（Promotional / Subjective）
  { pattern: /\b(#1|number one|no\.1)\b/i, word: '#1', category: 'promotional', reason: '亚马逊政策禁止使用绝对化第一宣称' },
  { pattern: /\b(best seller|bestseller)\b/i, word: 'best seller', category: 'promotional', reason: '平台禁止在文案中声称自己是畅销榜首' },
  { pattern: /\b(top[- ]?rated)\b/i, word: 'top rated', category: 'promotional', reason: '主观评价词汇，违背亚马逊 Listing 规则' },
  { pattern: /\b(money[- ]?back guarantee|satisfaction guarantee)\b/i, word: 'money back guarantee', category: 'promotional', reason: '禁止在描述中包含退款承诺或售后保证条款' },
  { pattern: /\b(free shipping|free delivery)\b/i, word: 'free shipping', category: 'promotional', reason: '运费信息属于 Offer 字段，禁止写入 Listing 详情' },
  { pattern: /\b(cheapest|lowest price|discount|sale)\b/i, word: 'lowest price', category: 'promotional', reason: '价格与折扣促销词禁止写入标题与五点' },
  { pattern: /\b(lifetime warranty)\b/i, word: 'lifetime warranty', category: 'promotional', reason: '终身保修宣传在部分站点受到严格合规限制' },

  // 4. 常见第三方注册商标侵权词（Trademark Infringement）
  { pattern: /\b(velcro)\b/i, word: 'Velcro', category: 'trademark', reason: 'Velcro 为注册商标，建议改为 hook and loop fastener' },
  { pattern: /\b(thermos)\b/i, word: 'Thermos', category: 'trademark', reason: 'Thermos 为膳魔师注册商标，建议改为 insulated flask' },
  { pattern: /\b(gore[- ]?tex)\b/i, word: 'Gore-Tex', category: 'trademark', reason: 'Gore-Tex 为注册商标，建议改为 waterproof breathable fabric' },
  { pattern: /\b(band[- ]?aid)\b/i, word: 'Band-Aid', category: 'trademark', reason: 'Band-Aid 为强生注册商标，建议改为 adhesive bandage' },

  // 5. 未经认证的环保与材质虚假宣称（Environmental / Material Claims）
  { pattern: /\b(eco[- ]?friendly|environmentally friendly)\b/i, word: 'eco-friendly', category: 'environmental', reason: '亚马逊 2024 新规要求环保宣称必须提供对应认证，否则会被限流' },
  { pattern: /\b(100% biodegradable|fully biodegradable)\b/i, word: '100% biodegradable', category: 'environmental', reason: '降解宣称需提供第三方合规证书' },
  { pattern: /\b(contains bamboo)\b/i, word: 'contains bamboo', category: 'restricted', reason: '纺织类目竹纤维（Bamboo-derived）需标注 Viscose/Rayon 否则违规' },
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
