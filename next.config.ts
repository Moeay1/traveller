import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        /**
         * 地图数据的缓存策略。
         *
         * Next 对 public/ 的默认值是 `public, max-age=0`，每次请求都要回源验证 ——
         * 实测走 cloudflare 隧道一次往返约 470ms，而一片区县只有 12KB、解析加建 path
         * 只要 0.5ms。也就是说下钻的等待几乎全花在「问一遍服务器这个文件变没变」上。
         *
         * 这批文件由 scripts/build-*.py 生成，改动频率以月计（区划调整时才重跑），
         * 所以给 1 小时新鲜期 + 1 天 stale-while-revalidate：会话内零等待，
         * 重新生成之后最多 1 小时内客户端还可能拿到旧数据。
         * 如果哪次改动必须立刻生效，改文件名或加版本查询参数即可绕过。
         */
        source: '/data/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' },
        ],
      },
    ]
  },
}

export default nextConfig
