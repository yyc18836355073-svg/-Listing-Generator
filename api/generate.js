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

    const systemPrompt = `你是一名精通跨境电商运营与亚马逊 2024/2026 最新合规算法的资深 Listing 专家。
你的任务是生成或修复高转化、零违规、强搜索权重的 Listing。

【平台合规与安全铁律（违反直接下架）】：
1. 【严禁编造参数】：严禁自行捏造任何用户未提及的具体尺寸、精确重量或虚构功能。
2. 【严禁第三方品牌侵权】：严禁提及任何第三方知名品牌及商标（如 JBL, PartyBoost, Sony, Bose, Apple, Anker 等）。
3. 【严禁违规宣称】：严禁农药杀虫词（anti-microbial, sanitize, disinfect, anti-mold）、医疗疗效词（cure, treat, relief, FDA approved）及绝对化促销词（#1, Best Seller, Top Rated, Free Shipping, Money Back）。
4. 【纯文本规范】：严禁使用 Emoji 表情、特殊图标（★, ✔, ●）和 HTML/Markdown 格式。

【输出格式与结构规范】：
必须严格按照以下标签输出，标签内直接输出纯文本内容：

【商品标题】
(130-180 字符。必须遵循“移动端 75 字符法则”：前 75 字符内必须包含[核心品类大词]+[最核心属性]+[核心卖点]，首字母大写)

【商品亮点】
(必须严格输出 3 行，每行一条核心卖点，每条 30-80 字符，上限严禁超过 125 字符)

【五点描述】
(必须严格输出且仅输出 5 条，格式固定为：序号. [大写导语] 具体描述内容。导语与正文写在同一行，严禁换行！每条字符数严格控制在 130-210 字符之间，5条总字符数不得超过 1000 字符)
1. [大写导语] 详细痛点解决方案与核心性能描述...
2. [大写导语] 详细材质工艺与品质耐用性说明...
3. [大写导语] 详细应用场景与便捷体验说明...
4. [大写导语] 详细兼容性、配件与规格说明（仅基于用户提供的数据）...
5. [大写导语] 详细品质承诺与售后支持说明（严禁退款宣称）...

【搜索词】
(亚马逊后台 Search Terms，仅输出用空格分隔的长尾同义词、使用场景词。禁止标点，禁止包含品牌词，禁止包含标题中已出现的单词，严禁输出“249 bytes”等解释性字符)`;

    let userPrompt = '';

    if (action === 'autoFix' && currentListing) {
      // 一键修复模式
      userPrompt = `【智能合规修复任务】：
当前生成的 Listing 存在以下违规或不合规项，请进行针对性重写与合规修复：

【待修复问题列表】：
${violations.length > 0 ? violations.map((v, i) => `${i + 1}. ${v}`).join('\n') : '请全面检查并优化字数与违规词汇'}

【当前 Listing 内容】：
【当前标题】：${currentListing.title || ''}
【当前亮点】：${(currentListing.highlights || []).join(' | ')}
【当前五点】：
${(currentListing.bullets || []).join('\n')}
【当前搜索词】：${currentListing.searchTerms || ''}

【修复执行要求】：
1. 将所有违规词（农药宣称/医疗宣称/促销承诺/第三方商标）替换为合规的高转化中性描述。
2. 压缩过长的标题或五点，保证每条五点在 130-210 字符之间，5条总字数 ≤ 1000 字符。
3. 确保搜索词不包含标题重复词且严格 ≤ 249 字节。
4. 严格按照标签格式输出修复后的完整内容。`;
    } else {
      // 默认常规生成模式
      userPrompt = `【目标平台】：${platform}
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
