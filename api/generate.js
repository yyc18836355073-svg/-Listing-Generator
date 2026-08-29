/**
 * Vercel Serverless Function - AI Listing & Search Terms Generator
 * 支持首次合规生成与【一键智能合规修复】
 */

export const config = {
  runtime: 'edge',
};

const ALLOWED_ORIGINS = [
  "https://listing-generator-seven.vercel.app",
  "https://listing-generator-seven-git-main-yyc18836355073.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const ipMap = new Map();
function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith(".vercel.app"));
}
function checkRateLimit(ip) {
  const now = Date.now();
  const arr = ipMap.get(ip) || [];
  const recent = arr.filter(t => now - t < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  ipMap.set(ip, recent);
  return true;
}

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: "Forbidden origin" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const corsHeaders = {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) && origin ? origin : "https://listing-generator-seven.vercel.app",
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (!checkRateLimit(clientIp)) {
    return new Response(JSON.stringify({ error: "Too many requests, please try again in a minute" }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const {
      productName = '',
      sellingPoints = '',
      platform = 'amazon-us',
      action = 'generate',
      currentListing = null,
      violations = [],
    } = await req.json();

    if (productName.length > 80 || sellingPoints.length > 1000) {
      return new Response(JSON.stringify({ error: "Input too long: productName <=80, sellingPoints <=1000" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const sanitize = (s) => (s || "").toString().replace(/<\/?Product_Facts>/gi, "").replace(/<\/?product_facts>/gi, "");
    const safeProductName = sanitize(productName).slice(0, 80);
    const safeSellingPoints = sanitize(sellingPoints).slice(0, 1000);

    const apiKey = process.env.SILICONFLOW_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: '服务端未配置 SILICONFLOW_API_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const PLATFORM_PROMPTS = {
      'amazon-us': `【Amazon 美国站规则】:
- 标题: 严格控制在 75 字符内，首字母大写，包含大词与核心卖点。
- 亮点: 输出 3 条 Item Highlights，每条 <= 125 字符。
- 五点描述: 严格输出 5 条，每条 10-255 字符，严禁句末标点及 Emoji。
- 搜索词: 严禁超过 249 字节，仅用空格分隔，严禁逗号。`,
      'amazon-de': `【Amazon 德国站规则】:
- 标题: 严格控制在 75 字符内，德语本土化表达，首字母大写。
- 亮点: 输出 3 条 Item Highlights，每条 <= 125 字符。
- 五点描述: 严格输出 5 条，每条 10-255 字符，严禁句末标点及 Emoji。
- 搜索词: 严禁超过 249 字节，仅用空格分隔，严禁逗号。`,
      'amazon-uk': `【Amazon 英国站规则】:
- 标题: 严格控制在 75 字符内，英式英语表达，首字母大写。
- 亮点: 输出 3 条 Item Highlights，每条 <= 125 字符。
- 五点描述: 严格输出 5 条，每条 10-255 字符，严禁句末标点及 Emoji。
- 搜索词: 严禁超过 249 字节，仅用空格分隔，严禁逗号。`,
      'amazon-jp': `【Amazon 日本站规则】:
- 标题: 严格控制在 75 字符内，符合日本消费者搜索和阅读习惯。
- 亮点: 输出 3 条 Item Highlights，每条 <= 125 字符。
- 五点描述: 严格输出 5 条，每条 10-255 字符，严禁句末标点及 Emoji。
- 搜索词: 严禁超过 249 字节，仅用空格分隔，严禁逗号。`,
      'temu': `【Temu 全托管/半托管规则】:
- 标题: 60-100 字符，格式强制为：[核心品名] + [规格/材质] + [适用场景]。
- 亮点: 提取 3 条核心材质与规格属性。
- 五点描述: 3-5 条纯参数化描述（如尺寸、材质、装箱清单），去除所有主观修饰词。
- 搜索词: 输出 5-10 个核心属性同义词，空格分隔。`,
      'tiktok-shop': `【TikTok Shop 兴趣电商规则】:
- 标题: 40-80 字符，强调使用场景、感官冲击与爆款钩子，一秒抓人眼球。
- 亮点: 提取 3 条最能打动用户的痛点解决方案。
- 五点描述: 3-4 条极简短句，突出高颜值、痛点解决与开箱即用体验。
- 搜索词: 提取 5-8 个高频 Trending 标签词（如 #hashtag）。`
    };

    const platformRule = PLATFORM_PROMPTS[platform] || PLATFORM_PROMPTS['amazon-us'];

    const systemPrompt = `你是一名精通多平台出海运营的资深 Listing 专家。当前目标平台为：${platform}。
你的任务是生成或修复高转化、零违规的 Listing。

【当前目标平台专属规则】：
${platformRule}

【通用安全与格式铁律（所有平台适用）】：
1. 严禁自行捏造任何用户未提及的具体尺寸、精确重量或虚构功能。
2. 严禁提及任何第三方知名品牌及商标进行蹭流侵权。
3. 严禁使用医疗疗效词（cure, treat, relief, FDA approved）及违规农药词。
4. 必须严格按照以下标签输出，标签内直接输出纯文本内容：
【商品标题】
【商品亮点】
【五点描述】(极端严格：必须且只能以数字序号 "1. "、"2. "、"3. "、"4. "、"5. " 开头进行分行，严禁使用短横线 - 或圆点 • ！)
【搜索词】`;

    let userPrompt = '';

    if (action === 'autoFix' && currentListing) {
      const safeCurrent = {
        title: sanitize(currentListing.title || "").slice(0, 80),
        highlights: (currentListing.highlights || []).map(h => sanitize(h).slice(0, 125)),
        bullets: (currentListing.bullets || []).map(b => sanitize(b).slice(0, 500)),
        searchTerms: sanitize(currentListing.searchTerms || "").slice(0, 249),
      };
      const safeViolations = (violations || []).map(v => sanitize(v).slice(0, 200));
      userPrompt = `【智能合规修复任务】：
当前生成的 Listing 存在违规或不符合 ${platform} 平台规则的地方，请进行针对性重写与修复。

【待修复问题列表】：
${safeViolations.length > 0 ? safeViolations.map((v, i) => `${i + 1}. ${v}`).join('\n') : '请全面检查并优化字数与违规词汇'}

【当前 Listing 内容】：
【当前标题】：${safeCurrent.title}
【当前亮点】：${safeCurrent.highlights.join(' | ')}
【当前五点】：
${safeCurrent.bullets.join('\n')}
【当前搜索词】：${safeCurrent.searchTerms}

【修复执行要求】：
1. 将所有违规词替换为合规的中性描述。
2. 严格遵循上方【当前目标平台专属规则】中的字数与条数限制，否则系统将崩溃！
3. 严格按照标签格式输出修复后的完整内容。`;
    } else {
      userPrompt = `【目标平台】：${platform} 
（🚨最高铁律：必须 100% 全部使用【${platform}】对应的本土化外语输出！严禁在结果中出现任何中文字符！）
【商品名称】：${safeProductName}
【核心卖点/参数】：${safeSellingPoints}`;
    }

    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'Qwen/Qwen2.5-7B-Instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[generate] SiliconFlow error", response.status, errText.slice(0,300));
      return new Response(JSON.stringify({ error: "Upstream model error, please try again" }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ result: reply }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error("[generate] error", err);
    return new Response(JSON.stringify({ error: '服务器内部错误，请稍后重试' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
