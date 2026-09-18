# CLAUDE.md

## 上线

**部署目录就是这个仓库本身**，工作副本即线上代码。所以「合到 main」和「上线」在这里几乎是同一件事 —— 只差一次重启。

```
traveller.moeay.com
  → cloudflared 隧道 "moeay1"        ~/.cloudflared/config.yml
  → localhost:3000
  → launchd 服务 com.moeay.traveller ~/Library/LaunchAgents/com.moeay.traveller.plist
  → node node_modules/next/dist/bin/next start   （NODE_ENV=production）
     WorkingDirectory = 本仓库根目录
     KeepAlive = true（进程挂了自动拉起）
  → 日志 ~/Library/Logs/traveller.log
```

### 步骤

```bash
# 1. 代码进 main（本仓库直接在 main 上跑）
git merge <feature-branch>

# 2. 依赖有变动才需要
npm install

# 3. 只有 src/ 有改动才需要重新构建（判断依据见下）
npm run build

# 4. 重启（这一步不能省，原因见下）
launchctl kickstart -k "gui/$(id -u)/com.moeay.traveller"

# 5. 验证
curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/login          # 期望 200
curl -o /dev/null -w "%{http_code}\n" https://traveller.moeay.com/login    # 期望 200
tail -5 ~/Library/Logs/traveller.log                                        # 期望 ✓ Ready in …ms
```

重启大约中断 1 秒。`lsof -nP -iTCP:3000 -sTCP:LISTEN -t` 可以看 PID 有没有换。

### 两个坑（都是实测踩出来的，不是推测）

**1. `public/` 下新增的文件，不重启取不到。**

`next start` 在**启动时**就把 `public/` 的文件清单定下来了，之后新增的文件不会被识别。实测：加完 `public/data/cn/530100.json` 不重启 → **404**；而启动前就存在的 `public/data/cn.json` → 200；重启后新文件 → 200。

所以**哪怕只加静态数据文件、一行代码都没改，也必须重启**。否则会遇到「文件明明在磁盘上却 404」这种很难查的现象。

**2. 不要习惯性 `npm run build`。**

判断依据是 `.next/BUILD_ID` 的时间戳 vs `src/` 里**文件的修改时间**：

```bash
stat -f "%Sm  BUILD_ID" -t "%Y-%m-%d %H:%M:%S" .next/BUILD_ID
find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) \
  -exec stat -f "%Sm  %N" -t "%Y-%m-%d %H:%M:%S" {} + | sort -r | head -3
```

构建时间晚于最新的文件修改时间 → 构建是新的，跳过第 3 步。

**不要拿 git 提交时间来比。**「先改文件 → 构建 → 验证 → 最后提交」是很自然的顺序，这种情况下提交时间会晚于构建时间，看着像过期，其实构建用的就是同样的内容。要确认构建来源和提交内容一致，看的是 `git status -- src/` 干不干净，不是时间先后。

`public/`、`scripts/`、`docs/`、`prisma/schema.prisma` 的改动都不需要重新构建（schema 改动要跑 `npm run db:push`，那是另一件事）。

### 服务管理

```bash
launchctl print "gui/$(id -u)/com.moeay.traveller" | head -20   # 状态
launchctl kickstart -k "gui/$(id -u)/com.moeay.traveller"       # 重启
launchctl bootout "gui/$(id -u)/com.moeay.traveller"            # 停（KeepAlive 不会再拉起）
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.moeay.traveller.plist  # 起
```

隧道是另一个独立进程（`cloudflared --config ~/.cloudflared/config.yml tunnel run moeay1`），它不随应用重启，一般不用动。`~/.cloudflared/config.yml` 里还挂着 `ssh` / `gantt` / `quarry` / `rightapi` 几个别的服务，**改它要小心，别把别人的 ingress 弄坏**。

### 回滚

线上就是工作副本，所以回滚 = 回退 git + 重启：

```bash
git reset --hard <good-commit>
npm run build     # 如果回退跨越了 src/ 改动
launchctl kickstart -k "gui/$(id -u)/com.moeay.traveller"
```

## 地图数据

`public/data/cn.json` 是**不可变基准** —— `src/lib/regions.ts` 里的 `view` 和 `inset.viewBox` 都是在它的坐标空间里手调出来的，重新生成一旦漂移零点几，南海诸岛小图会悄悄错位，而且没有任何测试会报警。

区县分片（`public/data/cn/`）的生成方式是先把 `cn.json` 的仿射变换标定出来再复用，不是重跑一遍全国投影。命令和原理见 README「区县数据怎么生成」，设计取舍见 `docs/superpowers/specs/2026-09-18-county-drilldown-design.md`。
