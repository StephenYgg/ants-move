# ants-move

**Language / 语言:** [English](README.md) · [简体中文](README.zh-CN.md)

`ants-move` 是一个开源 TypeScript CLI，用于在系统之间搬运数据。命令被设计成小型 worker：采集器把数据拿进来，自动化命令可以把数据写入创作者后台等系统。当前采集器支持 36 氪、今日头条、Hacker News、GitHub；头条还支持创作者后台登录，以及文章 / 微头条的草稿与发布。

## 安装与环境

依赖：

- Node.js 22 或更高
- npm
- `PATH` 中可用的 `curl`（36 氪采集）
- 通过 Playwright 安装的 Chromium（头条采集）

全局安装包，并安装头条采集用的浏览器：

```bash
npm install -g ants-move
npx playwright@1.59.1 install chromium
```

包会安装两个等价可执行文件：`ants` 与短别名 `amv`。

## 输出约定

成功结果写 stdout，结构化错误写 stderr。默认输出 JSON。列表 / 搜索命令支持 `--format table` 或 `-t` 表格输出。文章详情命令仅支持 JSON。

成功 JSON 信封：`{ "ok": true, "data": ... }`。错误信封：`{ "ok": false, "error": ... }`，并以非零退出码返回。

## 36 氪命令

按数字 ID 拉取文章：

```bash
ants 36kr article <article-id> [--format json]
```

从 `AI` 或 `technology` 频道拉取 1～20 页资讯：

```bash
ants 36kr list <AI|technology> [--pages 1..20] [--format json|table] [-t]
```

采集方式：

- **文章**：从 `www.36kr.com` 拉 HTML（不用裸域 `36kr.com`）并解析 `window.initialState`。裸域常被火山引擎安全检测页拦截且没有正文数据；遇到时返回 `KR36_PARSE_ERROR` 并提示安全检测。
- **列表**：只走官方 gateway 流式接口（`gateway.36kr.com`，首页 `pageEvent: 0`，后续页带 `pageCallback`），不再依赖频道页 HTML。

分页串行，单次调用最多 20 页。每个 curl 响应与映射结果限制 20 MB，每页最多 30 条，映射列表限制 5 MB，因此一次列表最多保留 600 条，且不会跨页累积过大字段。

## 头条命令与验证限制

按数字 ID 或文章 / group / 旧版 URL 拉取文章：

```bash
ants toutiao article <article-id-or-url> [--format json]
```

从科技频道或支持的搜索关键词拉取 1～5 页：

```bash
ants toutiao list <tech|AI|光刻机|芯片|半导体> [--pages 1..5] [--format json|table] [-t]
```

按 token 或 `/c/user/token/<token>/` 主页 URL 拉取作者动态：

```bash
ants toutiao author <token-or-url> [--pages 1..5] [--with-content] [--format json|table] [-t]
```

Feed 采集最多保持请求页数的解析结果活跃，最多启动两倍数量的有界解析尝试以替换畸形响应，并最多接受 5 个成功响应。每个 feed body 在 JSON 解析前限制 5 MB，解析后最多 100 条原始条目。

文章抽取对标题、正文、段落分别限制 1 MB。搜索回退最多串行检查 300 个有界链接，并拒绝大于 1 MB 的 body。`--with-content` 在同一浏览器会话中串行拉详情，最多 100 篇唯一文章，单次调用最多保留 10 MB 结果。头条可能要求交互式验证；验证导致搜索不可用时返回 `TOUTIAO_VERIFICATION_REQUIRED`。CLI **不会**尝试绕过站点验证。

### 头条创作者登录与发布

这些命令用 Playwright 驱动非官方创作者后台 `mp.toutiao.com`，**不是**官方头条开放 API。账号限流、验证码、风控策略仍然有效。请先用测试账号。CLI 永不绕过验证码或风控。

首次用有界面浏览器扫码登录。会话以 Playwright `storageState` 保存（权限 `0600`），默认路径 `~/.config/ants-move/toutiao/default.json`，可用 `--state` 覆盖。

登录 / 发布默认使用本机**已安装系统浏览器**（`--browser chrome`），而不是 Playwright 自带的 Chromium for Testing。支持：

- `chrome`（默认）：本机 Google Chrome
- `msedge`：Microsoft Edge
- `chromium`：Playwright 管理的 Chromium for Testing

也可设置 `ANTS_TOUTIAO_BROWSER=chrome|msedge|chromium`。

```bash
ants toutiao auth login [--browser chrome|msedge|chromium] [--state <path>] [--timeout-ms <ms>]
ants toutiao auth status [--browser chrome|msedge|chromium] [--state <path>]
ants toutiao auth logout [--state <path>]
```

创建内容**默认存草稿**。正式发布必须显式 `--strategy publish`。省略 `--strategy` 永远等于 draft。`--dry-run` 只校验入参与登录态是否存在，不写后台：

```bash
ants toutiao publish article \
  --title <title> \
  --content <text> | --content-file <path> \
  --images <path,path,path,...> \
  [--cover <path>] \
  [--covers <path,path,...>] \
  [--keywords <csv>] \
  [--category <name>] \
  [--location <名称>] \
  [--claim <name>] \
  [--first-publish] \
  [--strategy draft|publish] \
  [--browser chrome|msedge|chromium] \
  [--cdp <url>] \
  [--state <path>] \
  [--dry-run] \
  [--headed]

ants toutiao publish micro \
  --content <text> | --content-file <path> \
  --images <path,path,...> \
  [--topic <name>] \
  [--location <名称>] \
  [--claim <name>] \
  [--first-publish] \
  [--strategy draft|publish] \
  [--browser chrome|msedge|chromium] \
  [--cdp <url>] \
  [--state <path>] \
  [--dry-run] \
  [--headed]
```

#### 文章图片规则

- `--images` **必填**，至少 **3** 张本地图（最多 20）。
- 图片会**嵌在正文段落之间**，不只是封面。
- 主路径：把图片写入系统剪贴板，再在**折叠到文末、无选区**的光标处粘贴，避免覆盖已有文字。
- 每次插入后校验此前段落指纹仍在；若粘贴会覆盖正文，命令以 `TOUTIAO_UI_CHANGED` 失败。
- 兜底路径：创作者后台工具栏插图抽屉 → 本地上传 → 确定。
- 封面 / 主图（`--cover` / `--covers`）：可选。未指定时用第一张正文图作单图。封面上传为**尽力而为**；封面控件失败时仍可保存带正文图的草稿，并可能回退到「无封面」。

#### 微头条图片规则

- `--images` **必填**，至少 **2** 张本地图（最多 9）。
- 通过微头条工具栏「图片」→「本地上传」→「确定」上传。

#### 其他发布选项

| 选项 | 对应后台控件 |
|------|----------------|
| `--topic <name>` | 微头条创作话题（工具栏或 `#话题#` 文本兜底） |
| `--location <名称>` | 添加位置 / 城市（尽力而为，失败不阻断发布） |
| `--claim <name>` | 作品声明勾选项，例如 `个人观点，仅供参考` |
| `--first-publish` | 头条首发（正文至少 100 字） |
| `--keywords <csv>` | 文章关键词（后台有该字段时） |
| `--category <name>` | 文章分类（后台有该字段时） |
| `--headed` | 自动化时显示浏览器窗口 |

#### 成功判定与边界

草稿 / 发布成功**仅以**创作者保存 API 返回真实 id 为准：

- 文章：`POST /mp/agw/article/publish` 返回 `pgc_id`
- 微头条：`POST /mp/agw/draft/save_ugc_draft` 返回 `gid`

仅有 UI toast 不算成功。保存响应 waiter 在表单填写完成后才 arm（保存 / 发布点击之前），避免把输入过程中的自动保存误判为成功。

边界：单次调用一篇文章或一条微头条；正文最多 1 MB；文章标题 2～30 字；文章正文图 3～20 张；微头条图 2～9 张；单图最多 10 MB。同一 auth 状态文件跨进程单飞加锁，并发持有者收到 `TOUTIAO_LOCK_HELD`。保存 / 发布不会自动重试。

#### 示例

```bash
# 文章草稿：3 张正文插图（段落嵌入 + 可选封面）
ants toutiao publish article --headed \
  --title "示例标题" \
  --content $'第一段内容。\n\n第二段内容。\n\n第三段内容，字数足够时可加 --first-publish。' \
  --images ./a.png,./b.png,./c.png \
  --claim "个人观点，仅供参考" \
  --first-publish

# 微头条草稿：2 张图 + 话题
ants toutiao publish micro --headed \
  --content "微头条正文……" \
  --images ./a.png,./b.png \
  --topic 科技
```

### 真实托管浏览器配置（推荐用于交互登录 / 发布）

用**真实 Chrome/Edge** + **专用自动化配置目录**（不是你日常 Chrome 配置）时，先启动可调试浏览器：

```bash
ants toutiao browser start [--browser chrome|msedge] [--port 9222] [--profile <path>]
ants toutiao browser status
ants toutiao browser stop
```

默认：

- 配置目录：`~/.config/ants-move/toutiao/chrome-profile`
- CDP：`http://127.0.0.1:9222`
- 元数据：`~/.config/ants-move/toutiao/browser.json`

再通过 CDP 在该真实浏览器中登录 / 发布：

```bash
# 在托管 Chrome 窗口中按需扫码
ants toutiao auth login --cdp http://127.0.0.1:9222

# 后续发布可用同一 CDP（若 browser start 仍在运行，也可省略 --cdp）
ants toutiao publish article --title "标题2到30字" --content "正文" --cdp http://127.0.0.1:9222
```

若 `ants toutiao browser start` 已在运行，auth / publish 在省略 `--cdp` 时会**自动探测** CDP URL。

这是 Playwright `connectOverCDP` 连接本机已安装的 Chrome/Edge 进程，**不会**复用 `~/Library/Application Support/Google/Chrome` 下的日常个人配置。

## Hacker News 命令与别名

从各 Firebase 列表拉取 1～100 条：

```bash
ants hn top [--limit 1..100] [--format json|table] [-t]
ants hn new [--limit 1..100] [--format json|table] [-t]
ants hn best [--limit 1..100] [--format json|table] [-t]
```

通过 Algolia 搜索，按相关度或时间排序：

```bash
ants hn search <query> [--limit 1..100] [--sort relevance|date] [--format json|table] [-t]
```

`hackernews` 是 `hn` 的别名，例如 `ants hackernews top` 等同于 `ants hn top`。`amv` 可执行文件接受上述全部命令，例如 `amv hackernews search typescript`。

Hacker News 详情请求最多 8 并发。ID 列表与搜索响应限制 5 MB，每条 Firebase story 详情限制 256 KB。

## GitHub 命令

### GitHub Trending

拉取 GitHub 全语言 Trending 页上展示的全部仓库。时间周期默认 `daily`：

```bash
ants github trending
ants github trending --since daily
ants github trending --since weekly
ants github trending --since monthly
```

默认 JSON。可用 `--format table` 或 `-t` 输出表格：

```bash
ants github trending --since weekly --format table
ants github trending --since monthly -t
```

采集器对官方服务端渲染 HTML 发一次 GitHub 请求，不使用第三方 Trending API 或 Playwright。请求超时 30 秒，HTML 限制 5 MB。解析最多接受 100 个仓库，每个仓库最多保留 10 个展示贡献者。命令无语言过滤、结果上限、自动重试或缓存；成功但 0 行的解析会当作页面结构错误拒绝，而不是返回误导性的空榜。

### GitHub README

拉取公开仓库默认分支上的首选 README：

```bash
ants github readme https://github.com/owner/repository
ants github readme https://github.com/owner/repository.git
```

返回 JSON，包含原始 UTF-8 README 内容以及 name、path、SHA、字节大小、HTML URL、download URL、规范仓库 URL 与 API 源 URL。使用文档化的 `api.github.com/repos/{owner}/{repo}/readme` 端点，一次有界 GitHub API 请求，超时 30 秒，响应限制 5 MB。不爬仓库页、不探测 Raw URL、不重试、不回退其他请求。不读取 `GITHUB_TOKEN`。

仅支持公开仓库。未认证 REST 客户端共享源 IP 时，GitHub 通常限制为每小时 60 次请求。额度用尽返回 `GITHUB_RATE_LIMITED`，且不重试。

## 高并发使用警告

单进程内资源使用有界，但不同进程中的相同命令**没有**全局去重或限流。在 `Q` 次并发调用下，上游工作量可接近：36 氪列表 `20Q` 请求；Hacker News 列表 `201Q` 请求；头条作者采集约 `105Q` 次浏览器导航及页面子资源；GitHub Trending 或 README 各 `Q` 次请求。README 采集还会短暂保留有界 API 响应、解析 JSON、Base64 文本与解码内容；共享源 IP 的匿名调用通常共享 GitHub 每小时 60 次限制，限流失败不会重试或回退。

每次调用保留的数据也有界：36 氪列表 5 MB；Hacker News 约 200 条候选详情共约 50 MB（过滤前）；头条作者文章结果 10 MB；GitHub HTML 响应 5 MB（Cheerio 解析前）。头条在同一浏览器会话中最多还可持有 5 个活跃的 5 MB feed 缓冲；浏览器进程开销、必要子资源与 HTML 解析对象开销不计入这些 payload 上限。

**不要**把 CLI 直接挂在高 QPS 请求路径上。在线服务必须使用外部有界队列与共享限流器，在多进程 / 多实例间施加背压。本项目没有分布式锁、共享缓存、重试队列或多实例单飞机制。

## 开发与校验

安装依赖并运行确定性检查：

```bash
npm install
npm run check
npm test
npm run coverage
npm run build
npm pack --json
```

测试使用注入的网络 / 浏览器边界，不会访问真实网站。

## 许可证

基于 [MIT License](LICENSE)。
