/**
 * Vercel Serverless Function - AI Listing & Search Terms Generator
 * 支持首次合规生成与【一键智能合规修复】
 */

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  try {
    const {
      productName = '',
      sellingPoints = '',
      platform = 'amazon-us',
      action = 'generate',
      currentListing = null,
      violations = [],
    } = await req.json();

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
      userPrompt = `【智能合规修复任务】：
当前生成的 Listing 存在违规或不符合 ${platform} 平台规则的地方，请进行针对性重写与修复。

【待修复问题列表】：
${violations.length > 0 ? violations.map((v, i) => `${i + 1}. ${v}`).join('\n') : '请全面检查并优化字数与违规词汇'}

【当前 Listing 内容】：
【当前标题】：${currentListing.title || ''}
【当前亮点】：${(currentListing.highlights || []).join(' | ')}
【当前五点】：
${(currentListing.bullets || []).join('\n')}
【当前搜索词】：${currentListing.searchTerms || ''}

【修复执行要求】：
1. 将所有违规词替换为合规的中性描述。
2. 严格遵循上方【当前目标平台专属规则】中的字数与条数限制，否则系统将崩溃！
3. 严格按照标签格式输出修复后的完整内容。`;
    } else {
      userPrompt = `【目标平台】：${platform} 
（🚨最高铁律：必须 100% 全部使用【${platform}】对应的本土化外语输出！严禁在结果中出现任何中文字符！）
【商品名称】：${productName}
【核心卖点/参数】：${sellingPoints}`;
    }

    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'Qwen/Qwen2.5-72B-Instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `API 调用失败: ${response.status}`, details: errText }), {
        status: response.status,
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
    return new Response(JSON.stringify({ error: '服务器内部错误', message: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
