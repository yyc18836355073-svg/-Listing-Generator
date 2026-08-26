/**
 * Vercel Serverless Function - AI Listing & Search Terms Generator
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
    const { productName, sellingPoints, platform = 'amazon-us', action = 'generate' } = await req.json();

    if (!productName && !sellingPoints) {
      return new Response(JSON.stringify({ error: '缺少必要的商品信息' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = process.env.SILICONFLOW_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: '服务端未配置 SILICONFLOW_API_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `你是一名精通跨境电商运营与平台合规规则的资深 Listing 专家。
你的任务是根据用户提供的商品名称与卖点，生成符合平台算法和搜索权重的高转化 Listing。

【平台合规红线】：
1. 严禁出现农药/杀虫宣称（如 anti-microbial, sanitize, disinfect, anti-mold）。
2. 严禁出现医疗/治愈宣称（如 cure, treat, relieve pain, FDA approved）。
3. 严禁出现绝对化宣传与促销词（如 #1, Best Seller, Top Rated, Money Back Guarantee, Free Shipping, Discount）。
4. 严禁使用 Emoji、特殊图标（如 ★, ✔, ●）和 HTML 标签。
5. 针对美国站（amazon-us），尺寸和重量请使用英制单位（in, lbs, oz）或双标；针对欧洲站请使用公制单位（cm, kg, ml）。

【输出格式要求】：
必须严格按照以下标签输出，不要包含多余的客套话或额外 Markdown 代码块标记：

【商品标题】
(生成 150-180 字符以内的规范标题，首字母大写，包含品牌位置预留、核心关键词、核心属性、适用场景)

【商品亮点】
(生成 3 条简短精炼的核心亮点，每条 30-50 字符)

【五点描述】
1. [简短大写导语] 详细描述说明（150-200字符，突出痛点与功能）
2. [简短大写导语] 详细描述说明（150-200字符，突出材质与耐用性）
3. [简短大写导语] 详细描述说明（150-200字符，突出使用场景与便利性）
4. [简短大写导语] 详细描述说明（150-200字符，突出规格与包装清单）
5. [简短大写导语] 详细描述说明（150-200字符，突出售后服务支持，禁止出现退款承诺）

【搜索词】
(生成亚马逊后台 Search Terms，严格限制在 249 字节以内。用空格分隔高相关长尾词、同义词，禁止包含标点符号、连字符、品牌词以及已在标题和五点中出现的词汇)`;

    let userPrompt = `【目标平台】：${platform}
【商品名称】：${productName}
【核心卖点/参数】：${sellingPoints}`;

    if (action === 'compressTitle') {
      userPrompt = `请对以下标题进行精简压缩，要求严格控制在 150 字符以内，同时保留核心大词与核心属性：\n${productName}`;
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
        temperature: 0.7,
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
