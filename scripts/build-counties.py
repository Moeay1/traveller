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

def cn_bbox(units):
    """cn.json 单元列表的整体包围盒"""
    xs = [r[i] for u in units for r in u['g'] for i in range(0, len(r), 2)]
    ys = [r[i] for u in units for r in u['g'] for i in range(1, len(r), 2)]
    return min(xs), min(ys), max(xs), max(ys)

def proj_bbox(rings_by_code, codes):
    """投影环的整体包围盒，只看 codes 里的单元"""
    pts = [p for c in codes for r in rings_by_code.get(c, []) for p in r]
    return (min(p[0] for p in pts), min(p[1] for p in pts),
            max(p[0] for p in pts), max(p[1] for p in pts))

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

def prov_pair(cn, proj, prov_code):
    """
    取一个省的「同一批地级单元」在两侧的表示。

    粗估必须用两侧完全相同的要素集合。早先拿全国包围盒对齐是错的：
    cn.json 含三沙市（h 到 1147），而省级数据的最南端是另一回事，
    b 会偏出几百个单位，一组对应点都配不上。
    """
    src = projected_rings(
        fetch_json(BOUND.format(prov_code), f'cn-{prov_code}.geojson')['features'],
        proj, CITY_EPS)
    pfx = prov_code // 10000
    units = [u for u in cn['u'] if u['a'] // 10000 == pfx]
    shared = sorted(set(src) & {u['a'] for u in units})
    if not shared:
        sys.exit(f'✗ {prov_code} 在 cn.json 里找不到同 adcode 的地级单元')
    units = [u for u in units if u['a'] in shared]
    return src, units, shared

def calibrate():
    cn = load_cn()
    proj, _ = make_proj(**PROJ_ARGS)

    # 粗估 + 精算都用云南：两侧是同一批地级单元，包围盒可以直接对齐
    fit_src, fit_units, shared = prov_pair(cn, proj, FIT_PROV)
    s, a, b = coarse_from_bboxes(proj_bbox(fit_src, shared), cn_bbox(fit_units))
    print(f'粗估（{FIT_PROV} 的 {len(shared)} 个地级单元）'
          f's={s:.6f} a={a:.4f} b={b:.4f}')

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

    # 验证集：四川。用拟合出来的变换直接配对，不再粗估。
    ho_src, _, _ = prov_pair(cn, proj, HOLDOUT_PROV)
    ho_pairs = head_pairs(ho_src, cn, s, a, b, 1.0)
    if not ho_pairs:
        sys.exit('✗ 验证集一组对应点都没配上，变换不对')
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
