#!/usr/bin/env python3
"""
地图数据管线的共享工具：投影、抽稀、面积、仿射标定。

build-map.py（整包地图）和 build-counties.py（区县分片）都用这里的实现，
两边必须逐位一致 —— 区县要能和 cn.json 的市界严丝合缝对上，靠的就是这一点。
"""
import json, math, os, time, urllib.error, urllib.request

FETCH_RETRIES = 4

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
    ΣvV 前面是减号。这个符号错了结果仍然「看着差不多」，别改。
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
    """
    下载并缓存到 $TMPDIR，重跑不重复请求。

    先写 .part 再改名：urlretrieve 传到一半断了会抛 ContentTooShortError，
    但半个文件已经落在目标路径上，下次「缓存命中」就直接读到截断的 JSON。
    370 个分片的循环里这种失败是必然会遇到的，所以缓存必须是原子的。
    """
    cache = os.path.join(os.environ.get('TMPDIR', '/tmp'), cache_name)
    if not os.path.exists(cache):
        print(f'  下载 {url}')
        part = cache + '.part'
        last = None
        for attempt in range(FETCH_RETRIES):
            try:
                urllib.request.urlretrieve(url, part)
                # 传完了也要确认是完整 JSON：截断的响应有时不触发 ContentTooShortError
                with open(part) as f:
                    json.load(f)
                os.replace(part, cache)
                last = None
                break
            except (urllib.error.ContentTooShortError, urllib.error.URLError,
                    json.JSONDecodeError, TimeoutError) as e:
                last = e
                if os.path.exists(part):
                    os.remove(part)
                if attempt + 1 < FETCH_RETRIES:
                    print(f'    第 {attempt + 1} 次失败（{type(e).__name__}），重试')
                    time.sleep(1.5 * (attempt + 1))
        if last is not None:
            raise last
    with open(cache) as f:
        return json.load(f)
