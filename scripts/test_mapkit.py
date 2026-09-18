#!/usr/bin/env python3
"""mapkit 的回归测试。跑：python3 scripts/test_mapkit.py"""
import os, sys
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

def test_fetch_json_does_not_cache_a_truncated_download():
    """下载断在一半时，目标路径上不能留下半个文件 —— 否则下次「缓存命中」读到截断的 JSON"""
    import urllib.error, urllib.request
    import mapkit
    tmp = os.environ.get('TMPDIR', '/tmp')
    name = 'mapkit-truncation-probe.json'
    target = os.path.join(tmp, name)
    for f in (target, target + '.part'):
        if os.path.exists(f): os.remove(f)

    def boom(url, path):
        with open(path, 'w') as fh:
            fh.write('{"half":')          # 写一半就断
        raise urllib.error.ContentTooShortError('retrieval incomplete', None)

    real = urllib.request.urlretrieve
    urllib.request.urlretrieve = boom
    try:
        try:
            mapkit.fetch_json('https://example.invalid/x.json', name)
        except urllib.error.ContentTooShortError:
            pass
        else:
            raise AssertionError('应该把下载异常抛出来')
    finally:
        urllib.request.urlretrieve = real

    assert not os.path.exists(target), '截断的文件被当成缓存留下了'
    assert not os.path.exists(target + '.part'), '.part 临时文件没清掉'

def test_apply_affine_flips_y():
    assert apply_affine(2.0, 1.0, 100.0, 3.0, 4.0) == (7.0, 92.0)

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
        (0.0, 0.0, 2.0, 1.0),        # 投影 bbox: minx miny maxx maxy
        (0.0, 0.0, 1000.0, 500.0),   # 目标 bbox
    )
    assert abs(s - 500.0) < 1e-9, s
    assert abs(apply_affine(s, a, b, 0.0, 0.0)[0] - 0.0) < 1e-9
    assert abs(apply_affine(s, a, b, 2.0, 0.0)[0] - 1000.0) < 1e-9
    # 投影 y=0（最南）→ 目标 Y=500（最下）
    assert abs(apply_affine(s, a, b, 0.0, 0.0)[1] - 500.0) < 1e-9
    assert abs(apply_affine(s, a, b, 0.0, 1.0)[1] - 0.0) < 1e-9

if __name__ == '__main__':
    fns = [v for k, v in sorted(globals().items()) if k.startswith('test_')]
    for fn in fns:
        fn()
        print('  ok', fn.__name__)
    print(f'{len(fns)} passed')
