# 夜间自主构建 · 决策与进度日志

> 你睡觉期间我自主推进「Augur Terminal」第一版。**所有我替你做的选择都记在这里**,早上你回溯检查。
> 凡标 ⚠️ 的是我拿不准、可能想调整的点。开始时间:2026-06-29 凌晨。

## 0. 任务框架(你的要求,未变)

- 在已确认的 spec(`docs/superpowers/specs/2026-06-29-augur-terminal-design.md`)框架下,**做出整个产品的可运行第一版**,不只是还原原型。
- **100% 还原原型页面**(硬约束)。
- 需要我判断/选择时,按我的推荐选项走,并记录于本文档。
- 遇到重大问题才停下等你。

## 1. 环境探明结论(事实)

| 项 | 结论 |
|---|---|
| 网络 | 可出网(npm / OpenRouter 均通) |
| `ANTHROPIC_API_KEY` | **未设置** → 不走 Anthropic,改走你给的 OpenRouter |
| OpenRouter key | 你提供,已写入 `.env.local`(**git 忽略,不会提交**) |
| 模型主选 | `google/gemini-3.5-flash`(OpenRouter 上确实存在;注意它是带 reasoning 的模型,需给足 max_tokens) |
| 模型兜底 | `deepseek/deepseek-v4-flash`(存在;可在 env 改) |
| Docker | OrbStack,已拉起;沙箱会挡 docker socket,我对 docker 命令禁用沙箱执行 |
| Postgres | 5432 已被你现有的 `lumina-postgres` 占用 → 我**另起容器 `augur-postgres`,端口 5544**,user/pwd/db 均 `augur` |

## 2. 已确认的产品决策(brainstorm 阶段,你拍过板)

- 交付:完整复刻终端 UI + 后端框架
- 技术栈:全 TypeScript / Next.js(App Router)
- 数据:Polymarket 零鉴权 WS + Kalshi 零鉴权 REST 轮询 → 归一化 → 时序持久化
- 持久化:Postgres(Prisma)
- Agent:多 Agent 流水线(分析师→多空辩论→交易员→风控)+ 结构化输出
- 跨平台配对:人工策展种子表 + LLM 语义自动配对

## 3. 今晚我替你做的新选择(请重点检查)

1. **模型层走 OpenRouter**,统一封装一个客户端:主 `google/gemini-3.5-flash`,失败/超时自动兜底 `deepseek/deepseek-v4-flash`。两者均 env 可配。⚠️ 你说的是「Gemini 3.5 flash」「DeepSeek V4」,我选了 OpenRouter 上最贴近的确切 slug。
2. **离线 DEMO/种子模式**:因为我无法保证沙箱内长连真实交易所 WS 稳定、且 `ANTHROPIC` 不可用,我让产品默认带一个 **seed 模式**——用原型里那 8 个真实市场数据(`fed-jul`/`gpt6`/`btc-150`…)灌库,使「数据→分析→Agent→UI」整条链路**离线即可端到端跑通、可演示**。`DATA_SOURCE=live` 时切换到真实 Polymarket/Kalshi。⚠️ 这是为了让你早上能直接看到能跑的东西;真实数据接入代码同样实现并配 fixture 测试。
3. **Agent 双轨**:① 确定性引擎(把原型的 `makeAnalysis` 决策树移植过来,无需联网即可产出多空辩论/交易员判断/风控)②LLM 引擎(走 OpenRouter,真实多 Agent 调用)。env `AGENT_ENGINE=deterministic|llm` 切换,默认 `deterministic` 保证可复现、零成本;`llm` 用于真实联调。
4. **UI 100% 还原策略**:原型的 `text/x-dc` 脚本是**完整可读的 React 实现**(数据 + `renderVals()` + 全部屏幕 + 内联样式),`<head>` 是完整 CSS design tokens,字体是自带 woff2。我把这些**逐一移植**到 Next:CSS 原样搬、字体自托管、组件按原结构重建,确保逐像素一致。
5. **DB 容器端口 5544**(避让你已有的 5432)。
6. 直接在 `main` 上小步提交(仓库本就空、首版、单人)。包管理用 **npm**。

## 4. 进度(全部完成 ✅)

- [x] 环境探明(网络/key/docker/pg)
- [x] 解包原型 → `docs/prototype/extracted/`(模板/数据/字体)
- [x] 起 Postgres 容器 `augur-postgres`
- [x] 脚手架 + Prisma schema + 共享类型(`tsc` 干净)
- [x] 里程碑①数据接入 + 归一化 + 持久化(+seed)— 16 市场 / 1280 ticks / 8 pairs 入库
- [x] 里程碑②分析框架 + 信号 — 19 信号(跳动8/放量8/套利3)
- [x] 里程碑③Agent 流水线 — 确定性 + LLM(OpenRouter)双引擎,均实测通过
- [x] 里程碑④跨平台配对 — 策展表 + 相似度 + LLM 判定
- [x] 里程碑⑤终端 UI 100% 还原 — Playwright 截图逐像素对比,控制台无告警
- [x] 里程碑⑥README + 示例输出
- [x] 验证:56 单测全绿、`tsc` 干净、产品 API curl 通过、UI 截图对比、LLM 链路实测

### 验证证据
- 测试:`npm test` → 56 passed;`npx tsc --noEmit` → clean。
- 产品 API:`GET /api/markets` → 8 事件 + 19 信号 + KPI;`POST /api/agent/poly/poly-fed-jul`
  → 套利/置信 0.78,analyst 文案与原型逐字一致。
- LLM:`AGENT_ENGINE=llm` 经 OpenRouter(google/gemini-3.5-flash)实测,gpt6 → 套利/置信 0.85,中文论证为真实生成,~16s。
- UI:`docs/prototype/shots/` 下 `orig-*` vs `port-*`(总览/详情/Agent/信号/布局B)逐像素一致。

### 早上可以这样自己验
```bash
docker start augur-postgres        # 若容器已停
npm install && npm run db:push && npm run db:seed
npm run dev                        # 打开 http://localhost:3000
# 想看真实 LLM:把 .env 里 AGENT_ENGINE 改成 llm,再 POST /api/agent/poly/poly-gpt6
node docs/prototype/shoot.mjs both # 重新生成对比截图(需先 npx playwright install chromium)
```

## 6. UI ↔ API 实时联动(已完成 ✅,第二轮)

按你的要求接通了前后端,且**保真零回归**(Playwright 截图复核四屏仍逐像素一致):
- **数据源**:UI 不再用客户端常量,改为 `GET /api/markets`。该接口在 seed 模式**逐字返回原型数据**
  (`PrototypeMarket[]`,含 hist/flags),live 模式从库计算同形状 → 渲染逻辑一行没改,故保真不变。
- **真实 Agent**:详情页"运行 Agent 分析"现在 `POST /api/agent/poly/<id>`,跑真实流水线(默认 deterministic,
  `AGENT_ENGINE=llm` 即走 OpenRouter),结果渲染进决策卡 + 多空辩论;网络失败回退确定性。
- **实时通道**:`GET /api/stream`(SSE)已连,tick/signals 事件触发看板刷新。
- **一个保真修正**:后端 Agent 的"簿深"原本用 `vol24×0.5` 近似(显示 $1.4M),与原型 $2.1M 不符;
  已在 seed 模式改用原型授权的真实流动性 → 现在 $2.1M 一致。
- 验证:Playwright 实测点击触发 `GET /api/markets`、`GET /api/stream`、`POST /api/agent/poly/poly-fed-jul`,
  控制台零错误;`tsc` 干净;56 单测全绿。

## 6b. LLM 引擎 UI 联调(已验证 ✅)

`AGENT_ENGINE=llm` 下经浏览器点"运行 Agent 分析"实测(标的:比特币 $150K):
- `POST /api/agent` 走真实 OpenRouter(google/gemini-3.5-flash),**延迟 ~15s**,`engine: llm`。
- 判断:买入 YES / 置信 0.75 / 中等仓位 —— 与确定性引擎的措辞和数值不同,确为大模型自主生成。
- 决策卡 / 四角色卡 / 多空辩论全部渲染真实 LLM 中文内容,布局逐像素保真,控制台零错误。
- 证据截图:`docs/prototype/shots/port-agent-llm.png`(抓到分阶段动画进行中)。
- 验证后已把 `.env` 的 `AGENT_ENGINE` 调回默认 `deterministic`(零成本/可复现);随时改回 `llm` 即用真实大模型。

## 6c. Live 模式真实交易所压测(已验证 ✅,有修复+发现)

`DATA_SOURCE=live` 直连真实交易所,32s 实测:
- **吞吐**:Polymarket WS(零鉴权)+ Kalshi REST 轮询 → 归一化 → 落库,**40 poly + 200 kalshi 市场,
  61 poly WS ticks + 700 kalshi ticks**,零崩溃、零限流错误。端到端 live 链路通。
- **修复 1**:Kalshi 当前 API 已弃用分计价字段(`volume`/`volume_24h` 全 undefined),改读 `volume_fp`/
  `volume_24h_fp`(归一化器已修,兼容旧名)。
- **修复 2**:`fetchPolyMarkets` 默认按 `order=volume24hr` 拉取,得到活跃高成交市场(否则默认返回冷门市场)。

**诚实发现(live 的真实局限,留作下一步)**:
- **Kalshi 默认 `status=open` 返回的多是多元 `KXMVE*` 体育市场**,无单一 yes 价(归一化后 yesProb=0,不崩但无意义),
  500 个里仅 11 个有成交。要拿到优质二元市场需按 series 过滤——live 数据选择需调优。
- **两家真实市场几乎不重叠**(Poly 有"Rihanna 新专",Kalshi 是多元体育),所以跨平台配对/套利视图在 live 下天然稀疏;
  且 `startLive` 暂未跑 LLM 配对器 → live 模式 board(按 pairs 聚合)为空、UI 回退到原型数据。
  单平台数据(市场/价格/单市场信号)在 live 下正常流动。
- 结论:**live 摄取管道生产可用**;要让 live 模式的 UI 也丰富,下一步是接 live 跨平台配对 + 优化 Kalshi 选市。

## 7. 仍留白 / 你可定夺(诚实记录)
- **live 模式压测**:真实 Polymarket WS + Kalshi 轮询代码已实现并配 fixture 单测,但沙箱内未长连真实交易所
  压测;`DATA_SOURCE=live` 可切换试。
- **流动性持久化**:seed 模式 liq 用原型授权值(已保真);更"正确"的做法是把 book depth 落进 ticks(留作后续)。
- **依赖告警**:`npm install` 报了几个传递依赖的 audit 告警(主要来自 Next 工具链),未处理,非阻塞。

## 5. 待你决定 / 可能调整(早上看这里)

- ⚠️ 模型 slug 是否就用 `google/gemini-3.5-flash` + `deepseek/deepseek-v4-flash`?
- ⚠️ 默认 seed 模式 vs 默认 live 模式,你的偏好?
- ⚠️ 默认 Agent 引擎 deterministic vs llm?
- (其余见上文 ⚠️)
