/**
 * Vercel Serverless Function
 * Amazon Listing AI Generator
 *
 * 功能：
 * 1. 调用 SiliconFlow Qwen
 * 2. 生成 Amazon Listing
 * 3. 自动清洗 Search Terms
 * 4. Search Terms 强制控制在 249 Bytes 安全线以内
 * 5. 防止 Search Terms 重复标题/五点词
 * 6. API Key 永远只在服务端使用
 */

export const config = {
  runtime: 'edge',
};

// ==============================
// 工具：UTF-8 Byte 长度
// ==============================

function getByteLength(str) {
  return new TextEncoder().encode(str).length;
}

// ==============================
// 工具：Search Terms 清洗
// ==============================

function sanitizeSearchTerms(raw, title, bullets) {
  if (!raw) return '';

  // 标题 + 五点中的词，后面尽量不要重复
  const existingText = `${title} ${bullets.join(' ')}`.toLowerCase();

  const existingWords = new Set(
    existingText
      .replace(/[^a-z0-9\s]/gi, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );

  // 清理标点
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  const words = cleaned.split(' ');

  const seen = new Set();
  const finalWords = [];

  for (const word of words) {
    if (!word) continue;

    // 太短的单词通常没有搜索价值
    if (word.length < 2) continue;

    // 去重复
    if (seen.has(word)) continue;

    // 尽量避免与标题/五点重复
    if (existingWords.has(word)) continue;

    seen.add(word);

    const candidate = [...finalWords, word].join(' ');

    // 安全线：249 Bytes
    if (getByteLength(candidate) > 249) {
      break;
    }

    finalWords.push(word);
  }

  return finalWords.join(' ');
}

// ==============================
// 工具：从 AI 文本中提取字段
// ==============================

function parseAIResult(raw) {
  const titleMatch = raw.match(
    /【商品标题】\s*([\s\S]*?)(?=【商品亮点】|【五点描述】|【搜索词】|$)/
  );

  const highlightMatch = raw.match(
    /【商品亮点】\s*([\s\S]*?)(?=【五点描述】|【搜索词】|$)/
  );

  const bulletMatch = raw.match(
    /【五点描述】\s*([\s\S]*?)(?=【搜索词】|$)/
  );

  const searchMatch = raw.match(
    /【搜索词】\s*([\s\S]*?)$/
  );

  const title = titleMatch?.[1]?.trim() || '';

  const highlights = highlightMatch?.[1]
    ? highlightMatch[1]
        .split('\n')
        .map((line) =>
          line
            .replace(/^[-*•\d]+[.)、\s]*/, '')
            .trim()
        )
        .filter(Boolean)
    : [];

  const bullets = bulletMatch?.[1]
    ? bulletMatch[1]
        .split('\n')
        .map((line) =>
          line
            .replace(/^\d+[.)、\s]*/, '')
            .trim()
        )
        .filter(Boolean)
    : [];

  const searchTerms = searchMatch?.[1]
    ? searchMatch[1]
        .replace(/\n+/g, ' ')
        .trim()
    : '';

  return {
    title,
    highlights,
    bullets,
    searchTerms,
  };
}

// ==============================
// Prompt
// ==============================

function buildSystemPrompt(platform) {
  const isAmazonUS = platform === 'amazon-us';

  return `
你是一名资深跨境电商 Listing 优化专家。

你的任务不是简单翻译，而是根据用户提供的真实产品信息，生成可以直接用于电商平台的 Listing。

当前目标平台：

${isAmazonUS ? 'Amazon 美国站 US' : platform}

==============================
一、最重要原则
==============================

1. 绝对禁止编造用户没有提供的产品参数。
2. 不允许自行编造：
   - 电池容量
   - 功率
   - 材质
   - 尺寸
   - 重量
   - 防水等级
   - 认证
   - 保修期限
   - 包装内容
3. 如果用户没有提供具体参数，就不要主动增加具体数字。
4. 不要为了让文案看起来更专业而制造虚假参数。

==============================
二、Amazon US 合规原则
==============================

禁止：

- #1
- Best Seller
- Best
- Top Rated
- Cheapest
- Lowest Price
- Free Shipping
- Money Back Guarantee
- Satisfaction Guarantee
- FDA Approved
- Cure
- Treat
- Pain Relief
- Antibacterial
- Antimicrobial
- Disinfect
- Sanitize
- Sterilize
- Anti Mold
- Mosquito Repellent
- Medical Grade
- Hospital Grade
- 100% Guaranteed

禁止：

- Emoji
- ★
- ✔
- ✓
- HTML
- 外部网址
- Email
- 电话
- ASIN
- 促销信息

==============================
三、商品标题
==============================

Amazon US：

生成 1 个英文标题。

目标长度：
150-180 个英文字符。

不要强行凑长度。

标题结构优先：

品牌/品牌位置
+
产品核心词
+
核心属性
+
关键功能
+
使用场景

如果用户没有提供品牌：

不要编造品牌。

可以直接从产品核心词开始。

标题不要：

- 重复堆砌关键词
- 使用营销夸张词
- 使用 Emoji
- 使用特殊符号
- 编造产品参数

==============================
四、核心亮点
==============================

生成 3 条。

每条：

简短
清晰
突出真实卖点

不要添加用户没有提供的参数。

==============================
五、五点 Bullet Points
==============================

必须生成 5 条。

每条：

150-220 个英文字符左右。

结构：

1. 核心功能 + 用户收益
2. 材质/性能 + 用户收益
3. 使用场景 + 使用体验
4. 产品规格/包装（只能使用用户提供的信息）
5. 使用体验/服务信息

每条必须以一个简短的大写英文导语开头。

例如：

PORTABLE DESIGN
...

不要：

- 编造参数
- 医疗宣称
- 农药宣称
- 绝对化宣传
- 退款承诺
- 促销信息
- Emoji
- HTML

==============================
六、Search Terms
==============================

只生成 Amazon 后台 Search Terms。

要求：

1. 只使用与产品高度相关的英文搜索词。
2. 使用空格分隔。
3. 不使用标点符号。
4. 不使用连字符。
5. 不使用品牌词。
6. 不重复。
7. 尽量不要重复标题和五点中的核心词。
8. 不要使用 ASIN。
9. 不要使用主观营销词。
10. 最终必须控制在 249 Bytes 以内。

注意：

即使为了控制长度，也不能胡乱截断一个单词。

==============================
七、输出格式
==============================

严格按照下面格式：

【商品标题】
这里输出标题

【商品亮点】
1. 亮点
2. 亮点
3. 亮点

【五点描述】
1. ...
2. ...
3. ...
4. ...
5. ...

【搜索词】
word word word word

禁止输出：

Markdown
代码块
解释
备注
客套话
分析过程
`;

}

// ==============================
// 主 Handler
// ==============================

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'Method Not Allowed',
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  try {
    const body = await req.json();

    const {
      productName,
      sellingPoints,
      platform = 'amazon-us',
    } = body || {};

    // ==============================
    // 参数检查
    // ==============================

    if (!productName?.trim()) {
      return new Response(
        JSON.stringify({
          error: '请输入商品名称或品类核心词',
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    if (!sellingPoints?.trim()) {
      return new Response(
        JSON.stringify({
          error: '请输入核心卖点或产品参数',
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // ==============================
    // API Key
    // ==============================

    const apiKey = process.env.SILICONFLOW_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: '服务端未配置 SILICONFLOW_API_KEY',
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // ==============================
    // Prompt
    // ==============================

    const systemPrompt = buildSystemPrompt(platform);

    const userPrompt = `
【目标平台】
${platform}

【商品名称】
${productName.trim()}

【核心卖点 / 参数 / 规格】
${sellingPoints.trim()}

请根据以上真实信息生成 Listing。

特别注意：
不要自行补充用户没有提供的数字参数。
不要编造品牌。
不要编造认证。
不要编造包装内容。
`;

    // ==============================
    // 调用 SiliconFlow
    // ==============================

    const response = await fetch(
      'https://api.siliconflow.cn/v1/chat/completions',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },

        body: JSON.stringify({
          model: 'Qwen/Qwen2.5-72B-Instruct',

          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],

          temperature: 0.45,

          max_tokens: 2200,
        }),
      }
    );

    // ==============================
    // API 错误
    // ==============================

    if (!response.ok) {
      console.error(
        'SiliconFlow API Error:',
        response.status
      );

      return new Response(
        JSON.stringify({
          error: `AI 服务调用失败（HTTP ${response.status}）`,
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const data = await response.json();

    const reply =
      data?.choices?.[0]?.message?.content || '';

    if (!reply) {
      return new Response(
        JSON.stringify({
          error: 'AI 没有返回有效内容，请重新生成',
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // ==============================
    // 解析 AI 结果
    // ==============================

    const parsed = parseAIResult(reply);

    if (!parsed.title || parsed.bullets.length === 0) {
      console.error(
        'AI output parsing failed:',
        reply
      );

      return new Response(
        JSON.stringify({
          error: 'AI 返回格式异常，请重新生成',
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // ==============================
    // Search Terms 二次清洗
    // ==============================

    const safeSearchTerms = sanitizeSearchTerms(
      parsed.searchTerms,
      parsed.title,
      parsed.bullets
    );

    // ==============================
    // 最终返回
    // ==============================

    const finalResult = `
【商品标题】
${parsed.title}

【商品亮点】
${parsed.highlights
  .map((item, index) => `${index + 1}. ${item}`)
  .join('\n')}

【五点描述】
${parsed.bullets
  .map((item, index) => `${index + 1}. ${item}`)
  .join('\n')}

【搜索词】
${safeSearchTerms}
`.trim();

    return new Response(
      JSON.stringify({
        result: finalResult,

        meta: {
          searchTermsBytes: getByteLength(
            safeSearchTerms
          ),
          bulletCount: parsed.bullets.length,
          titleCharacters: parsed.title.length,
        },
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Server error:', error);

    return new Response(
      JSON.stringify({
        error: '服务器处理失败，请稍后重试',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}