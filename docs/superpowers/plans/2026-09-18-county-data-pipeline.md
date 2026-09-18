# 区县数据管线（P1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成与现有 `cn.json` 严格同坐标空间的区县分片数据，并用实测数字关掉「分片体积未知」这个风险。

**Architecture:** 把 `build-map.py` 里的投影与几何工具抽到 `scripts/mapkit.py`；新脚本 `scripts/build-counties.py` 先**标定**出 `cn.json` 的仿射变换（不重新生成 `cn.json`），再按地级单元逐个抓取下级区划、投影、抽稀、套用同一变换，输出每市一片的 JSON，外加一份索引和一份无几何名录。

**Tech Stack:** Python 3.9 标准库（`json` / `math` / `urllib`），无第三方依赖。测试用纯 `assert` 脚本，不引入 pytest。前端侧的 vitest 在 P3 引入，P1 不涉及。

**Spec:** `docs/superpowers/specs/2026-09-18-county-drilldown-design.md`（P1 对应 §2）

## Global Constraints

- **现有 `public/data/cn.json` 不可修改。** 它是坐标空间基准，`src/lib/regions.ts` 的 `view: { x: -14, y: -14, w: 1028, h: 874 }` 与 `inset.viewBox: '650 795 210 358'` 都依赖它。
- Albers 参数固定为 `lon0=105, lat0=35, p1=25, p2=47`（`cn.json` 生成时所用，见 `scripts/build-map.py` 注释）。
- 区县抽稀容差起点 `eps = 0.00012`；市级是 `0.00035`，不要改市级的。
- 区县坐标保留 **2** 位小数；市级是 1 位。
- 数据源 `https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json`，下载一律缓存到 `$TMPDIR`，重跑不重复请求。
- 跳过的地级单元：`460300` 三沙市、`810000` 香港、`820000` 澳门、`710000` 台湾。
- 标定残差验收线：最大残差 < 0.06。
- 体积验收线：单市分片 ≤ 40KB，全国合计 ≤ 12MB。
- 几何对齐验收线：每市区县面积之和 vs 该市面积，误差 < 1%。
- 提交信息按 `type(scope): 中文描述`，scope 用 `map`。

---

### Task 1: 抽出共享几何工具 `mapkit.py`

`build-counties.py` 需要与 `build-map.py` 完全相同的投影和抽稀实现。复制一份必然会漂移，所以先抽出来。

**Files:**
- Create: `scripts/mapkit.py`
- Create: `scripts/test_mapkit.py`
- Modify: `scripts/build-map.py`（删掉 `rings_of` / `make_proj` / `dp`，改为从 `mapkit` 导入）

**Interfaces:**
- Consumes: 无
- Produces:
  - `rings_of(geom: dict) -> list[list[list[float]]]`
  - `make_proj(lon0, lat0, p1, p2) -> tuple[Callable[[float,float], tuple[float,float]], float]`
  - `dp(pts: list[tuple[float,float]], eps: float) -> list[tuple[float,float]]`
  - `ring_area(pts: list[tuple[float,float]]) -> float`（绝对值）
  - `fit_affine(pairs: list[tuple[tuple,tuple]]) -> tuple[float,float,float]` 返回 `(s, a, b)`
  - `apply_affine(s, a, b, x, y) -> tuple[float,float]`
  - `fetch_json(url: str, cache_name: str) -> dict`

- [ ] **Step 1: 写失败的测试**

创建 `scripts/test_mapkit.py`：

```python
#!/usr/bin/env python3
"""mapkit 的回归测试。跑：python3 scripts/test_mapkit.py"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit import rings_of, make_proj, dp, ring_area, fit_affine, apply_affine

def test_proj_origin_is_zero():
    """基准经线与基准纬线的交点必须投到原点，这是投影实现是否正确的硬约束"""
    proj, n = make_proj(lon0=105, lat0=35, p1=25, p2=47)
    x, y = proj(105, 35)
    assert abs(x) < 1e-12, x
    assert abs(y) < 1e-12, y
    assert 0 < n < 1, n

def test_proj_east_is_positive_x():
    proj, _ = make_proj(lon0=105, lat0=35, p1=25, p2=47)
    assert proj(110, 35)[0] > 0
    assert proj(100, 35)[0] < 0

def test_rings_of_polygon_and_multipolygon():
    assert rings_of({'type': 'Polygon', 'coordinates': [[[0, 0]]]}) == [[[0, 0]]]
    assert rings_of({'type': 'MultiPolygon',
                     'coordinates': [[[[0, 0]]], [[[1, 1]]]]}) == [[[0, 0]], [[1, 1]]]
    assert rings_of({'type': 'Point', 'coordinates': [0, 0]}) == []

def test_dp_keeps_endpoints_and_drops_collinear():
    pts = [(0, 0), (1, 0), (2, 0), (3, 0)]
    out = dp(pts, 0.1)
    assert out[0] == (0, 0) and out[-1] == (3, 0)
    assert len(out) == 2, out

def test_dp_keeps_a_real_corner():
    pts = [(0, 0), (1, 5), (2, 0)]
    assert len(dp(pts, 0.1)) == 3

def test_ring_area_unit_square():
    assert abs(ring_area([(0, 0), (1, 0), (1, 1), (0, 1)]) - 1.0) < 1e-12
    # 反向绕序取绝对值，结果一样
    assert abs(ring_area([(0, 1), (1, 1), (1, 0), (0, 0)]) - 1.0) < 1e-12

def test_fit_affine_recovers_exact_transform():
    """
    y 方向带翻转，最小二乘里 ΣvV 前是减号。
    写成加号会得到 s·(Σu²-Σv²)/(Σu²+Σv²)，在南北跨度大的数据上偏得很明显，
    这个用例就是专门钉那个符号的。
    """
    s, a, b = 4.2, -17.5, 913.0
    src = [(0.0, 0.0), (10.0, 3.0), (-4.0, 25.0), (7.5, -11.25), (30.0, 40.0)]
    pairs = [(p, (s * p[0] + a, -s * p[1] + b)) for p in src]
    fs, fa, fb = fit_affine(pairs)
    assert abs(fs - s) < 1e-9, fs
    assert abs(fa - a) < 1e-9, fa
    assert abs(fb - b) < 1e-9, fb

def test_fit_affine_survives_rounding_noise():
    """cn.json 的坐标是 1 位小数，所以对应点自带 ±0.05 的量化噪声"""
    s, a, b = 4.2, -17.5, 913.0
    src = [(i * 1.7, i * -2.3 + 5) for i in range(60)]
    pairs = [(p, (round(s * p[0] + a, 1), round(-s * p[1] + b, 1))) for p in src]
    fs, fa, fb = fit_affine(pairs)
    assert abs(fs - s) < 1e-3, fs
    worst = max(max(abs(apply_affine(fs, fa, fb, *p)[i] - q[i]) for i in (0, 1))
                for p, q in pairs)
    assert worst < 0.06, worst

def test_apply_affine_flips_y():
    assert apply_affine(2.0, 1.0, 100.0, 3.0, 4.0) == (7.0, 92.0)

if __name__ == '__main__':
    fns = [v for k, v in sorted(globals().items()) if k.startswith('test_')]
    for fn in fns:
        fn()
        print('  ok', fn.__name__)
    print(f'{len(fns)} passed')
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `python3 scripts/test_mapkit.py`
Expected: FAIL —— `ModuleNotFoundError: No module named 'mapkit'`

- [ ] **Step 3: 写 `scripts/mapkit.py`**

`rings_of` / `make_proj` / `dp` 从 `scripts/build-map.py` 原样搬过来，不要顺手"改进"，搬动本身要零行为变化。

```python
#!/usr/bin/env python3
"""
地图数据管线的共享工具：投影、抽稀、面积、仿射标定。

build-map.py（整包地图）和 build-counties.py（区县分片）都用这里的实现，
两边必须逐位一致 —— 区县要能和 cn.json 的市界严丝合缝对上，靠的就是这一点。
"""
import json, math, os, urllib.request

# ---------------------------------------------------------------- 几何

def rings_of(geom):
    t, c = geom['type'], geom['coordinates']
    if t == 'Polygon': return list(c)
    if t == 'MultiPolygon': return [r for poly in c for r in poly]
    return []

def make_proj(lon0, lat0, p1, p2):
    """Albers 等积圆锥投影。返回 (proj, n)，proj(lon, lat) -> (x, y)"""
    lat0, lon0 = math.radians(lat0), math.radians(lon0)
    p1, p2 = math.radians(p1), math.radians(p2)
    n = (math.sin(p1) + math.sin(p2)) / 2
    C = math.cos(p1) ** 2 + 2 * n * math.sin(p1)
    rho0 = math.sqrt(C - 2 * n * math.sin(lat0)) / n
    def proj(lon, lat):
        lam, phi = math.radians(lon), math.radians(lat)
        rho = math.sqrt(max(C - 2 * n * math.sin(phi), 1e-9)) / n
        th = n * (lam - lon0)
        return rho * math.sin(th), rho0 - rho * math.cos(th)
    return proj, n

def dp(pts, eps):
    """道格拉斯-普克抽稀。首末点必定保留 —— 标定就靠这个性质取精确对应点。"""
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1: continue
        ax, ay = pts[i]; bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, bi = -1, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L if L else math.hypot(px - ax, py - ay)
            if d > best: best, bi = d, k
        if best > eps:
            keep[bi] = True; stack.append((i, bi)); stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]

def ring_area(pts):
    """鞋带公式，取绝对值 —— 绕序无关"""
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i - 1]
        x2, y2 = pts[i]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2

# ---------------------------------------------------------------- 仿射标定

def fit_affine(pairs):
    """
    拟合 X = s·x + a、Y = -s·y + b，返回 (s, a, b)。

    pairs 是 [((x, y), (X, Y)), ...]，x/y 是投影坐标，X/Y 是 cn.json 坐标。
    y 方向带翻转，所以残差是 (s·u - U) 和 (-s·v - V)，对 s 求导后
    ΣvV 前面是减号。这个符号错了结果仍然"看着差不多"，别改。
    """
    n = len(pairs)
    if n < 2: raise ValueError('至少要两组对应点')
    xm = sum(p[0][0] for p in pairs) / n
    ym = sum(p[0][1] for p in pairs) / n
    Xm = sum(p[1][0] for p in pairs) / n
    Ym = sum(p[1][1] for p in pairs) / n
    num = den = 0.0
    for (x, y), (X, Y) in pairs:
        u, v, U, V = x - xm, y - ym, X - Xm, Y - Ym
        num += u * U - v * V
        den += u * u + v * v
    if den == 0: raise ValueError('对应点退化成一个点')
    s = num / den
    return s, Xm - s * xm, Ym + s * ym

def apply_affine(s, a, b, x, y):
    return s * x + a, -s * y + b

def affine_residual(s, a, b, pairs):
    """返回 (最大残差, 平均残差)，按每个点的 x/y 分量取最大"""
    worst = 0.0
    total = 0.0
    for (x, y), (X, Y) in pairs:
        px, py = apply_affine(s, a, b, x, y)
        d = max(abs(px - X), abs(py - Y))
        worst = max(worst, d)
        total += d
    return worst, total / len(pairs)

# ---------------------------------------------------------------- 下载

def fetch_json(url, cache_name):
    """下载并缓存到 $TMPDIR，重跑不重复请求"""
    cache = os.path.join(os.environ.get('TMPDIR', '/tmp'), cache_name)
    if not os.path.exists(cache):
        print(f'  下载 {url}')
        urllib.request.urlretrieve(url, cache)
    with open(cache) as f:
        return json.load(f)
```

- [ ] **Step 4: 跑测试，确认全过**

Run: `python3 scripts/test_mapkit.py`
Expected: PASS，`9 passed`

- [ ] **Step 5: 把 `build-map.py` 改成导入 mapkit**

在 `scripts/build-map.py` 顶部，把 `import json, math, os, sys, urllib.request` 之后补上：

```python
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit import rings_of, make_proj, dp
```

然后删掉文件里「几何工具」那一节的 `rings_of`、`make_proj`、`dp` 三个函数定义（保留 `hokkaido_kurils` / `tokyo_remote` / `jp_group` 这些区域专属的）。`build()` 里的调用一个字都不用改。

- [ ] **Step 6: 用 jp.json 做行为不变回归**

Run:
```bash
python3 scripts/build-map.py jp
git diff --stat public/data/jp.json
```
Expected: `git diff` **无输出** —— 重构后重新生成的 jp.json 与已提交的逐字节相同。

如果有 diff，先判断是不是上游数据源变了（`dataofjapan/land` 的 geojson 更新过）：
```bash
git stash -- public/data/jp.json   # 先把改动收起来，不要提交
```
然后手工确认重构没引入行为变化 —— 在 Python REPL 里对同一组输入分别调用旧实现（`git show HEAD:scripts/build-map.py` 里的）和 `mapkit` 的实现，比较输出。确认一致后再继续，**jp.json 不要提交任何改动**。

- [ ] **Step 7: 提交**

```bash
git add scripts/mapkit.py scripts/test_mapkit.py scripts/build-map.py
git commit -m "refactor(map): 抽出 mapkit 共享投影与几何工具"
```

---

### Task 2: 标定 `cn.json` 的仿射变换

**Files:**
- Create: `scripts/build-counties.py`（本任务只实现 `calibrate` 子命令）
- Create: `scripts/cn-transform.json`（生成物，要提交 —— 它是后续构建的输入）

**Interfaces:**
- Consumes: `mapkit.{make_proj, dp, rings_of, fit_affine, apply_affine, affine_residual, fetch_json}`
- Produces:
  - `scripts/cn-transform.json`：`{"s": float, "a": float, "b": float, "proj": {...}, "residual": {"fit": float, "holdout": float}, "calibratedOn": "YYYY-MM-DD"}`
  - `load_transform() -> tuple[float,float,float]`（Task 3 用）
  - `PROJ_ARGS = dict(lon0=105, lat0=35, p1=25, p2=47)`
  - `SKIP = {460300, 810000, 820000, 710000}`
  - `CN_JSON`、`OUT_DIR` 路径常量

- [ ] **Step 1: 写失败的测试**

在 `scripts/test_mapkit.py` 末尾（`if __name__` 之前）追加：

```python
def _load_bc():
    """build-counties.py 名字里带横线，不能直接 import，按路径加载"""
    import importlib.util
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build-counties.py')
    spec = importlib.util.spec_from_file_location('build_counties', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def test_coarse_from_bboxes_maps_corners():
    """粗估：投影包围盒 → 目标包围盒。y 翻转，所以投影的 min y 对应目标的 max Y"""
    bc = _load_bc()
    s, a, b = bc.coarse_from_bboxes(
        (0.0, 0.0, 2.0, 1.0),      # 投影 bbox: minx miny maxx maxy
        (0.0, 0.0, 1000.0, 500.0),  # 目标 bbox
    )
    assert abs(s - 500.0) < 1e-9, s
    assert abs(apply_affine(s, a, b, 0.0, 0.0)[0] - 0.0) < 1e-9
    assert abs(apply_affine(s, a, b, 2.0, 0.0)[0] - 1000.0) < 1e-9
    # 投影 y=0（最南）→ 目标 Y=500（最下）
    assert abs(apply_affine(s, a, b, 0.0, 0.0)[1] - 500.0) < 1e-9
    assert abs(apply_affine(s, a, b, 0.0, 1.0)[1] - 0.0) < 1e-9
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `python3 scripts/test_mapkit.py`
Expected: FAIL —— 找不到 `build-counties.py`

- [ ] **Step 3: 写 `build-counties.py` 的 calibrate**

```python
#!/usr/bin/env python3
"""
生成区县分片，坐标空间与现有 public/data/cn.json 严格一致。

    python3 scripts/build-counties.py calibrate          # 标定 cn.json 的变换
    python3 scripts/build-counties.py build 530100 ...   # 指定几个市
    python3 scripts/build-counties.py build --all        # 全量 + 索引 + 名录

为什么要标定：cn.json 是更早生成的，归一化常量（minx/miny/scale/H）没有存下来，
而 src/lib/regions.ts 里的 view 和 inset.viewBox 都是在它的坐标空间里手调的，
重新生成 cn.json 会让南海诸岛小图悄悄错位。所以把 cn.json 当不可变基准，
反推出它的仿射变换再复用。详见
docs/superpowers/specs/2026-09-18-county-drilldown-design.md §2.1
"""
import datetime, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit import (affine_residual, apply_affine, dp, fetch_json, fit_affine,
                    make_proj, ring_area, rings_of)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CN_JSON = os.path.join(ROOT, 'public/data/cn.json')
OUT_DIR = os.path.join(ROOT, 'public/data/cn')
TRANSFORM = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cn-transform.json')

BOUND = 'https://geo.datav.aliyun.com/areas_v3/bound/{}_full.json'
SRC_LABEL = 'geo.datav.aliyun.com/areas_v3'

# cn.json 生成时所用的 Albers 参数，记在 build-map.py 的注释里
PROJ_ARGS = dict(lon0=105, lat0=35, p1=25, p2=47)

CITY_EPS = 0.00035     # cn.json 用的容差，标定时要复现它
COUNTY_EPS = 0.00012   # 区县用的容差

# 下级区划数据缺失或质量不一，跳过
SKIP = {460300, 810000, 820000, 710000}

# 标定用云南，验证用四川。两个都是多地级单元、跨度适中的省。
FIT_PROV, HOLDOUT_PROV = 530000, 510000

RESIDUAL_LIMIT = 0.06  # cn.json 坐标 1 位小数，量化上界 ±0.05

def load_cn():
    with open(CN_JSON) as f:
        return json.load(f)

def coarse_from_bboxes(src_bbox, dst_bbox):
    """
    用整体包围盒粗估 (s, a, b)。y 方向翻转：投影的 min y 对应目标的 max Y。
    只用来给最近邻配对提供一个够用的初值。
    """
    sx0, sy0, sx1, sy1 = src_bbox
    dx0, dy0, dx1, dy1 = dst_bbox
    s = (dx1 - dx0) / (sx1 - sx0)
    a = dx0 - s * sx0
    b = dy1 + s * sy0
    return s, a, b

def cn_bbox(cn):
    xs = [r[i] for u in cn['u'] for r in u['g'] for i in range(0, len(r), 2)]
    ys = [r[i] for u in cn['u'] for r in u['g'] for i in range(1, len(r), 2)]
    return min(xs), min(ys), max(xs), max(ys)

def projected_rings(features, proj, eps, key='adcode'):
    """{adcode: [抽稀后的投影环, ...]}，抽稀与 build-map.py 完全同法"""
    out = {}
    for f in features:
        code = int(f['properties'][key])
        rs = []
        for r in rings_of(f['geometry']):
            pr = dp([proj(c[0], c[1]) for c in r], eps)
            if len(pr) >= 4: rs.append(pr)
        if rs: out[code] = rs
    return out

def head_pairs(src_by_code, cn, s, a, b, tol):
    """
    取对应点：dp() 必定保留首点，所以每个环的首顶点是精确对应关系。
    环的顺序可能因为丢环而错位，所以按当前变换下的距离做最近邻配对，不按下标。
    """
    cn_by_code = {u['a']: u for u in cn['u']}
    pairs = []
    for code, rings in src_by_code.items():
        u = cn_by_code.get(code)
        if not u: continue
        targets = [(r[0], r[1]) for r in u['g']]
        used = set()
        for pr in rings:
            px, py = apply_affine(s, a, b, pr[0][0], pr[0][1])
            best, bd = None, tol
            for i, (tx, ty) in enumerate(targets):
                if i in used: continue
                d = max(abs(px - tx), abs(py - ty))
                if d < bd: bd, best = d, i
            if best is not None:
                used.add(best)
                pairs.append((pr[0], targets[best]))
    return pairs

def calibrate():
    cn = load_cn()
    proj, _ = make_proj(**PROJ_ARGS)

    # 粗估：全国省级一次请求，territory 与 cn.json 覆盖同一片
    prov = fetch_json(BOUND.format(100000), 'cn-100000.geojson')
    pts = [proj(c[0], c[1]) for f in prov['features']
           for r in rings_of(f['geometry']) for c in r]
    src_bbox = (min(p[0] for p in pts), min(p[1] for p in pts),
                max(p[0] for p in pts), max(p[1] for p in pts))
    s, a, b = coarse_from_bboxes(src_bbox, cn_bbox(cn))
    print(f'粗估 s={s:.6f} a={a:.4f} b={b:.4f}')

    # 精算：云南的地级单元，首顶点最近邻配对 + 最小二乘，迭代两轮
    fit_src = projected_rings(
        fetch_json(BOUND.format(FIT_PROV), f'cn-{FIT_PROV}.geojson')['features'],
        proj, CITY_EPS)
    tol = 8.0
    for it in range(2):
        pairs = head_pairs(fit_src, cn, s, a, b, tol)
        if len(pairs) < 8:
            sys.exit(f'✗ 只配到 {len(pairs)} 组对应点，粗估偏太多，检查投影参数')
        s, a, b = fit_affine(pairs)
        worst, avg = affine_residual(s, a, b, pairs)
        print(f'第 {it + 1} 轮：{len(pairs)} 组点  最大残差 {worst:.4f}  平均 {avg:.4f}')
        tol = 1.0

    if worst >= RESIDUAL_LIMIT:
        sys.exit(f'✗ 最大残差 {worst:.4f} ≥ {RESIDUAL_LIMIT}，'
                 f'投影参数推断不对。先按 spec §13 扫 lat0/p1/p2，不要继续往下做。')

    # 验证集：四川
    ho_src = projected_rings(
        fetch_json(BOUND.format(HOLDOUT_PROV), f'cn-{HOLDOUT_PROV}.geojson')['features'],
        proj, CITY_EPS)
    ho_pairs = head_pairs(ho_src, cn, s, a, b, 1.0)
    ho_worst, ho_avg = affine_residual(s, a, b, ho_pairs)
    print(f'验证集：{len(ho_pairs)} 组点  最大残差 {ho_worst:.4f}  平均 {ho_avg:.4f}')
    if ho_worst >= RESIDUAL_LIMIT:
        sys.exit(f'✗ 验证集残差 {ho_worst:.4f} ≥ {RESIDUAL_LIMIT}，拟合集过拟合或数据源版本不一致')

    with open(TRANSFORM, 'w') as f:
        json.dump({'s': s, 'a': a, 'b': b, 'proj': PROJ_ARGS,
                   'residual': {'fit': round(worst, 5), 'holdout': round(ho_worst, 5)},
                   'calibratedOn': datetime.date.today().isoformat()},
                  f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'✔ s={s:.8f} a={a:.6f} b={b:.6f}  →  {os.path.relpath(TRANSFORM, ROOT)}')

def load_transform():
    if not os.path.exists(TRANSFORM):
        sys.exit('✗ 还没标定，先跑：python3 scripts/build-counties.py calibrate')
    with open(TRANSFORM) as f:
        t = json.load(f)
    return t['s'], t['a'], t['b']

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'calibrate'
    if cmd == 'calibrate': calibrate()
    else: sys.exit(f'未知命令 {cmd}')
```

- [ ] **Step 4: 跑测试，确认全过**

Run: `python3 scripts/test_mapkit.py`
Expected: PASS，`10 passed`

- [ ] **Step 5: 实际标定**

Run: `python3 scripts/build-counties.py calibrate`
Expected: 两轮迭代的最大残差都 < 0.06，验证集残差同量级，最后打印 `✔ s=... a=... b=...`

**这一步是 P1 的第一个闸门。** 残差下不去就停下来，按 spec §13 扫 `lat0/p1/p2`，不要带着一个对不上的变换继续做区县。

- [ ] **Step 6: 提交**

```bash
git add scripts/build-counties.py scripts/cn-transform.json scripts/test_mapkit.py
git commit -m "feat(map): 标定 cn.json 的仿射变换"
```

---

### Task 3: 试点 5 个市，量出体积与对齐误差

这一步的产出是**数字**，不是代码。spec §2.3 里 40KB / 12MB / 1% 三条线全靠它验证。

**Files:**
- Modify: `scripts/build-counties.py`（加 `build` 子命令）
- Create: `public/data/cn/{530100,310000,440300,150700,540600}.json`

**Interfaces:**
- Consumes: `load_transform()`、`PROJ_ARGS`、`COUNTY_EPS`、`SKIP`、`OUT_DIR`、`mapkit.*`
- Produces:
  - `build_one(code, name, proj, s, a, b, city_area) -> dict | None` 返回 `{'n': 区县数, 'size': 字节, 'pts': 坐标点数, 'cover': 面积覆盖率}`，跳过或无下级时返回 `None`
  - `city_area_of(unit) -> float`

- [ ] **Step 1: 写失败的测试**

在 `scripts/test_mapkit.py` 里追加（`_load_bc()` 在 Task 2 已经定义过，直接用）：

```python
def test_city_area_sums_all_rings():
    bc = _load_bc()
    unit = {'g': [[0, 0, 2, 0, 2, 2, 0, 2], [10, 10, 11, 10, 11, 11, 10, 11]]}
    assert abs(bc.city_area_of(unit) - 5.0) < 1e-12   # 4 + 1

def test_shard_shape_is_minimal():
    """分片里不该有 w/h —— 坐标已经在全国空间里了"""
    bc = _load_bc()
    shard = bc.make_shard(530100, [
        {'n': '五华区', 'a': 530102, 'c': (1.0, 2.0), 'rings': [[(0, 0), (1, 0), (1, 1)]]},
    ])
    assert set(shard.keys()) == {'p', 'u'}
    assert shard['p'] == 530100
    assert set(shard['u'][0].keys()) == {'n', 'a', 'c', 'g'}
    assert shard['u'][0]['g'] == [[0.0, 0.0, 1.0, 0.0, 1.0, 1.0]]
    assert shard['u'][0]['c'] == [1.0, 2.0]
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `python3 scripts/test_mapkit.py`
Expected: FAIL —— `AttributeError: module 'build_counties' has no attribute 'city_area_of'`

- [ ] **Step 3: 在 `build-counties.py` 里实现 build**

在 `load_transform()` 之后插入：

```python
# ---------------------------------------------------------------- 分片生成

def city_area_of(unit):
    """cn.json 单元的面积：所有环的绝对面积之和。区县侧用同样算法，比值才有意义。"""
    total = 0.0
    for r in unit['g']:
        total += ring_area([(r[i], r[i + 1]) for i in range(0, len(r), 2)])
    return total

def make_shard(parent, counties):
    """counties: [{'n','a','c','rings'}]，rings 是已套过仿射的点列"""
    return {
        'p': parent,
        'u': [{
            'n': c['n'],
            'a': c['a'],
            'c': [round(c['c'][0], 2), round(c['c'][1], 2)],
            'g': [[round(v, 2) for p in r for v in p] for r in c['rings']],
        } for c in counties],
    }

def build_one(code, name, proj, s, a, b, city_area):
    if code in SKIP:
        return None
    try:
        raw = fetch_json(BOUND.format(code), f'cn-{code}.geojson')
    except Exception as e:
        print(f'  ✗ {code} {name} 取数失败：{e}')
        return None

    counties, pts = [], 0
    for f in raw['features']:
        p = f['properties']
        # 字段名来自 DataV areas_v3 的约定，不要当既成事实 —— 对不上就把实际字段打出来
        if 'adcode' not in p or 'name' not in p:
            sys.exit(f'✗ {code} 的要素属性里没有 adcode/name，实际字段：{sorted(p)}')
        sub = int(p['adcode'])
        if sub == code:          # 有些市的 _full 会把自己也带上，去掉
            continue
        rings = []
        for r in rings_of(f['geometry']):
            pr = dp([proj(c[0], c[1]) for c in r], COUNTY_EPS)
            if len(pr) >= 4:
                rings.append([apply_affine(s, a, b, x, y) for x, y in pr])
        if not rings:
            continue
        big = max(rings, key=len)
        counties.append({
            'n': p['name'], 'a': sub, 'rings': rings,
            'c': (sum(q[0] for q in big) / len(big), sum(q[1] for q in big) / len(big)),
        })
        pts += sum(len(r) for r in rings)

    if not counties:
        print(f'  · {code} {name} 没有下级区划，跳过')
        return None

    shard = make_shard(code, counties)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f'{code}.json')
    with open(path, 'w') as f:
        json.dump(shard, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(path)

    area = sum(ring_area(r) for c in counties for r in c['rings'])
    cover = area / city_area if city_area else 0.0
    flag = '' if abs(cover - 1) < 0.01 else '  ⚠ 面积对不上'
    print(f'  {code} {name:<12} {len(counties):>3} 个区县  {pts:>6} 点  '
          f'{size / 1024:>6.1f} KB  覆盖 {cover * 100:>6.2f}%{flag}')
    return {'n': len(counties), 'size': size, 'pts': pts, 'cover': cover}
```

再把 `__main__` 换成：

```python
PILOT = [530100, 310000, 440300, 150700, 540600]   # 面积悬殊，用来压体积上限

def build(codes):
    cn = load_cn()
    proj, _ = make_proj(**PROJ_ARGS)
    s, a, b = load_transform()
    by_code = {u['a']: u for u in cn['u']}
    stats, worst_cover = {}, 0.0
    for code in codes:
        u = by_code.get(code)
        if not u:
            print(f'  ✗ {code} 不在 cn.json 里')
            continue
        r = build_one(code, u['n'], proj, s, a, b, city_area_of(u))
        if r:
            stats[code] = r
            worst_cover = max(worst_cover, abs(r['cover'] - 1))
    if not stats:
        sys.exit('✗ 一片都没生成')
    sizes = sorted(v['size'] for v in stats.values())
    total = sum(sizes)
    mid = sizes[len(sizes) // 2]
    print(f'\n共 {len(stats)} 片 · 合计 {total / 1024 / 1024:.2f} MB · '
          f'中位 {mid / 1024:.1f} KB · 最大 {sizes[-1] / 1024:.1f} KB · '
          f'面积最大偏差 {worst_cover * 100:.2f}%')
    if sizes[-1] > 40 * 1024:
        print(f'⚠ 最大分片超过 40KB，考虑调大 COUNTY_EPS（现在 {COUNTY_EPS}）')
    if worst_cover >= 0.01:
        print('⚠ 有市的区县面积和市界对不上超过 1%，几何没对齐，先查标定')
    return stats

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'calibrate'
    if cmd == 'calibrate':
        calibrate()
    elif cmd == 'build':
        args = sys.argv[2:]
        build(PILOT if not args else [int(x) for x in args])
    else:
        sys.exit(f'未知命令 {cmd}')
```

- [ ] **Step 4: 跑测试，确认全过**

Run: `python3 scripts/test_mapkit.py`
Expected: PASS，`12 passed`

- [ ] **Step 5: 跑试点，把数字记下来**

Run: `python3 scripts/build-counties.py build`
Expected: 5 行报告，每行的「覆盖」都在 99.00%–101.00% 之间。

**这是 P1 的第二个闸门。** 把打印出来的中位/最大 KB 和面积偏差抄到 Task 5 的文档里。
- 覆盖率明显偏离 100% → 几何没对齐，回 Task 2 查标定，不要靠调 eps 掩盖
- 最大分片超 40KB → 把 `COUNTY_EPS` 调大（试 0.0002），重跑，直到满足；记下最终值

- [ ] **Step 6: 提交**

```bash
git add scripts/build-counties.py scripts/test_mapkit.py public/data/cn/
git commit -m "feat(map): 区县分片生成与试点 5 市实测"
```

---

### Task 4: 全量生成 + 索引 + 名录

**Files:**
- Modify: `scripts/build-counties.py`（`--all`、`index.json`、`names.json`）
- Create: `public/data/cn/*.json`（约 366 片）、`public/data/cn/index.json`、`public/data/cn/names.json`

**Interfaces:**
- Consumes: Task 3 的 `build(codes) -> dict[int, dict]`
- Produces: `public/data/cn/index.json`（`{src, fetchedOn, eps, shards: {adcode: {n, size}}}`）、`public/data/cn/names.json`（`[{a, n, p}]`）

- [ ] **Step 1: 写失败的测试**

追加到 `scripts/test_mapkit.py`：

```python
def test_names_from_shards_carries_parent():
    """区县重名很多，名录必须带父级市码，搜索结果才能消歧"""
    bc = _load_bc()
    shards = {
        530100: {'p': 530100, 'u': [{'n': '城关区', 'a': 530102, 'c': [1, 2], 'g': []}]},
        520500: {'p': 520500, 'u': [{'n': '城关区', 'a': 520502, 'c': [3, 4], 'g': []}]},
    }
    names = bc.names_from_shards(shards)
    assert len(names) == 2
    assert {n['p'] for n in names} == {530100, 520500}
    assert all(set(n.keys()) == {'a', 'n', 'p'} for n in names)
    # 按 adcode 排序，输出稳定，diff 才有意义
    assert [n['a'] for n in names] == sorted(n['a'] for n in names)
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `python3 scripts/test_mapkit.py`
Expected: FAIL —— `AttributeError: ... has no attribute 'names_from_shards'`

- [ ] **Step 3: 实现全量与索引**

在 `build()` 之前插入：

```python
def names_from_shards(shards):
    """无几何名录，按 adcode 排序保证输出稳定"""
    out = [{'a': u['a'], 'n': u['n'], 'p': sh['p']}
           for sh in shards.values() for u in sh['u']]
    out.sort(key=lambda x: x['a'])
    return out

def write_index(stats, skipped):
    idx = {
        'src': SRC_LABEL,
        'fetchedOn': datetime.date.today().isoformat(),
        'eps': COUNTY_EPS,
        'skipped': sorted(skipped),
        'shards': {str(k): {'n': v['n'], 'size': v['size']}
                   for k, v in sorted(stats.items())},
    }
    with open(os.path.join(OUT_DIR, 'index.json'), 'w') as f:
        json.dump(idx, f, ensure_ascii=False, separators=(',', ':'))
    return idx

def write_names():
    shards = {}
    for fn in sorted(os.listdir(OUT_DIR)):
        if not fn.endswith('.json') or fn in ('index.json', 'names.json'):
            continue
        with open(os.path.join(OUT_DIR, fn)) as f:
            sh = json.load(f)
        shards[sh['p']] = sh
    names = names_from_shards(shards)
    path = os.path.join(OUT_DIR, 'names.json')
    with open(path, 'w') as f:
        json.dump(names, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  names.json  {len(names)} 个区县  {os.path.getsize(path) / 1024:.1f} KB')
```

把 `__main__` 的 `build` 分支改成：

```python
    elif cmd == 'build':
        args = sys.argv[2:]
        if args == ['--all']:
            cn = load_cn()
            codes = [u['a'] for u in cn['u']]
            stats = build(codes)
            skipped = [c for c in codes if c not in stats]
            write_index(stats, skipped)
            write_names()
            print(f'  跳过 {len(skipped)} 个：{sorted(skipped)}')
        else:
            build(PILOT if not args else [int(x) for x in args])
```

- [ ] **Step 4: 跑测试，确认全过**

Run: `python3 scripts/test_mapkit.py`
Expected: PASS，`13 passed`

- [ ] **Step 5: 全量生成**

Run: `python3 scripts/build-counties.py build --all`
Expected: 约 366 行报告 + 汇总行 + `names.json` 行 + 跳过清单。首次跑要下载 370 个文件，几分钟。

验收（对照 spec §2.3）：
- 合计 ≤ 12MB
- 最大单片 ≤ 40KB
- 面积最大偏差 < 1%
- 跳过清单应当只包含 `460300 / 710000 / 810000 / 820000`，外加确实没有下级区划的单元（海南直管县那几个）。出现意料之外的跳过，逐个看报错原因，不要默默放过。

- [ ] **Step 6: 抽查几何对齐**

Run:
```bash
python3 - <<'PY'
import json
cn = {u['a']: u for u in json.load(open('public/data/cn.json'))['u']}
for code in (530100, 310000, 150700):
    sh = json.load(open(f'public/data/cn/{code}.json'))
    xs = [v for u in sh['u'] for r in u['g'] for v in r[0::2]]
    ys = [v for u in sh['u'] for r in u['g'] for v in r[1::2]]
    g = cn[code]['g']
    cx = [r[i] for r in g for i in range(0, len(r), 2)]
    cy = [r[i] for r in g for i in range(1, len(r), 2)]
    print(code, cn[code]['n'],
          'x', round(min(xs) - min(cx), 2), round(max(xs) - max(cx), 2),
          'y', round(min(ys) - min(cy), 2), round(max(ys) - max(cy), 2))
PY
```
Expected: 四个差值都在 ±0.5 以内 —— 区县包围盒与市包围盒基本重合。超出说明仿射套错了。

- [ ] **Step 7: 提交**

```bash
git add scripts/build-counties.py scripts/test_mapkit.py public/data/cn/
git commit -m "feat(map): 全量生成区县分片与索引名录"
```

---

### Task 5: npm 脚本与文档定稿

把实测数字写进文档，关掉 spec §2.3 和 §13 里「体积未实测」这个风险。

**Files:**
- Modify: `package.json`（加 `map:test` / `map:calibrate` / `map:counties`）
- Modify: `README.md`（数据一节加区县）
- Modify: `docs/superpowers/specs/2026-09-18-county-drilldown-design.md`（§2.3 填实测值，§13 删掉已关闭的风险）

**Interfaces:**
- Consumes: Task 4 的实测输出
- Produces: 无代码接口

- [ ] **Step 1: 加 npm 脚本**

在 `package.json` 的 `scripts` 里，`db:restore` 之后追加：

```json
    "map:test": "python3 scripts/test_mapkit.py",
    "map:calibrate": "python3 scripts/build-counties.py calibrate",
    "map:counties": "python3 scripts/build-counties.py build --all"
```

- [ ] **Step 2: 验证脚本可用**

Run: `npm run map:test`
Expected: PASS，`13 passed`

- [ ] **Step 3: 更新 README 的数据一节**

`README.md` 第 20 行附近的数据表格里，中国那一列的 `public/data/cn.json 520 KB` 后面补一行说明区县分片：按市切片放在 `public/data/cn/`，按需加载，附上 Task 4 实测的片数、中位体积与合计体积。同时在第 191 行附近的目录树里补上：

```
├─ cn/                         区县分片，每个地级单元一片
│  ├─ 530100.json              昆明市的区县
│  ├─ index.json               片数与体积索引
│  └─ names.json               全量区县名录（无几何，搜索用）
```

- [ ] **Step 4: 用实测值改 spec**

把 spec §2.3 的标题从「体积目标与验收」改成「体积实测」，把三条目标线替换成 Task 4 打印的实际数字（片数、中位 KB、最大 KB、合计 MB、面积最大偏差、最终采用的 `COUNTY_EPS`）。

把 §13 风险列表里「分片体积未实测」整条删掉；「标定拟合不出来」改成已关闭，并记上 Task 2 实测的拟合集与验证集残差。

- [ ] **Step 5: 提交**

```bash
git add package.json README.md docs/superpowers/specs/2026-09-18-county-drilldown-design.md
git commit -m "docs(map): 区县管线实测数据与脚本说明"
```

---

## P1 完成判据

全部满足才能进 P2：

- [ ] `npm run map:test` 全过
- [ ] `scripts/cn-transform.json` 已提交，拟合集与验证集残差都 < 0.06
- [ ] `public/data/cn/` 下约 366 片 + `index.json` + `names.json` 已提交
- [ ] 合计 ≤ 12MB，最大单片 ≤ 40KB
- [ ] 每市面积覆盖偏差 < 1%
- [ ] `public/data/cn.json` **零改动**（`git diff origin/main...HEAD -- public/data/cn.json` 无输出）
- [ ] `public/data/jp.json` **零改动**
- [ ] spec §2.3 已填实测值，§13 已删掉关闭的风险
