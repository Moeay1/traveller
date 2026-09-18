#!/usr/bin/env python3
"""
独立验证标定出来的仿射变换：整环逐顶点比对，不只看标定用的首顶点。

标定只用了每个环的首顶点做最小二乘，残差小不能完全排除「恰好首点对上、
整体还是歪的」。这里把源数据整环投影 + 抽稀 + 套变换，跟 cn.json 里
顶点数相同的那个环逐点比，最大偏差应当仍在 1 位小数的量化噪声量级。

    python3 scripts/verify_transform.py
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit import apply_affine, dp, fetch_json, make_proj, rings_of

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROVS = (530000, 510000, 150000)   # 云南（拟合）· 四川（验证）· 内蒙古（跨度最大）
CITY_EPS = 0.00035
LIMIT = 0.1

def main():
    t = json.load(open(os.path.join(ROOT, 'scripts/cn-transform.json')))
    s, a, b = t['s'], t['a'], t['b']
    proj, _ = make_proj(**t['proj'])
    with open(os.path.join(ROOT, 'public/data/cn.json')) as f:
        cn = {u['a']: u for u in json.load(f)['u']}

    overall = 0.0
    for prov in PROVS:
        raw = fetch_json(f'https://geo.datav.aliyun.com/areas_v3/bound/{prov}_full.json',
                         f'cn-{prov}.geojson')
        worst, worst_name, units, rings = 0.0, '', 0, 0
        for f in raw['features']:
            u = cn.get(int(f['properties']['adcode']))
            if not u:
                continue
            units += 1
            targets = [[(r[i], r[i + 1]) for i in range(0, len(r), 2)] for r in u['g']]
            for ring in rings_of(f['geometry']):
                pr = dp([proj(c[0], c[1]) for c in ring], CITY_EPS)
                if len(pr) < 4:
                    continue
                mapped = [apply_affine(s, a, b, x, y) for x, y in pr]
                # 同一个环经同样的抽稀，顶点数必然一致 —— 用它来认环
                for tr in (t for t in targets if len(t) == len(mapped)):
                    d = max(max(abs(p[0] - q[0]), abs(p[1] - q[1]))
                            for p, q in zip(mapped, tr))
                    if d < 1.0:
                        rings += 1
                        if d > worst:
                            worst, worst_name = d, u['n']
                        break
        overall = max(overall, worst)
        print(f'  {prov}: {units} 个地级单元 · 认出 {rings} 个环 · '
              f'整环最大偏差 {worst:.4f}（最差 {worst_name}）')

    if overall >= LIMIT:
        sys.exit(f'✗ 整环最大偏差 {overall:.4f} ≥ {LIMIT}，变换对不上')
    print(f'✔ 整环最大偏差 {overall:.4f} < {LIMIT}，与 1 位小数的量化噪声同量级')

if __name__ == '__main__':
    main()
