# 选号缪斯 PickMuse 🎰

AI 彩票数据分析与选号工具（本地运行，支持**双色球**与**大乐透**）。

自动抓取官方公开开奖数据，做频率 / 遗漏 / 冷热 / 形态统计分析，
提供多种策略的智能选号，并可接入大模型生成分析报告。

**English** — PickMuse is a local-first lottery analysis & number-picking tool
for China's **SSQ (双色球)** and **DLT (大乐透)** lotteries. It fetches official
public draw results, computes frequency / omission / hot-cold / sum / pattern
statistics, generates explainable picks via five strategies, and can produce
LLM-powered analysis reports through any OpenAI-compatible API.
For entertainment only — every draw is an independent random event, and no
analysis can improve winning odds.

> ⚠️ **重要说明**：彩票每期开奖相互独立且完全随机，任何历史统计与 AI 分析
> **都无法提高中奖概率**。本工具仅供娱乐与学习，请理性购彩、量力而行，
> 未满 18 周岁禁止购彩。

## 快速开始

```bash
# 1. 创建虚拟环境并安装依赖（首次）
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. 启动
.venv/bin/python server.py

# 3. 打开浏览器访问
#    http://127.0.0.1:8765
```

首次启动后打开页面会自动抓取数据（双色球约 200 期、大乐透约 300 期），
缓存到 `data/` 目录，2 小时内直接读缓存，页面右上角可手动刷新。

## 功能

### 🎯 智能选号
- **五种策略**：
  - `综合评分` — 近期频率 + 遗漏时长加权评分，热号与久未开出的号概率略高
  - `热号追踪` — 跟随近期高频号码
  - `冷号回补` — 偏爱久未开出的号码
  - `形态均衡` — 和值落在历史常见分位区间、奇偶比贴近历史主流形态
  - `完全随机` — 等同机选
- **胆码与排除**：单击号码设为胆码（必出），再点设为排除，第三下取消
- **选号依据**：每注可展开查看每个号码的近期频率、遗漏期数、评分
- 统计窗口可选近 30 / 50 / 100 / 200 期

### 🤖 AI 分析报告
- 不配置任何 Key：生成**内置统计报告**（纯本地计算的数据快报）
- 配置 OpenAI 兼容接口（智谱 / OpenAI / DeepSeek 等均可）：调用大模型
  生成图文分析报告。在页面右上角 ⚙︎ 中配置，密钥只存本机
  `data/settings.json`

### 📊 数据统计
- 各区号码频率柱状图（冷热着色 + 平均线）
- 热号 / 冷号 / 遗漏榜
- 主区和值走势折线
- 奇偶比、大小比、连号形态分布

### 📜 历史开奖
官方历史开奖列表（期号、日期、开奖号码、一等奖注数与奖金、奖池），可分页加载。

### 🎫 我的号码
- 选号结果一键保存（存于浏览器 localStorage，不上传）
- **对最新奖**：自动拉取两种玩法最新一期开奖，核对中奖等级并高亮命中号码

## 项目结构

```
pick-muse/
├── server.py            # Flask 后端：数据抓取 / 缓存 / 统计 / 策略 / LLM
├── templates/index.html # 页面骨架
├── static/app.js        # 前端逻辑
├── static/style.css     # 样式
├── requirements.txt     # flask + requests
└── data/                # 运行时生成：开奖缓存、设置
    ├── ssq.json         # 双色球缓存（约 200 期）
    ├── dlt.json         # 大乐透缓存（约 300 期）
    └── settings.json    # 大模型配置（含密钥，勿提交）
```

## API 一览（本机调试用）

| 接口 | 说明 |
| --- | --- |
| `GET /api/stats?game=ssq&window=50` | 统计数据（频率/遗漏/和值/形态） |
| `GET /api/history?game=dlt&limit=30&offset=0` | 历史开奖（分页） |
| `GET /api/latest?game=ssq` | 最新一期开奖 |
| `POST /api/predict` | 策略选号 `{game, strategy, count, window, anchor, exclude}` |
| `POST /api/ai_report` | AI 报告（无 Key 时回退内置统计报告） |
| `GET/POST /api/settings` | 大模型配置（读取时密钥只回显尾号） |
| `POST /api/llm_test` | 大模型连通性测试 |

## 许可证

[MIT](LICENSE) © 2026 Chiangyang

> 本项目仅供娱乐与学习。彩票有风险，请理性购彩。

数据来源：中国福彩网（双色球）、中国体彩网（大乐透）公开查询接口，
仅用于个人学习研究。若接口调整导致抓取失败，程序会自动回退到本地缓存。
