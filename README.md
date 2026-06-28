# Augur Terminal

预测市场数据源 + 分析框架 + 多 Agent 判断层,聚合 **Polymarket** 与 **Kalshi**,模仿
[TradingAgents](https://github.com/tauricresearch/tradingagents) 的多智能体思路,并 100% 复刻
`docs/prototype/Augur-Terminal.html` 的 Bloomberg 风格终端 UI。

全 TypeScript / Next.js(App Router)全栈;数据落 Postgres 时序库;模型调用经 OpenRouter。

---

## 1. 能力总览

| 模块 | 说明 |
|---|---|
| 数据接入 | Polymarket 零鉴权 **WebSocket** 实时流 + Kalshi 零鉴权 **REST 轮询**,统一归一化 |
| 持久化 | Postgres(Prisma):`markets` / `ticks`(时序)/ `signals` / `market_pairs` / `agent_runs` |
| 分析框架 | 标的筛选(Screener)、概率追踪(ProbTracker)、异常信号(套利价差 / 概率跳动 / 成交放量) |
| 跨平台配对 | 人工策展种子表 + 标题相似度预筛 + LLM 语义判定 |
| Agent 判断层 | 多 Agent 流水线:分析师 → 多空辩论 → 交易员 → 风控;确定性引擎 + LLM 引擎(OpenRouter) |
| 终端 UI | 复刻原型:市场总览 / 标的详情 / Agent 分析 / 异常信号四屏 + 深浅色主题 |

---

## 2. 快速开始

前置:Node ≥ 20、Docker(本项目用 OrbStack 验证过)。

```bash
# 1. 安装依赖
npm install

# 2. 起 Postgres(端口 5544,避免与本机已有 5432 冲突)
docker compose up -d            # 或 npm 的等价命令

# 3. 配置环境
cp .env.example .env            # 按需填入 OPENROUTER_API_KEY

# 4. 建表 + 灌入演示数据
npm run db:push
npm run db:seed

# 5. 启动
npm run dev                     # http://localhost:3000
```

默认 `DATA_SOURCE=seed`:加载内置的 8 个真实预测市场(美联储降息、GPT-6、BTC $150K …),
整条「数据 → 分析 → Agent → UI」链路**离线即可端到端运行**。设 `DATA_SOURCE=live` 切换到真实
Polymarket / Kalshi 行情。

### 环境变量(节选)

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATA_SOURCE` | `seed` | `seed`(离线演示)/ `live`(真实行情) |
| `AGENT_ENGINE` | `deterministic` | `deterministic`(零成本可复现)/ `llm`(真实多 Agent) |
| `OPENROUTER_API_KEY` | — | OpenRouter 密钥(`llm` 引擎与配对器需要) |
| `LLM_MODEL_PRIMARY` | `google/gemini-3.5-flash` | 主模型 |
| `LLM_MODEL_FALLBACK` | `deepseek/deepseek-v4-flash` | 主模型失败时自动兜底 |

---

## 3. 架构与数据流

```
 数据接入 Connectors        归一化         持久化(Postgres)      分析框架               前端(终端 UI)
 Polymarket  (WS,免鉴权)  ─┐                                  Screener 筛选         市场总览 / 标的详情
 Kalshi      (REST 轮询)  ─┤→ MarketTick →  ticks(时序)   →   ProbTracker 概率追踪 →  Agent 分析 / 异常信号
                           │   MarketMeta    markets             AnomalyDetector 异常   ⌘K / 搜索 / SSE
 ingest/worker(常驻编排) ─┘                 signals / pairs     Matcher 跨平台配对
                                            agent_runs           Agent 流水线(按需)
```

- **进程模型**:Next.js `instrumentation.ts` 在服务启动时拉起常驻摄取服务(WS/轮询 → 归一化 →
  写库 → 周期性重算信号),通过内存事件总线把更新经 **SSE**(`/api/stream`)推给前端。
- **目录**:`src/lib/connectors`(接入)、`/analysis`(分析)、`/agents`(Agent)、`/matching`(配对)、
  `/seed`(种子)、`/ingest`(编排)、`/store.ts`(持久化桥)、`/board.ts`(看板聚合);
  `src/app`(页面 + API 路由);`src/components/terminal`(UI)。

---

## 4. 数据结构

归一化领域类型(`src/lib/types.ts`),两家平台都映射到这套类型:

```ts
type Source = 'poly' | 'kalshi'

interface MarketMeta {                 // 市场元数据
  source: Source
  marketId: string                     // poly: conditionId ; kalshi: ticker
  title: string
  category: string | null
  endDate: string | null               // ISO
  outcomes: string[]                   // 通常 ['Yes','No']
  polyClobTokenIds?: [string, string]  // [YES, NO] token id(Polymarket)
  kalshiEventTicker?: string
}

interface MarketTick {                 // 时序快照(主表)
  source: Source
  marketId: string
  yesProb: number                      // 0..1。poly: outcomePrices[0];kalshi: mid(yes_bid,yes_ask)
  volume24h: number
  volumeTotal: number
  ts: string                           // ISO
}

interface Signal {                     // 异常信号
  source: Source
  marketId: string
  kind: 'prob_jump' | 'vol_spike' | 'xplat_spread'
  severity: number                     // 0..1
  detail: string
  ts: string
}

interface MarketPair {                 // 跨平台配对
  polyMarketId: string
  kalshiMarketId: string
  confidence: number                   // 0..1
  source: 'curated' | 'llm'
  mergedYesProb: number | null
}

interface AgentVerdict {               // Agent 结构化判断(含展示字段)
  marketId: string; source: Source; engine: 'deterministic' | 'llm'
  direction: 'YES' | 'NO' | 'HOLD'; sizePct: number; confidence: number   // 规范化
  rationale: string; bullCase: string; bearCase: string; riskNotes: string
  debate: { side: 'bull' | 'bear'; text: string }[]
  signal: string; signalEn: string; side: string; sizeLabel: string        // 展示
  analyst: string; reasons: string[]; risks: string[]; colorVar: string
}
```

平台字段映射要点见 `docs/superpowers/specs/2026-06-29-augur-terminal-design.md`(含 API 来源)。

---

## 5. 分析框架设计

- **Screener**:综合成交量、流动性、距结算时间、近期活跃度打分,给出值得关注的标的排序。
- **ProbTracker**:基于 `ticks` 历史算滚动窗口(1h / 24h)的概率变化(单位 pts = 百分点)与成交变化%。
- **AnomalyDetector**(对应原型的信号轨):
  - `xplat_spread` 套利价差:配对后两平台 YES 概率差 ≥ 4¢。
  - `prob_jump` 概率跳动:24h 概率变化 ≥ 5 pts。
  - `vol_spike` 成交放量:24h 成交变化 ≥ 50%。

阈值与原型一致。所有检测器是纯函数,用合成 tick 序列单测。

---

## 6. Agent 判断层(镜像 TradingAgents)

流水线:**分析师 → 多空辩论(Bull/Bear)→ 交易员 → 风控**,输出结构化 `AgentVerdict`。

- **deterministic 引擎**:原型决策树的逐字移植,无需联网、完全可复现,作为基线与离线兜底。
- **llm 引擎**:经 OpenRouter 真实调用(分析师一段、交易员/风控一段),JSON 结构化输出 + zod 校验,
  主模型失败自动切兜底模型;任何失败都回退到 deterministic 结果,产品永不硬失败。

判断原则(两引擎一致):价差 ≥ 4¢ 优先套利对冲;24h 上行 ≥ 5pts 且概率 < 70% 倾向买入 YES;
下行 ≥ 5pts 倾向买入 NO;概率 ≥ 78% 或无明确边际信息时观望。

---

## 7. 跨平台配对

两家平台事件标识完全不同,采用混合策略:
1. **人工策展种子表**(`src/lib/matching/curated.ts`):已知热门跨平台事件直接入库,置信度 1。
2. **自动配对**(`matcher.ts`):标题 token 相似度(Jaccard)预筛候选 → LLM 判定是否同一事件 + 置信度
   → 高于阈值接受。结果缓存,仅对新市场跑。

---

## 8. API

| 方法 / 路径 | 说明 |
|---|---|
| `GET /api/markets` | 聚合看板:每个跨平台事件一行(合并概率、价差、24h 变化、信号标记)+ KPI |
| `GET /api/signals` | 最新异常信号列表 |
| `POST /api/agent/[source]/[marketId]` | 对某标的跑 Agent 流水线,返回并持久化 `AgentVerdict` |
| `GET /api/stream` | SSE,实时推送 tick / signals 更新 |

---

## 9. 示例输出

`POST /api/agent/poly/poly-fed-jul`(美联储 7 月降息,价差 5¢ → 触发套利):

```json
{
  "engine": "deterministic",
  "signal": "套利", "signalEn": "ARBITRAGE",
  "direction": "HOLD", "sizeLabel": "中性对冲", "confidence": 0.78,
  "analyst": "综合 Polymarket（68%）与 Kalshi（63%），合并 YES 隐含概率 66%，24h 上行 6 pts，合并成交 $2.8M。两平台价差 5¢，存在跨市场套利空间。",
  "side": "Kalshi 买 YES / Poly 卖 YES",
  "reasons": ["两平台价差 5¢ 显著高于历史均值，临近事件窗口具收敛预期。", "..."],
  "risks": ["结算口径或费用差异可能侵蚀部分价差收益。", "..."],
  "debate": [{ "side": "bull", "text": "..." }, { "side": "bear", "text": "..." }]
}
```

`AGENT_ENGINE=llm` 时同一标的由 Gemini 3.5 flash 经 OpenRouter 生成更丰富的中文论证(结构相同)。

---

## 10. 终端 UI:100% 复刻

原型(`docs/prototype/Augur-Terminal.html`)是某设计工具的打包导出。复刻方式:
- 解包出原始 CSS(design tokens / 深浅主题)与自托管字体(IBM Plex Mono/Sans),**逐字搬运**。
- 一个微型 dc-runtime 解释器(`src/components/terminal/Dc.tsx`)直接渲染**原始 body 标记**
  (`sc-for` / `sc-if` / `{{ }}` / `onclick` / `style-hover`),只把组件逻辑(`useTerminal`)移植成 React。

因此布局与样式与原型同源,逐像素一致。验证用 Playwright 截图对比:见
`docs/prototype/shots/`(`orig-*` vs `port-*`)。

---

## 11. 测试

```bash
npm test            # vitest:连接器归一化、分析检测器、Agent 决策树、配对、种子转换(56 例)
npx tsc --noEmit    # 类型检查
```

---

## 12. 设计文档

- 设计 spec:`docs/superpowers/specs/2026-06-29-augur-terminal-design.md`
- 夜间构建决策日志:`docs/overnight-build-log.md`

> 免责声明:本项目仅使用公开行情(只读),不进行任何下单交易;Agent 输出为分析演示,非投资建议。
