# 跨境电商 Listing 智能生成台

一键生成符合 Amazon / TikTok 2026 新规的多语种 Listing（标题 + 亮点 + 五点描述），内置**纯前端确定性合规校验**与**防幻觉比对**。

纯静态 PWA，部署在 GitHub Pages，无任何服务器后端。

## ✨ 核心能力

| 平台 | 标题长度 | 亮点长度 | 规则要点 |
|---|---|---|---|
| Amazon（英/德） | ≤75 字符 | ≤125 字符 | Title Case / 德文名词大写、禁促销词、禁特殊字符 |
| TikTok（英） | ≤80 字符 | — | 允许 emoji、促销词仅警告 |

- **AI 生成**：调用硅基流动 `Qwen2.5-72B-Instruct` 生成目标语种 Listing。
- **确定性校验**：标题 / 亮点 / 五点三套 validator 在浏览器本地执行，零 tok 消耗。
- **防幻觉**：把生成的数字、版本号、未验证声明与用户输入的原始卖点比对并告警。
- **自动压缩重试**：标题超长时先本地清理，再 AI 压缩（最多 2 次）。
- **PWA**：可安装、离线缓存。

## 🔑 API Key 管理（重要）

- 本项目为**纯前端直连**方案，**不部署任何后端**。
- 你在页面上粘贴的硅基流动 API Key **仅保存在本机浏览器的 localStorage**，不会上传到任何服务器。
- 更换设备或清理浏览器缓存后需重新填入。

> 请在 [SiliconFlow（硅基流动）](https://siliconflow.cn) 控制台创建 API Key。

## 🚀 本地开发

```bash
npm install
npm run dev      # 开发模式
npm test         # 运行校验器单元测试（node:test）
npm run lint     # oxlint
npm run build    # 生产构建 → dist/
npm run preview  # 预览构建产物
```

## ☁️ 部署

项目通过 GitHub Actions（`.github/workflows/deploy.yml`）自动部署到 **GitHub Pages**（push 到 `main`/`master` 即触发）。

- 无需配置任何环境变量 / Secret。
- `vercel.json` 保留仅为兼容 Vercel 静态部署（同样无 Serverless 运行时）。

## 🧠 代码结构

```
src/
  App.tsx                    页面 + 生成/压缩/校验流程编排
  lib/
    siliconFlow.ts           SiliconFlow 直连客户端（生成/压缩 API + 密钥存取）
    titleValidator.ts        标题/亮点合规校验 + Title Case + 条件字符清理
    factValidator.ts         防幻觉比对（版本号/数值/未验证声明）
    bulletValidator.ts       五点描述合规校验
tests/
  validator.test.ts          统一单元测试（node:test）
```

## 🧭 从旧版（Serverless 代理）迁移说明

此前版本使用 `api/generate.js`（Vercel Serverless 代理）托管密钥，但 GitHub Pages 不执行 Serverless 源码，因此线上核心功能不可用。现改为**前端直连**方案修复：

- `api/` 目录已删除，密钥由用户本地托管。
- 移除"密钥打进前端 bundle"的 `VITE_` CI 变量泄漏风险。
- 修复 3 个校验器逻辑 bug：`toTitleCaseSmart` 计量单位置乱 / `containsSpecialChar` 一损俱损全局豁免 / `cleanTitleDeterministic` 混乱大小写漏检。
