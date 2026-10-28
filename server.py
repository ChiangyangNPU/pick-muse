# -*- coding: utf-8 -*-
"""选号缪斯 PickMuse — 本地分析服务。

抓取官方公开开奖数据（双色球 / 大乐透）并缓存到本地，提供统计分析、
策略选号与可选的大模型分析报告接口。

数据来源（公开页面背后的查询接口）：
  双色球：中国福彩网 www.cwl.gov.cn
  大乐透：中国体彩网 webapi.sporttery.cn

重要声明：彩票每期开奖相互独立且完全随机，任何历史统计都无法提高
中奖概率。本工具仅供娱乐与学习，请理性购彩。

作者：chiangyang
许可证：MIT
"""
import json
import random
import time
from pathlib import Path

import requests
from flask import Flask, jsonify, render_template, request

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"
DATA_DIR.mkdir(exist_ok=True)
CACHE_TTL = 2 * 3600
SETTINGS_PATH = DATA_DIR / "settings.json"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# 玩法配置：zones 按顺序 [主区, 副区]，min/max 为号码范围，pick 为应选个数
GAMES = {
    "ssq": {
        "name": "双色球",
        "zones": [
            {"key": "red", "name": "红球", "min": 1, "max": 33, "pick": 6},
            {"key": "blue", "name": "蓝球", "min": 1, "max": 16, "pick": 1},
        ],
    },
    "dlt": {
        "name": "大乐透",
        "zones": [
            {"key": "front", "name": "前区", "min": 1, "max": 35, "pick": 5},
            {"key": "back", "name": "后区", "min": 1, "max": 12, "pick": 2},
        ],
    },
}

# 选号策略表（key 同时作为前端标识与 API 参数）
STRATEGIES = {
    "smart": "综合评分",
    "hot": "热号追踪",
    "cold": "冷号回补",
    "balanced": "形态均衡",
    "random": "完全随机",
}

app = Flask(__name__)


# ------------------------------------------------------------------ 数据抓取

def _int(s):
    """把带千分位逗号的数字字符串安全转为 int，失败返回 None。"""
    try:
        return int(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def fetch_ssq(count=200):
    """抓取双色球历史开奖数据（中国福彩网公开接口）。

    Args:
        count: 抓取期数，默认 200。

    Returns:
        list[dict]: 开奖列表，最新在前。每期含 code 期号、date 日期、
        nums 开奖号码、pool 奖池、sales 销量、first_count/first_money
        一等奖注数与单注奖金；解析异常的期次自动跳过。
    """
    url = ("https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice"
           f"?name=ssq&issueCount={count}&systemType=DB")
    r = requests.get(
        url,
        headers={"User-Agent": UA,
                 "Referer": "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/"},
        timeout=25,
    )
    r.raise_for_status()
    draws = []
    for it in (r.json() or {}).get("result") or []:
        try:
            red = [int(x) for x in it["red"].split(",")]
            blue = [int(x) for x in it["blue"].split(",")]
            if len(red) != 6 or len(blue) != 1:
                continue
            first = next((g for g in it.get("prizegrades") or []
                          if g.get("type") == 1), {}) or {}
            draws.append({
                "code": str(it["code"]),
                "date": (it.get("date") or "")[:10],
                "nums": {"red": red, "blue": blue},
                "pool": _int(it.get("poolmoney")),
                "sales": _int(it.get("sales")),
                "first_count": _int(first.get("typenum")),
                "first_money": _int(first.get("typemoney")),
            })
        except (KeyError, ValueError, AttributeError):
            continue
    return draws


def fetch_dlt(pages=3, page_size=100):
    """抓取大乐透历史开奖数据（中国体彩网公开接口，按页循环抓取）。

    Args:
        pages: 最多抓取页数，默认 3 页。
        page_size: 每页期数，默认 100。

    Returns:
        list[dict]: 开奖列表，最新在前，字段含义同 fetch_ssq。
        lotteryDrawResult 格式为 7 个空格分隔数字：前 5 个前区 + 后 2 个后区。
    """
    draws = []
    for page in range(1, pages + 1):
        url = ("https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry"
               f"?gameNo=85&provinceId=0&pageSize={page_size}&isVerify=1&pageNo={page}")
        r = requests.get(
            url,
            headers={"User-Agent": UA, "Referer": "https://static.sporttery.cn/"},
            timeout=25,
        )
        r.raise_for_status()
        items = ((r.json() or {}).get("value") or {}).get("list") or []
        if not items:
            break
        for it in items:
            try:
                nums_all = [int(x) for x in it["lotteryDrawResult"].split()]
                if len(nums_all) != 7:
                    continue
                # prizeLevelList 中 group=101 为一等奖（含追加前置档）
                first = next((p for p in it.get("prizeLevelList") or []
                              if str(p.get("group")) == "101"), {}) or {}
                draws.append({
                    "code": str(it["lotteryDrawNum"]),
                    "date": (it.get("lotteryDrawTime") or "")[:10],
                    "nums": {"front": nums_all[:5], "back": nums_all[5:]},
                    "pool": _int(it.get("poolBalanceAfterdraw")),
                    "sales": _int(it.get("totalSaleAmount")),
                    "first_count": _int(first.get("prizeCount")),
                    "first_money": _int(first.get("totalPrizeamount")),
                })
            except (KeyError, ValueError, AttributeError):
                continue
        if len(items) < page_size:
            break
        time.sleep(0.4)  # 翻页间稍作停顿，避免请求过快
    return draws


def _cache_path(game):
    """返回玩法对应的本地缓存文件路径（data/<game>.json）。"""
    return DATA_DIR / f"{game}.json"


def get_draws(game, refresh=False):
    """获取开奖数据（带本地缓存，网络失败时回退缓存）。

    Args:
        game: 玩法 key，"ssq" 或 "dlt"。
        refresh: True 时忽略缓存有效期强制重新抓取。

    Returns:
        tuple[list[dict], float]: (开奖列表最新在前, 缓存时间戳)。

    Raises:
        RuntimeError: 既无网络数据也无本地缓存时抛出。
    """
    cp = _cache_path(game)
    cache = None
    if cp.exists():
        try:
            cache = json.loads(cp.read_text("utf-8"))
        except Exception:
            cache = None
    if cache and not refresh and time.time() - cache.get("fetched_at", 0) < CACHE_TTL:
        return cache["draws"], cache["fetched_at"]
    try:
        draws = fetch_ssq() if game == "ssq" else fetch_dlt()
    except Exception:
        draws = []
    if not draws and cache:
        return cache["draws"], cache["fetched_at"]
    if not draws:
        raise RuntimeError("抓取开奖数据失败，请检查网络后重试")
    payload = {"fetched_at": time.time(), "draws": draws}
    cp.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
    return draws, payload["fetched_at"]


# ------------------------------------------------------------------ 统计分析

def _percentile(sorted_vals, p):
    """求已升序排列序列的 p 分位数（最近邻插值，p 取 0~100）。"""
    if not sorted_vals:
        return 0
    k = round(p / 100 * (len(sorted_vals) - 1))
    return sorted_vals[max(0, min(len(sorted_vals) - 1, k))]


def compute_stats(draws, game_key, window):
    """计算统计窗口内的全方位统计。

    统计口径：
      - freq       窗口内出现次数
      - omission   当前遗漏（距最近一次出现隔了多少期；窗口内未出现 = 窗口长度）
      - max_omission 窗口内最大连续遗漏
      - hot/cold/overdue 热号 / 冷号 / 遗漏最久（各取 5 个）
      - sum/odd_even/big_small/consecutive 仅针对主区（红球 / 前区）计算

    Args:
        draws: 开奖列表，最新在前。
        game_key: 玩法 key。
        window: 统计窗口期数（实际取 draws 前 window 期）。

    Returns:
        dict: 统计结果，直接作为 /api/stats 响应主体。
    """
    game = GAMES[game_key]
    win = draws[:window]
    used = len(win)
    zones = {}
    for zone in game["zones"]:
        k, lo, hi = zone["key"], zone["min"], zone["max"]
        freq = {n: 0 for n in range(lo, hi + 1)}
        last_seen = {}  # 号码 -> 最近一次出现的下标（0 = 最新一期）
        positions = {n: [] for n in range(lo, hi + 1)}
        for i, d in enumerate(win):
            for n in d["nums"][k]:
                if n in freq:
                    freq[n] += 1
                    if n not in last_seen:
                        last_seen[n] = i
        for j, d in enumerate(reversed(win)):  # j: 0 = 窗口内最旧一期
            for n in d["nums"][k]:
                if n in positions:
                    positions[n].append(j)
        omission, max_omission = {}, {}
        for n in range(lo, hi + 1):
            # 当前遗漏：距最近一次出现隔了多少期；窗口内从未出现 = used
            omission[n] = last_seen.get(n, used)
            # 最大遗漏：扫出现位置序列求相邻间隔的最大值（含首尾两段）
            g, prev = 0, -1
            for p in positions[n]:
                g = max(g, p - prev - 1)
                prev = p
            g = used if prev < 0 else max(g, used - 1 - prev)
            max_omission[n] = g
        # 出现次数降序、同次数遗漏升序 => 热号优先；[::-1] 即冷号优先
        ordered = sorted(range(lo, hi + 1), key=lambda n: (-freq[n], omission[n]))
        cold = [n for n in ordered[::-1] if freq[n] == 0][:5] or ordered[::-1][:5]
        zones[k] = {
            "name": zone["name"], "min": lo, "max": hi, "pick": zone["pick"],
            "freq": {str(n): freq[n] for n in range(lo, hi + 1)},
            "omission": {str(n): omission[n] for n in range(lo, hi + 1)},
            "max_omission": {str(n): max_omission[n] for n in range(lo, hi + 1)},
            "hot": [n for n in ordered[:5] if freq[n] > 0],
            "cold": cold,
            "overdue": sorted(range(lo, hi + 1), key=lambda n: -omission[n])[:5],
        }

    main = game["zones"][0]
    sums = [sum(d["nums"][main["key"]]) for d in win]
    s_sorted = sorted(sums)
    big_split = main["max"] // 2 + 1  # 双色球 17+ 为大，大乐透 18+ 为大
    odd_even, big_small, consec = {}, {}, {}
    for d in win:
        ns = d["nums"][main["key"]]
        odd = sum(1 for x in ns if x % 2)
        odd_even[f"{odd}:{len(ns) - odd}"] = odd_even.get(f"{odd}:{len(ns) - odd}", 0) + 1
        big = sum(1 for x in ns if x >= big_split)
        big_small[f"{big}:{len(ns) - big}"] = big_small.get(f"{big}:{len(ns) - big}", 0) + 1
        c = sum(1 for a, b in zip(ns, ns[1:]) if b - a == 1)
        consec[str(c)] = consec.get(str(c), 0) + 1
    return {
        "game": game_key,
        "window_used": used,
        "zones": zones,
        "sum": {
            "series": sums,  # 最新在前
            "mean": round(sum(sums) / len(sums), 1) if sums else 0,
            "p15": _percentile(s_sorted, 15),
            "p85": _percentile(s_sorted, 85),
        },
        "odd_even": odd_even,
        "big_small": big_small,
        "consecutive": consec,
        "big_split": big_split,
    }


# ------------------------------------------------------------------ 策略选号

def _weighted_sample(pool, weights, k, rng):
    """不放回加权抽样：从 pool 中按权重抽出 k 个号码。

    Args:
        pool: 候选号码列表。
        weights: 与 pool 等长的权重列表（权重越大被抽出概率越高）。
        k: 抽取个数。
        rng: random.Random 实例。

    Returns:
        list: 抽中的 k 个号码（顺序随机）。
    """
    items = list(zip(pool, weights))
    picked = []
    for _ in range(k):
        total = sum(w for _, w in items)
        if total <= 0:
            idx = rng.randrange(len(items))
        else:
            r, acc = rng.random() * total, 0.0
            idx = len(items) - 1
            for i, (_, w) in enumerate(items):
                acc += w
                if r <= acc:
                    idx = i
                    break
        picked.append(items.pop(idx)[0])
    return picked


def _zone_weights(strategy, zstat, rng):
    """按策略计算区域内每个号码的抽样权重。

    smart / balanced 的副区：频率分 + 遗漏分 + 随机扰动，兼顾热号与回补；
    hot 只看频率；cold 只看遗漏；random 全部等权。

    Args:
        strategy: 策略 key。
        zstat: compute_stats 输出的单区域统计。
        rng: random.Random 实例（用于 smart 的随机扰动）。

    Returns:
        dict[str, float]: 号码（字符串）-> 权重。
    """
    freq, om = zstat["freq"], zstat["omission"]
    max_f = max(freq.values()) or 1
    max_o = max(om.values()) or 1
    ws = {}
    for n_s, f in freq.items():
        if strategy == "random":
            w = 1.0
        elif strategy == "hot":
            w = 1 + 2.5 * f / max_f
        elif strategy == "cold":
            w = 1 + 2.5 * om[n_s] / max_o
        else:  # smart / balanced 副区
            w = 1 + 1.8 * f / max_f + 1.4 * om[n_s] / max_o + rng.uniform(0, 0.6)
        ws[n_s] = w
    return ws


def _pick_zone(zone, zstat, strategy, exclude, anchor, rng):
    """生成单个区域的号码（胆码必出 + 剩余名额加权抽样）。

    Args:
        zone: 区域配置（GAMES 中的一项）。
        zstat: 该区域的统计数据。
        strategy: 策略 key。
        exclude: 排除号码列表（不参与抽样）。
        anchor: 胆码号码列表（强制入选）。
        rng: random.Random 实例。

    Returns:
        tuple[list, dict]: (选中的号码列表, 选号依据)。依据为
        号码 -> {freq, omission, score}，score 为该号权重归一化值。

    Raises:
        ValueError: 胆码超过应选个数，或排除后可用号码不足。
    """
    lo, hi, k = zone["min"], zone["max"], zone["pick"]
    try:
        anchor = sorted({int(x) for x in anchor if lo <= int(x) <= hi})
        exclude = {int(x) for x in exclude if lo <= int(x) <= hi} - set(anchor)
    except (TypeError, ValueError):
        raise ValueError("胆码 / 排除参数格式错误")
    if len(anchor) > k:
        raise ValueError(f"{zone['name']}胆码最多 {k} 个")
    pool = [n for n in range(lo, hi + 1) if n not in exclude and n not in anchor]
    need = k - len(anchor)
    if len(pool) < need:
        raise ValueError(f"{zone['name']}可用号码不足（排除过多）")
    ws = _zone_weights(strategy, zstat, rng)
    weights = [ws[str(n)] for n in pool]
    wmax = max(weights) or 1
    chosen = _weighted_sample(pool, weights, need, rng)
    reasons = {
        str(n): {
            "freq": zstat["freq"][str(n)],
            "omission": zstat["omission"][str(n)],
            "score": None if strategy == "random" else round(ws[str(n)] / wmax, 2),
        }
        for n in sorted(set(anchor) | set(chosen))
    }
    return anchor + chosen, reasons


def _gen(game, stats, strategy, exclude, anchor, rng):
    """生成一注完整号码：对主区 / 副区分别调用 _pick_zone。

    Args:
        game: 玩法配置（GAMES 的值）。
        stats: compute_stats 的完整输出。
        strategy: 策略 key。
        exclude / anchor: {区域key: 号码列表}。
        rng: random.Random 实例。

    Returns:
        tuple[dict, dict]: ({区域key: 号码列表}, {区域key: 选号依据})。
    """
    nums, reasons = {}, {}
    for zone in game["zones"]:
        n, r = _pick_zone(
            zone, stats["zones"][zone["key"]], strategy,
            exclude.get(zone["key"]) or [], anchor.get(zone["key"]) or [], rng,
        )
        nums[zone["key"]] = sorted(n)
        reasons[zone["key"]] = r
    return nums, reasons


def _shape_ok(nums, p15, p85, odd_seen):
    """形态均衡策略的组合校验：和值在历史分位区间、奇偶比出现过、连号不超 2 组。

    Args:
        nums: 主区号码（已升序）。
        p15 / p85: 历史和值的 15 / 85 分位数。
        odd_seen: 历史出现过的奇偶比集合（如 {"3:3", "2:4"}）。

    Returns:
        bool: 是否通过校验。
    """
    s = sum(nums)
    if not (p15 <= s <= p85):
        return False
    odd = sum(1 for x in nums if x % 2)
    if f"{odd}:{len(nums) - odd}" not in odd_seen:
        return False
    return sum(1 for a, b in zip(nums, nums[1:]) if b - a == 1) <= 2


# ------------------------------------------------------------------ LLM 报告

def load_settings():
    """读取 data/settings.json；文件不存在或损坏时返回空 dict。"""
    if SETTINGS_PATH.exists():
        try:
            return json.loads(SETTINGS_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {}


def save_settings(s):
    """把设置整体写回 data/settings.json。"""
    SETTINGS_PATH.write_text(json.dumps(s, ensure_ascii=False, indent=2), "utf-8")


def llm_ready(s=None):
    """判断大模型配置是否完整（Base URL / 模型 / API Key 均非空）。"""
    llm = (s or load_settings()).get("llm") or {}
    return bool(llm.get("api_key") and llm.get("base_url") and llm.get("model"))


def call_llm(prompt, system, timeout=90):
    """调用 OpenAI 兼容的 chat/completions 接口。

    Args:
        prompt: 用户消息（统计数据 JSON）。
        system: 系统提示词（约束模型输出风格与免责要求）。
        timeout: 请求超时秒数。

    Returns:
        str: 模型回复文本。

    Raises:
        requests.Exception / KeyError: 网络失败或响应格式异常时向上抛出。
    """
    llm = load_settings().get("llm") or {}
    resp = requests.post(
        llm["base_url"].rstrip("/") + "/chat/completions",
        headers={"Authorization": f"Bearer {llm['api_key']}",
                 "Content-Type": "application/json", "User-Agent": UA},
        json={
            "model": llm["model"],
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": prompt}],
            "temperature": 0.8,
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    return ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""


def _balls(lst):
    """把号码列表格式化为「01、02、03」样式的字符串。"""
    return "、".join(f"{n:0>2}" for n in lst)


def builtin_report(game_key, stats, strategy_name):
    """生成内置统计报告（未配置大模型时的降级方案）。

    Args:
        game_key: 玩法 key。
        stats: compute_stats 输出（需已附加 latest 字段）。
        strategy_name: 策略中文名。

    Returns:
        str: 纯文本报告，含数据快报、走势特征、策略解读与理性购彩提示。
    """
    game = GAMES[game_key]
    main, sub = game["zones"][0], game["zones"][1]
    zs, ss = stats["zones"][main["key"]], stats["zones"][sub["key"]]
    sm = stats["sum"]
    n = stats["window_used"]
    oe_top = max(stats["odd_even"].items(), key=lambda kv: kv[1]) if stats["odd_even"] else ("-", 0)
    bs_top = max(stats["big_small"].items(), key=lambda kv: kv[1]) if stats["big_small"] else ("-", 0)
    explain = {
        "综合评分": "同时参考近期出现频率与遗漏时长，给每个号码加权评分后随机抽样，热号与久未开出的号码概率略高，并保留随机扰动。",
        "热号追踪": "近期出现越频繁的号码权重越高，跟随当前走势选号。",
        "冷号回补": "遗漏越久的号码权重越高，押注冷号回补（注意：独立随机事件并不存在“该出了”，这只是偏好）。",
        "形态均衡": "在和值落入历史常见区间、奇偶比贴近历史主流形态的约束下组合号码。",
        "完全随机": "等同于投注站机选，不带任何统计倾向。",
    }.get(strategy_name, "")
    lines = [
        f"【{game['name']} · 近 {n} 期数据快报】（内置统计报告）",
        "",
        f"▎最新一期：{stats['latest']['code']} 期（{stats['latest']['date']}）",
        f"▎{main['name']}热号：{_balls(zs['hot'])}",
        f"▎{main['name']}冷号：{_balls(zs['cold'])}（出现次数最少）",
        f"▎{main['name']}遗漏最久：{_balls(zs['overdue'])}",
        f"▎{sub['name']}热号：{_balls(ss['hot'])}",
        f"▎{sub['name']}遗漏最久：{_balls(ss['overdue'])}",
        "",
        f"▎{main['name']}和值：均值 {sm['mean']}，常见区间 {sm['p15']} ~ {sm['p85']}",
        f"▎奇偶比最常见 {oe_top[0]}（{oe_top[1]} 次），大小比最常见 {bs_top[0]}（{bs_top[1]} 次）",
        "",
        f"▎当前策略「{strategy_name}」：{explain}",
        "",
        "⚠️ 每期开奖都是独立随机事件，以上描述的是历史统计，不是对未来的预测。"
        "冷号不会“该出”，热号也不会“更热”。请把选号当作乐趣，理性购彩。",
    ]
    return "\n".join(lines)


# ------------------------------------------------------------------ 路由

@app.get("/")
def index():
    """主页：渲染 templates/index.html。"""
    return render_template("index.html")


@app.get("/api/games")
def api_games():
    """玩法与策略配置表，供前端初始化使用。"""
    return jsonify({"games": GAMES, "strategies": STRATEGIES})


def _game_arg():
    """解析请求参数中的 game，非法时返回 None。"""
    game = request.args.get("game", "ssq")
    return game if game in GAMES else None


def _window_arg(default=50):
    """解析请求参数中的 window（10~300 之间），异常时取默认值。"""
    try:
        return max(10, min(int(request.args.get("window", default)), 300))
    except (TypeError, ValueError):
        return default


@app.get("/api/history")
def api_history():
    """历史开奖（分页）。

    Query 参数：game / limit（1~300，默认 30）/ offset / refresh=1 强制刷新。
    """
    game = _game_arg()
    if not game:
        return jsonify({"error": "未知玩法"}), 400
    try:
        limit = max(1, min(int(request.args.get("limit", 30)), 300))
        offset = max(0, int(request.args.get("offset", 0)))
    except (TypeError, ValueError):
        limit, offset = 30, 0
    try:
        draws, fetched_at = get_draws(game, refresh=request.args.get("refresh") == "1")
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    return jsonify({
        "game": game, "total": len(draws), "fetched_at": fetched_at,
        "draws": draws[offset:offset + limit],
    })


@app.get("/api/latest")
def api_latest():
    """最新一期开奖（对奖用）。Query 参数：game。"""
    game = _game_arg()
    if not game:
        return jsonify({"error": "未知玩法"}), 400
    try:
        draws, _ = get_draws(game)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    return jsonify({"game": game, "latest": draws[0]})


@app.get("/api/stats")
def api_stats():
    """统计数据。Query 参数：game / window / refresh=1。"""
    game = _game_arg()
    if not game:
        return jsonify({"error": "未知玩法"}), 400
    window = _window_arg()
    try:
        draws, fetched_at = get_draws(game, refresh=request.args.get("refresh") == "1")
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    stats = compute_stats(draws, game, window)
    stats["latest"] = draws[0]
    stats["fetched_at"] = fetched_at
    stats["total_draws"] = len(draws)
    return jsonify(stats)


@app.post("/api/predict")
def api_predict():
    """策略选号。

    Body（JSON）：game / strategy / count（1~10）/ window /
    anchor / exclude（{区域key: [号码]}）。

    Returns:
        每注含 nums 号码、reasons 选号依据、features 形态特征；
        balanced 策略会对主区做形态校验，不通过则整注重抽（最多 25 次）。
    """
    body = request.get_json(silent=True) or {}
    game_key = body.get("game") if body.get("game") in GAMES else "ssq"
    strategy = body.get("strategy") if body.get("strategy") in STRATEGIES else "smart"
    try:
        count = max(1, min(int(body.get("count", 5)), 10))
        window = max(10, min(int(body.get("window", 50)), 300))
    except (TypeError, ValueError):
        count, window = 5, 50
    exclude = body.get("exclude") or {}
    anchor = body.get("anchor") or {}
    try:
        draws, _ = get_draws(game_key)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    stats = compute_stats(draws, game_key, window)
    game = GAMES[game_key]
    main = game["zones"][0]["key"]
    p15, p85 = stats["sum"]["p15"], stats["sum"]["p85"]
    odd_seen = set(stats["odd_even"])
    rng = random.Random()
    picks = []
    try:
        for _ in range(count):
            if strategy == "balanced":
                # 主区先按 smart 权重生成，再检查形态，不合适整注重抽
                for _try in range(25):
                    nums, reasons = _gen(game, stats, "smart", exclude, anchor, rng)
                    if _shape_ok(nums[main], p15, p85, odd_seen):
                        break
            else:
                nums, reasons = _gen(game, stats, strategy, exclude, anchor, rng)
            ns = nums[main]
            odd = sum(1 for x in ns if x % 2)
            picks.append({
                "nums": nums,
                "reasons": reasons,
                "features": {
                    "sum": sum(ns),
                    "odd_even": f"{odd}:{len(ns) - odd}",
                    "consecutive": sum(1 for a, b in zip(ns, ns[1:]) if b - a == 1),
                },
            })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({
        "game": game_key,
        "strategy": strategy,
        "strategy_name": STRATEGIES[strategy],
        "window": stats["window_used"],
        "latest": draws[0],
        "picks": picks,
    })


@app.post("/api/ai_report")
def api_report():
    """AI 分析报告：配置了大模型则调用 LLM，否则回退内置统计报告。

    Body（JSON）：game / strategy / window。
    系统提示词强制模型声明"开奖随机、不承诺中奖"。
    """
    body = request.get_json(silent=True) or {}
    game_key = body.get("game") if body.get("game") in GAMES else "ssq"
    strategy = body.get("strategy") if body.get("strategy") in STRATEGIES else "smart"
    window = _window_arg()
    try:
        draws, _ = get_draws(game_key)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    stats = compute_stats(draws, game_key, window)
    stats["latest"] = draws[0]
    strategy_name = STRATEGIES[strategy]
    if not llm_ready():
        return jsonify({"source": "builtin",
                        "text": builtin_report(game_key, stats, strategy_name)})
    system = (
        "你是一名彩票数据分析师。你必须遵守：开奖是独立随机事件，历史统计不能预测未来，"
        "报告中不得暗示或承诺任何中奖可能性，不要鼓励加大投注。请基于用户提供的真实统计数据，"
        "用轻松易懂的中文写一份分析报告，包含：1) 数据概览；2) 冷热号与遗漏解读；"
        "3) 和值、奇偶等走势特征；4) 对所选选号策略的解释；5) 该策略下可以关注的号码倾向"
        "（说明只是统计偏好而非预测）。篇幅 300~500 字，分点呈现。"
    )
    prompt = json.dumps({
        "玩法": GAMES[game_key]["name"],
        "统计窗口": f"近{stats['window_used']}期",
        "最新一期": {"期号": stats["latest"]["code"], "日期": stats["latest"]["date"]},
        "各区域统计": stats["zones"],
        "和值均值": stats["sum"]["mean"],
        "和值常见区间": [stats["sum"]["p15"], stats["sum"]["p85"]],
        "奇偶比分布": stats["odd_even"],
        "大小比分布": stats["big_small"],
        "连号期数分布": stats["consecutive"],
        "当前选号策略": strategy_name,
    }, ensure_ascii=False)
    try:
        text = call_llm(prompt, system)
    except Exception as e:
        return jsonify({
            "source": "builtin",
            "text": builtin_report(game_key, stats, strategy_name)
                    + f"\n\n（大模型调用失败，已回退内置报告：{e}）",
        })
    return jsonify({"source": "llm", "text": text})


@app.get("/api/settings")
def api_get_settings():
    """读取大模型配置。安全起见不回传完整密钥，只回显尾号。"""
    llm = load_settings().get("llm") or {}
    key = llm.get("api_key") or ""
    return jsonify({"llm": {
        "base_url": llm.get("base_url") or "",
        "model": llm.get("model") or "",
        "has_key": bool(key),
        "key_tail": key[-4:] if len(key) >= 4 else "",
    }})


@app.post("/api/settings")
def api_set_settings():
    """保存大模型配置。api_key 为空表示保持原值不变，clear_key 清除密钥。"""
    body = request.get_json(silent=True) or {}
    s = load_settings()
    llm = s.get("llm") or {}
    if "base_url" in body:
        llm["base_url"] = str(body["base_url"]).strip()
    if "model" in body:
        llm["model"] = str(body["model"]).strip()
    if body.get("clear_key"):
        llm["api_key"] = ""
    elif body.get("api_key"):
        llm["api_key"] = str(body["api_key"]).strip()
    s["llm"] = llm
    save_settings(s)
    return jsonify({"ok": True})


@app.post("/api/llm_test")
def api_llm_test():
    """大模型连通性测试：发一条最小消息，验证配置是否可用。"""
    if not llm_ready():
        return jsonify({"ok": False, "error": "请先填写完整的 Base URL / 模型 / API Key"}), 400
    try:
        text = call_llm("请只回复两个字符：ok", "你是连通性测试助手。", timeout=30)
        return jsonify({"ok": True, "reply": (text or "").strip()[:50]})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502


if __name__ == "__main__":
    print("*" * 56)
    print("*  选号缪斯 PickMuse")
    print("*  数据仅供参考娱乐 · 彩票开奖独立随机 · 理性购彩")
    print("*  打开 http://127.0.0.1:8765 开始使用")
    print("*" * 56)
    app.run(host="127.0.0.1", port=8765, debug=False)
