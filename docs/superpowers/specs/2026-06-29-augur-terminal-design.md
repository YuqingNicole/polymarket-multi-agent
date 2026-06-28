# Augur Terminal — 设计方案 (Design Spec)

> 预测市场数据源 + 分析框架 + Agent 判断层 + 终端 UI 复刻。
> 参考工程:[TradingAgents](https://github.com/tauricresearch/tradingagents)。
> 日期:2026-06-29

## 1. 目标

构建一套预测市场数据源 + 分析框架,对接 **Polymarket** 与 **Kalshi**,模仿 Trading Agent 的思路:

1. 接入两家公开 API,获取实时市场数据(标的、概率、成交量)。
2. 设计分析框架:筛选有价值标的、追踪概率变化、识别异常信号。
3. 参考 TradingAgents 架构,加入多 Agent 判断层(prompt + 结构化输出)。
4. 完整复刻 `docs/prototype/Augur-Terminal.html` 的 Bloomberg 风格终端 UI。
5. 写清 README:数据结构说明、框架设计思路、示例输出。

## 2. 决策快照

| 维度 | 选定 |
|---|---|
| 交付物 | 完整复刻终端 UI + 后端框架 |
| 技术栈 | 全 TypeScript / Next.js(App Router)全栈 |
| 数据接入 | Polymarket 零鉴权 **WS 实时流** + Kalshi 零鉴权 **REST 轮询** → 归一化 → 时序持久化 |
| 持久化 | **Postgres**(经 Prisma);本地 Docker Compose 起库 |
| Agent | 多 Agent 流水线(分析师→多空辩论→交易员→风控),Anthropic Claude + 结构化输出 |
| 跨平台配对 | 人工策展种子表 + LLM 语义自动配对(置信度阈值) |

## 3. API 事实依据(已查证,2026-06-29)

### Polymarket(三层:Gamma / CLOB / Data)
- **REST**:市场发现 `GET https://gamma-api.polymarket.com/markets`、`/events`;行情 `GET https://clob.polymarket.com/price|/book|/midprice?token_id=`。读公开行情**免鉴权**。
- **WebSocket**(零鉴权):`wss://ws-subscriptions-clob.polymarket.com/ws/market`,订阅 `{ assets_ids:[tokenId...], type:'market' }`,推 `book` / `price_change` / `last_trade_price`。心跳:服务端 5s ping,客户端 10s 内回 pong。官方 TS 客户端 `@polymarket/real-time-data-client`。
- **关键字段**(Gamma market):`question`(标的)、`outcomes` + `outcomePrices`(index 0 = YES 隐含概率,**注意常为字符串化数组需 JSON.parse**)、`clobTokenIds`(0=YES token)、`volume`/`volume24hr`、`liquidity`、`endDate`、`conditionId`(配对键)、`active/closed/enableOrderBook`。
- **限流**:全局 ~9000 req/10s;行情端点 1500/10s(批量 500/10s)。Cloudflare 节流而非拒绝。

### Kalshi(Trade API v2)
- **REST**(读公开行情**免鉴权**):`GET https://external-api.kalshi.com/trade-api/v2/markets`(过滤 `event_ticker`/`series_ticker`/`status`/`tickers`/`limit≤1000`/`cursor`)、`/markets/{ticker}`、`/events?with_nested_markets=true`。Base URL 历史变动过(旧:`api.elections.kalshi.com`),**做成可配置**。
- **WebSocket**:需 RSA-PSS 签名握手(本项目**不使用 Kalshi WS**,改用 REST 轮询规避账户/密钥门槛)。
- **关键字段**(market):`ticker`/`event_ticker`、`yes_bid`/`yes_ask`/`no_bid`/`no_ask`/`last_price`(分计价,新文档亦有 `_dollars`/`_fp` 后缀的美元浮点命名,**接入时实测一次以兼容版本**)、`volume`/`volume_24h`、`open_interest`、`liquidity`、`close_time`、`status`、`result`。**无单一 YES 概率字段**,取 bid/ask 中点或 `last_price`。
- **限流**:令牌桶 + 分级 tier,基础 ~10 req/s;429 指数退避。
- **层级**:`series_ticker` → `event_ticker` → `market ticker`。

### 跨平台配对依据
两边均无统一标识,均为"事件含多市场"结构。配对在 event 层做:标题/slug 文本相似度 + 结算时间(`endDate` vs `close_time`)+ 类别。

## 4. 总体架构(分层)

```
┌─ 数据接入 Connectors ─┐   归一化       持久化(Postgres)   分析框架              前端(终端 UI)
│ Polymarket (WS,免鉴权)│→ MarketTick  →  ticks(时序)     → Screener 筛选      → A·数据表 / B·监控卡
│ Kalshi     (REST 轮询) │   MarketMeta    markets          ProbTracker 概率变化    总览 → 详情 钻取
└───────────────────────┘   (统一类型)    signals          AnomalyDetector 异常    工作台(Agent 结果)
                                          pairs            Matcher 跨平台配对      套利视图 / 信号轨
                                          agent_runs       Agent 流水线(按需)     ⌘K / 搜索 / SSE 实时
```

## 5. 进程模型

Next.js route handler 不适合常驻 WS。方案:

- **常驻接入服务**(单例,随服务启动经 `instrumentation.ts` 拉起):维持 Polymarket WS + Kalshi 轮询循环 → 归一化 → 写 Postgres → 跑分析 → 经内存事件总线广播。
- **Next.js 应用**:UI + API 路由读 DB;**SSE** 把实时 tick/signal 推给浏览器;用户触发"运行 Agent 分析"时按需跑 Agent 流水线。
- 开发期一条 `npm run dev` 全起。生产可拆独立 worker 进程(备选,非本期范围)。

## 6. 归一化数据模型

```ts
type Source = 'poly' | 'kalshi'

interface MarketMeta {
  source: Source
  marketId: string          // poly: conditionId;kalshi: ticker
  title: string
  category: string | null
  endDate: string | null    // ISO;poly endDate / kalshi close_time
  outcomes: string[]        // 通常 ['Yes','No']
  // 平台原生标识(配对/拉行情用)
  polyClobTokenIds?: [string, string]   // [YES, NO]
  kalshiEventTicker?: string
}

interface MarketTick {
  source: Source
  marketId: string
  yesProb: number           // 0..1。poly: outcomePrices[0];kalshi: mid(yes_bid,yes_ask)
  volume24h: number
  volumeTotal: number
  ts: string                // ISO
}

interface Signal {
  marketId: string
  kind: 'prob_jump' | 'vol_spike' | 'xplat_spread'
  severity: number          // 0..1
  detail: string
  ts: string
}

interface MarketPair {
  polyMarketId: string
  kalshiMarketId: string
  confidence: number        // 0..1
  source: 'curated' | 'llm'
  mergedYesProb: number | null
}

interface AgentVerdict {
  marketId: string
  direction: 'YES' | 'NO' | 'HOLD'
  sizePct: number           // 建议仓位 0..100
  confidence: number        // 置信度 0..1
  rationale: string         // 核心理由
  bullCase: string
  bearCase: string
  riskNotes: string         // 风控提示
}
```

Prisma 模型对应表:`markets`、`ticks`(时序主表,按 `(marketId, ts)` 索引)、`signals`、`market_pairs`、`agent_runs`。

## 7. 分析框架(对应原型「信号 / 异常 / 价差」)

- **Screener 筛选有价值标的**:成交量/流动性阈值、距结算时间、活跃度评分。
- **ProbTracker 概率变化**:基于 `ticks` 历史算滚动窗口 Δ(1h / 24h)。
- **AnomalyDetector 异常信号**:
  - `prob_jump`:滚动窗口内概率突变(z-score / 阈值)。
  - `vol_spike`:成交量尖峰。
  - `xplat_spread`:配对后两平台 YES 概率差 > 阈值(套利信号)。
  - 结果落 `signals` 表,喂原型信号轨。

## 8. 跨平台配对(混合)

- **策展种子表**(JSON,几到十几对热门跨平台事件)直接入库,`source='curated'`。
- **LLM 配对器**:对新市场用 标题 + 结算时间 + 类别 生成候选 → Claude 判定是否同一事件 + 置信度 → 高于阈值自动接受、中间区间标记待审。`source='llm'`。
- 结果缓存,仅对新市场跑,控制 LLM 成本。
- 驱动「合并 YES 隐含概率」与「套利视图」。

## 9. Agent 流水线(Claude + 结构化输出,镜像 TradingAgents)

1. **分析师 Agents**:市场结构 / 动量(概率)/ 跨平台套利,三个分析师各吃指标+历史,产出结构化信号。
2. **研究员多空辩论**:Bull vs Bear 各执一词,N 轮(对应原型「多空辩论」)。
3. **交易员**:汇总辩论 → 结构化建议(**建议方向 / 建议仓位 / 置信度 / 核心理由**)。
4. **风控**:检查仓位 / 流动性 / 结算风险,可否决或调整(对应原型「风控提示」)。

每步用 Claude 结构化输出(JSON schema / tool)强约束;结果存 `agent_runs`,在「工作台」渲染。Anthropic 模型:默认 `claude-sonnet-4-6`(分析/辩论),交易员/风控可升 `claude-opus-4-8`(规划阶段定)。

## 10. 前端(复刻原型)

App Router 复刻全部视图:`A·数据表`、`B·监控卡`、总览→详情钻取、工作台(Agent 结论 + 多空辩论 + 风控)、跨平台套利视图、信号轨、`⌘K` 命令面板、搜索。样式从原型抽取(深色 `#14120E`、IBM Plex Mono、`--bg2/--up/--text-*` 等 design tokens)。实时更新走 SSE。

> 原型 HTML 是 bundler 导出(`sc-if`/`sc-for` 模板语法 + 压缩 JS),不直接复用;从中抽取 CSS tokens 与布局结构,用 React 重建。

## 11. 错误处理

- WS 重连 + 指数退避 + 心跳(Poly 5s ping / 10s pong)。
- Kalshi 轮询遇 429 指数退避。
- LLM 调用重试 + schema 校验失败重试。
- **所有 base URL 可配置**(应对 Kalshi 域名迁移)。
- 单源故障时降级展示,不整体崩溃。

## 12. 测试(TDD)

- 归一化:用录制的 API fixture 做单测(字段映射、字符串化数组解析、Kalshi 分/美元命名兼容)。
- 信号检测器:合成 tick 序列驱动(prob_jump / vol_spike / xplat_spread 各覆盖)。
- 配对打分:候选生成 + 阈值逻辑。
- 连接器:对 fixture 做集成测试(CI 不打真网)。
- Agent 流水线:mock Claude 响应,校验 schema 与流转。

## 13. 里程碑(增量交付,逐个可独立验证)

1. **数据接入 + 归一化 + 持久化**:Poly WS + Kalshi 轮询 → 统一类型 → 写 Postgres。验证:DB 里有两家实时 ticks。
2. **分析框架 + 信号**:Screener / ProbTracker / AnomalyDetector → `signals`。验证:合成与真实数据均产出预期信号。
3. **Agent 流水线**:分析师→多空辩论→交易员→风控 → `agent_runs`。验证:对给定市场产出结构化 AgentVerdict。
4. **跨平台配对**:策展表 + LLM 配对 → `market_pairs` + 合并概率 + 套利信号。验证:已知事件正确配对。
5. **终端 UI 复刻**:全部视图 + SSE 实时。验证:与原型视觉/交互对齐,实时刷新。
6. **README**:数据结构说明、框架设计思路、Agent 流水线图、示例输出(AgentVerdict JSON + 截图)。

## 14. 范围与风险提示

- 完整 UI 复刻是最大头;按里程碑顺序把 UI 放最后,先跑通数据/分析/Agent。
- LLM 配对/Agent 成本:缓存配对结果、仅按需触发 Agent。
- Kalshi base URL / 字段命名存在版本差异,接入时实测兼容。
- 本项目使用公开行情**只读**,不做下单交易;Agent 输出为分析建议,非投资建议。
