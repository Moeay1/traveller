#!/usr/bin/env python3
"""
把行政区划 GeoJSON 生成前端用的紧凑地图文件。

    python3 scripts/build-map.py jp    # 生成 public/data/jp.json

每个国家一套自己的 Albers 投影参数（基准经线取国土中心），
这样各自的形状都是正的——用一套投影硬套，离基准经线远的国家会被绕锥顶转掉十几度。

输出格式（跟 cn.json 一致）：
  { w, h, u: [{ n 名称, a 代码, p 上级分组, c [x,y] 标注锚点, g [[扁平坐标]] }], jd: [], pv: [] }
"""
import json, os, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapkit import rings_of, make_proj, dp

# ---------------------------------------------------------------- 区域配置

def hokkaido_kurils(lon, lat):
    """南千岛群岛（择捉/国后等）由俄罗斯管辖，这份数据把它算进北海道，排除掉"""
    return lon > 146.5

def tokyo_remote(lon, lat):
    """南鸟岛、冲之鸟礁这类无人远洋岛，留着只会把包围盒撑宽 25%"""
    return lon > 146.5 or lat < 23

REGIONS = {
    'jp': {
        'source': 'https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson',
        'cache': 'japan-raw.geojson',
        # 日本国土中心约 137°E；标准纬线取南北两端 1/6 处
        'proj': dict(lon0=137, lat0=36, p1=33, p2=45),
        'eps': 0.00035,          # 道格拉斯-普克容差，跟中国那份一致
        'drop': lambda lon, lat: hokkaido_kurils(lon, lat) or tokyo_remote(lon, lat),
        'out': 'public/data/jp.json',
    },
    # 中国那份是更早用同样思路生成的，参数记在这里备查：
    # 'cn': proj(lon0=105, lat0=35, p1=25, p2=47), eps=0.00035, 数据源 geo.datav.aliyun.com
}

# 日文汉字 → 简体中文名。前端全是中文，直接存中文名省得再做一层映射。
JP_NAMES = {
    '北海道':'北海道','青森県':'青森县','岩手県':'岩手县','宮城県':'宫城县','秋田県':'秋田县',
    '山形県':'山形县','福島県':'福岛县','茨城県':'茨城县','栃木県':'栃木县','群馬県':'群马县',
    '埼玉県':'埼玉县','千葉県':'千叶县','東京都':'东京都','神奈川県':'神奈川县','新潟県':'新潟县',
    '富山県':'富山县','石川県':'石川县','福井県':'福井县','山梨県':'山梨县','長野県':'长野县',
    '岐阜県':'岐阜县','静岡県':'静冈县','愛知県':'爱知县','三重県':'三重县','滋賀県':'滋贺县',
    '京都府':'京都府','大阪府':'大阪府','兵庫県':'兵库县','奈良県':'奈良县','和歌山県':'和歌山县',
    '鳥取県':'鸟取县','島根県':'岛根县','岡山県':'冈山县','広島県':'广岛县','山口県':'山口县',
    '徳島県':'德岛县','香川県':'香川县','愛媛県':'爱媛县','高知県':'高知县','福岡県':'福冈县',
    '佐賀県':'佐贺县','長崎県':'长崎县','熊本県':'熊本县','大分県':'大分县','宮崎県':'宫崎县',
    '鹿児島県':'鹿儿岛县','沖縄県':'冲绳县',
}

# 地方（相当于中国的"省"这一层分组），用于「区域覆盖」标签页
JP_GROUPS = [
    ('北海道', range(1, 2)), ('东北', range(2, 8)), ('关东', range(8, 15)),
    ('中部', range(15, 24)), ('近畿', range(24, 31)), ('中国地方', range(31, 36)),
    ('四国', range(36, 40)), ('九州', range(40, 47)), ('冲绳', range(47, 48)),
]
def jp_group(pid):
    for name, rng in JP_GROUPS:
        if pid in rng: return name
    return '其它'

# ---------------------------------------------------------------- 主流程

def build(key):
    cfg = REGIONS[key]
    cache = os.path.join(os.environ.get('TMPDIR', '/tmp'), cfg['cache'])
    if not os.path.exists(cache):
        print(f"下载 {cfg['source']}")
        urllib.request.urlretrieve(cfg['source'], cache)
    raw = json.load(open(cache))

    proj, n = make_proj(**cfg['proj'])
    drop = cfg['drop']
    eps = cfg['eps']

    units, dropped = [], 0
    for f in raw['features']:
        p = f['properties']
        pid = p['id']
        name = JP_NAMES.get(p['nam_ja'], p['nam_ja'])
        prings = []
        for r in rings_of(f['geometry']):
            if any(drop(c[0], c[1]) for c in r):
                dropped += 1
                continue
            pr = dp([proj(c[0], c[1]) for c in r], eps)
            if len(pr) >= 4: prings.append(pr)
        if prings:
            units.append(dict(n=name, a=pid, p=jp_group(pid), rings=prings))

    xs = [x for u in units for r in u['rings'] for x, _ in r]
    ys = [y for u in units for r in u['rings'] for _, y in r]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    W = 1000.0
    scale = W / (maxx - minx)
    H = (maxy - miny) * scale

    data = []
    for u in units:
        gs = []
        for r in u['rings']:
            flat = []
            for x, y in r:
                flat.append(round((x - minx) * scale, 1))
                flat.append(round(H - (y - miny) * scale, 1))   # y 翻转成屏幕坐标
            gs.append(flat)
        big = max(u['rings'], key=len)
        cx = sum(p[0] for p in big) / len(big)
        cy = sum(p[1] for p in big) / len(big)
        data.append({'n': u['n'], 'a': u['a'], 'p': u['p'],
                     'c': [round((cx - minx) * scale, 1), round(H - (cy - miny) * scale, 1)],
                     'g': gs})

    out = {'w': round(W, 1), 'h': round(H, 1), 'u': data, 'jd': [], 'pv': []}
    path = cfg['out']
    json.dump(out, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    pts = sum(len(r) // 2 for u in data for r in u['g'])
    print(f"✔ {len(data)} 个单元 · {pts:,} 个坐标点 · 丢弃 {dropped} 个远洋环")
    print(f"  viewBox {W:.0f} x {H:.0f}（宽高比 {W/H:.2f}）")
    print(f"  → {path}  {os.path.getsize(path)/1024:.0f} KB")

if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else 'jp')
