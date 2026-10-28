# PickMuse 🎰

**English** | [简体中文](README.md)

An AI-powered lottery data analysis and number-picking tool that runs locally,
supporting China's **SSQ (Double Color Ball / 双色球)** and **DLT (Super Lotto / 大乐透)** lotteries.

It automatically fetches official public draw results, performs frequency /
omission / hot-cold / sum / pattern analysis, generates picks through multiple
strategies, and can produce LLM-powered analysis reports.

> ⚠️ **Important**: Every lottery draw is an independent random event. No
> historical statistics or AI analysis **can improve your chances of winning**.
> This tool is for entertainment and learning only. Play responsibly and within
> your means. Minors are prohibited from playing the lottery.

## Quick Start

```bash
# 1. Create a virtual environment and install dependencies (first run)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Start the server
.venv/bin/python server.py

# 3. Open in your browser
#    http://127.0.0.1:8765
```

On first launch, the app automatically fetches draw data (~200 SSQ draws,
~300 DLT draws) and caches it in `data/`. The cache is reused for 2 hours;
you can force a refresh from the top of the page.

## Features

### 🎯 Smart Picking

* **Five strategies**:
  * `Composite Score` — weighted rating from recent frequency + omission; hot numbers and long-overdue numbers get slightly higher probability
  * `Hot Tracking` — follow recently frequent numbers
  * `Cold Recovery` — favor numbers that have not appeared for a long time
  * `Balanced Shape` — keep the sum within the historical percentile range and the odd/even ratio close to historical mainstream patterns
  * `Pure Random` — equivalent to a machine pick
* **Anchors & exclusions**: click a number once to set it as an anchor (must appear), again to exclude it, a third time to reset
* **Explainable picks**: expand any pick to see each number's recent frequency, omission, and score
* Statistics window selectable from the last 30 / 50 / 100 / 200 draws

### 🤖 AI Analysis Report

* Without any API key: generates a **built-in statistical report** (computed entirely locally)
* With an OpenAI-compatible API (Zhipu / OpenAI / DeepSeek, etc.): calls the LLM
  to generate an analysis report. Configure via the ⚙︎ button at the top right;
  the key is stored only in `data/settings.json` on your machine

### 📊 Statistics

* Per-zone frequency bar charts (hot/cold coloring + average line)
* Hot / cold / longest-omission rankings
* Main-zone sum trend line
* Odd/even, big/small, and consecutive-number pattern distributions

### 📜 Draw History

Official draw list (issue number, date, winning numbers, first-prize count and
amount, prize pool), with pagination.

### 🎫 My Numbers

* Save picks with one click (stored in the browser's localStorage, never uploaded)
* **Check against the latest draw**: automatically fetches the latest draw for
  both lotteries, determines prize levels, and highlights matched numbers

## Project Structure

```
pick-muse/
├── server.py            # Flask backend: fetching / caching / statistics / strategies / LLM
├── templates/index.html # Page skeleton
├── static/app.js        # Frontend logic
├── static/style.css     # Styles
├── requirements.txt     # flask + requests
└── data/                # Generated at runtime: draw cache, settings
    ├── ssq.json         # SSQ cache (~200 draws)
    ├── dlt.json         # DLT cache (~300 draws)
    └── settings.json    # LLM config (contains API key — do not commit)
```

## API Overview (for local debugging)

| Endpoint                                      | Description                                               |
| --------------------------------------------- | --------------------------------------------------------- |
| `GET /api/stats?game=ssq&window=50`           | Statistics (frequency / omission / sum / patterns)        |
| `GET /api/history?game=dlt&limit=30&offset=0` | Draw history (paginated)                                  |
| `GET /api/latest?game=ssq`                    | Latest draw                                               |
| `POST /api/predict`                           | Strategy picking `{game, strategy, count, window, anchor, exclude}` |
| `POST /api/ai_report`                         | AI report (falls back to the built-in report without a key) |
| `GET/POST /api/settings`                      | LLM config (only the last 4 chars of the key are echoed)  |
| `POST /api/llm_test`                          | LLM connectivity test                                     |

## License

[MIT](LICENSE) © 2026 chiangyang

> This project is for entertainment and learning only. Lotteries carry risk —
> play responsibly.

Data sources: public query endpoints of the China Welfare Lottery (SSQ) and the
China Sports Lottery (DLT), for personal study and research only. If an endpoint
changes and fetching fails, the app automatically falls back to the local cache.
