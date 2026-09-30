# 开发指南

## 环境要求

Node.js 22+。Windows 可直接用仓库外置的 `node/` 目录（下文按 Windows 写法 `node\node.exe` / `node\npm.cmd`；Linux/macOS 换成 `node` / `npm` 即可）。

## 本地启动

```powershell
# 1. 准备配置
copy .env.example .env
node\node.exe scripts\generate-secrets.js   # 把输出的两串填入 .env 的 APP_ENCRYPTION_KEY、SESSION_SECRET

# 2. 安装依赖
node\npm.cmd ci --cache .npm-cache

# 3. 启动（开发热重载：npm run dev）
node\node.exe src\server.js

# 4. 首次启动：终端输出可直接点开的 /admin/setup 链接与一次性口令 → 创建超级管理员
```

`.env` 关键项（全量见 [DEPLOYMENT.md](DEPLOYMENT.md)）：

- `HOST` / `PORT`：监听地址。**手机扫码联调**时把 `HOST` 设为本机局域网 IP（如 `192.168.1.100`）、`PUBLIC_BASE_URL` 设为 `http://<同IP>:<PORT>`，并把该 IP 加入 `ADMIN_HOSTS`——否则后台路由会被 Host 校验拒绝
- `ADMIN_HOSTS`：管理后台允许的 Host，逗号分隔

**改动生效**：`public/` 静态文件即改即生效；**修改 `src/` 必须重启进程**。

### 测试账号（开发数据）

`scripts/seed-dev.mjs` 幂等生成以下账号与示例数据（仅本地开发，删库重建后跑一次即可恢复）：

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `superadmin` | `Test-password-2026` | 超级管理员 |
| `bizadmin` | `Biz-password-2026` | 业务管理员 |
| `biz2` | `Reset-password-2026` | 业务管理员（供重置密码演示） |

## 测试

```powershell
node\node.exe --test     # 或 npm test（node 在 PATH 时）
```

| 文件 | 覆盖范围 |
| --- | --- |
| `test/security.test.js` | 随机 Token、密码哈希、AES-256-GCM 加解密与篡改检测、定长确认码字符集、确认码输入规范化（大小写/空格/连字符与非法字符）、Turnstile 回源校验（成功、缺 token、无效、网络错误与来源域名核对、网络失败重试一次且两次共享幂等键）、回源解析缓存（TTL 内不重复查询、强制刷新、失败沿用旧值、可作废）、回源 lookup 契约（命中缓存按 Node 的 all 协议回数组、未命中回落系统解析并强制 IPv4） |
| `test/log.test.js` | 未配置时静默、单行格式（北京时间戳/级别/事件/k=v）、级别过滤与 error 走 stderr、字段引号渲染、路径脱敏（Token 与确认码不进日志、查询串丢弃）、审计事件同时出日志（业务操作与失败登录） |
| `test/flash.test.js` | 操作反馈（一次性 Cookie）：序列化/解析往返、非法类型回退、坏 JSON 与空消息、超长截断、Cookie 属性（HttpOnly/SameSite/60 秒）、读出即清除 |
| `test/db.test.js` | 券面/券码两级状态机与联动、券码 ID 格式与唯一性、单张创建/改名/备注、批量生成券码（编号位数与数量同宽、统一隐藏券码名、数量越界不落库）、券码名重复与显示覆写（单张 `show_name` 与全局开关）、原子核销（并发 12 次只成功 5 次）、回收生命周期与保留参数（后台可调、脏值回退默认）、全局核销记录查询（最近列表/分页/券面与日期筛选）、审计分页（类别/操作人/日期筛选）、设置加密读写、东八区日期边界、凭证查询（默认 72 小时窗口与最小字段） |
| `test/coupon-image.test.js` | 券面 PNG 魔数与 1080×1920 尺寸（含深色与字体选项）、券面名称在顶部色带内垂直居中（单行与双行中线一致） |
| `test/views.test.js` | 各状态不出现核销按钮、三色结果面板、查询结果页层级（确认码小标题、结果为视觉重心、查询下一个按钮）、直白失败原因、HTML 转义、角色导航隐藏、券面/券码详情（含券码名显示表单）、创建券码表单（单张与批量共用、数量 1-100、批量语义说明）、回收站两栏、状态配色、北京时间、权限不足页、限流提示页、查询页三态与不泄漏后台信息、保留策略表单与参数插值、券面展示开关、核销记录总页与概览最近核销面板、审计页筛选与分页、首页介绍与全站页脚、三态主题（变量中枢与深色双入口、页脚主题开关与 theme.js）、登录页人机验证组件（配置才渲染） |

### 登录人机验证本地联调（可选）

`.env` 填入 Turnstile 测试密钥后重启，登录页组件直接给出可预期结果、无需真实挑战：恒过 sitekey `1x00000000000000000000AA` 配恒过 secret `1x0000000000000000000000000000000AA`，恒失败 sitekey `2x00000000000000000000AB`。自动化用例不访问真实网络——`verifyTurnstile` 支持注入 `fetch`。

## 辅助脚本（除生成密钥外，均需要 `.env`）

```powershell
node\node.exe scripts\seed-dev.mjs             # 幂等生成测试账号与示例数据
node\node.exe scripts\sqlite.mjs "<SELECT语句>"  # 只读查询，输出 JSON
node\node.exe scripts\token.mjs cd-3Kd9xWm2QaP7 # 解密打印某券码原始 Token（ID 见后台券码详情页）
node\node.exe scripts\generate-secrets.js       # 生成 .env 密钥
node\node.exe scripts\check-turnstile.js       # 人机验证连通性自检：真实跑一次回源并打印耗时（加 --secret=… 可验证密钥有效性）
```

### 本地预览与对照工具（`temp/`，不入库）

开发期临时脚本统一放 `temp/`（已 gitignore，不进版本库），无需 `.env`：

```powershell
node\node.exe temp\preview-png-layout.mjs       # 券面 PNG 目视预览：真实渲染器出图 + HTML 画廊（--doc 顺带刷新 README 截图）
node\node.exe temp\preview-png-layout-tuner.mjs # 版面调参器：滑块实时调间距/字号，输出参数 JSON（生成单文件 HTML）
node\node.exe temp\preview-font-choice.mjs      # 券面正文字体选项对比预览
node\node.exe temp\preview-logo-asset.mjs       # 品牌字标轮廓对比预览
node\node.exe temp\preview-body-limit.mjs       # 请求体上限量具：逐级加长表单定位 413 阈值（需服务已在 3100 运行）
node\node.exe temp\preview-date-input.mjs       # 日期输入三组对照页（默认 3200，监听 0.0.0.0 供手机实测）
node\node.exe temp\crop-screenshots.mjs         # 截图裁边：按卡片边界自动取景（默认处理两张 public 截图，可传文件名与 --pad）
python temp\gen-brand-logo.py <输出.js>         # 品牌字标轮廓生成器（需本机 Century Gothic Bold / 思源黑体 + fonttools）
```

## 目录结构

```
src/
├─ server.js        路由、会话、CSRF、限流、安全响应头、错误处理
├─ config.js        环境变量（.env）
├─ db.js            全部 SQL（预编译语句）与数据访问
├─ security.js      Token/密码哈希/对称加密/确认码/随机 ID
├─ views.js         服务端 HTML 模板
├─ mailer.js        SMTP 通知
├─ brand-logo.js    品牌字标 SVG 轮廓数据（开发机预生成入仓，零字体依赖）
├─ coupon-image.js  1080×1920 PNG 版面计算
├─ png-render.js    渲染子进程管理（串行队列、60s 空闲退出）
└─ png-child.js     渲染子进程端（NDJSON 协议）
public/             app.css、app.js、theme.js（唯一前端资源，无构建步骤）
scripts/            辅助脚本
temp/               开发期临时预览/对照脚本（gitignore，不入库）
test/               node --test 测试
docs/               架构 / 部署 / 开发文档与 Nginx 示例配置
```

## 代码约定

- **严格 CSP（硬约定）**：模板中禁止内联 `<script>`、`style=` 属性、`onclick=` 等内联事件属性——CSP 只允许 `script-src 'self'`，违反的功能会被浏览器直接拒绝执行。新页面必须走外链 `/assets/app.js` + `data-*` 属性绑定行为
- **主题颜色一律走变量**：浅色值定义在 `:root`、深色值集中在 `--dk-*`，由两个入口映射（`html[data-theme="dark"]` 与 `prefers-color-scheme`，`theme.js` 负责读写选择与切换按钮）；新增颜色先入变量表，禁止在规则里写主题敏感的硬编码色；深色阴影必须短行程低透明（配 1px 边框分层），避免深底大渐变产生色带断层
- **主题入口**：单个图标按钮 `[data-theme-cycle]`（后台顶栏用户名左边、主页首屏），点击在浅色/深色之间切换；**未主动选择过 = 跟随系统**（`html` 不写 `data-theme`，交回 `prefers-color-scheme`，图标按系统当前主题显示太阳或月亮）；`localStorage` 的 `qnqupon-theme` 只存 `light`/`dark`，没有「跟随系统」的显式入口
- **页脚贴底**：`body` 是 100vh 弹性列、`.container` 撑满剩余高度、`.site-footer` 用 `margin-top:auto`——内容不足一屏时页脚贴到窗口底部，超出时落在内容末尾（滚动可见）。后台顶层模块的纵向间距由容器的 `row-gap` 承担，因为 flex 下外边距不再折叠
- SQL 一律 `db.prepare(...)` 预编译参数化，禁止拼接；HTML 输出统一 `esc()`、表单值 `attr()`
- 时间一律 UTC 存储、`beijingTime` 展示；有效期按 `Asia/Shanghai` 自然日比较
- 界面文案中文；面向客人的页面每条提示要**简洁而全面**——一句话说清事实与下一步动作，正式而不学术、不堆解释、不要 AI 味（避免连环破折号、自问自答、空泛安抚）；超管后台可更简短
- **手机档（≤640px）**：顶栏压成单行、表格变卡片、详情单列。后台表格的每个 `td` 必须带 `data-label`（手机档按它渲染「标签」），次要列标 `data-priority="low"` 即在该档隐藏；空状态行要带 `class="empty-row"`（否则会被画成卡片边框）；核销记录行加 `class="record-row"`、券码列表行加 `class="code-card"` 走各自的两/三行布局。**手机档规则写在 `app.css` 前部的 640 块里，若某条基础规则在文件更靠后，选择器必须加前缀（如 `.admin-body`/`.topbar`）提高优先级，否则同级会被后者覆盖**
- **后台表单默认局部刷新**：`app.js` 接管后台的 `POST` 提交（不整页跳转——保持滚动位置、不闪烁、其他面板已输入的内容不被冲掉），服务端照旧渲染整页并重定向，模板不需要任何特殊处理；新表单只要 `method="post"` 就自动获得该行为，确实需要整页跳转的加 `data-no-ajax`（登录/退出/初始化已内置排除）
- **「刷新」按钮不整页刷新**：给链接加 `data-refresh`，点击后重取该地址、只替换 `<main>` 内容与反馈卡片；滚动位置与页面上未提交的输入同样保留
- **页脚不参与局部替换**：页脚在 `<main>` 内部，局部替换时保留当前页脚节点、只换内容，避免无谓重建
- **返回是标题左侧的箭头**：`backArrow(href, label)` 渲染 `<a class="back-arrow">`（19px 线性图标，文字只给读屏与悬浮提示）；有上级页的页面用它返回，不再放「返回××」按钮
- **状态类操作回到来源页**：停用/启用/删除/恢复等表单带一个隐藏的 `return`（当前页路径），服务端只接受同源后台路径，操作完成后回到原页而不是跳到详情或回收站
- **后台面板的说明统一走右上角 ❓**（`.tip` 气泡，纯 CSS 零 JS）：面板常驻文案不超过一行，只保留「不看会做错」的口径与联动；字段示例写进 placeholder，不塞进标签括号
- **次要操作收进浮窗**（`.popover-wrap` + `[data-popover-toggle]` + `aria-controls`，`app.js` 统一开合）：平时收起不占版面，展开时 `app.js` 会后挂一层 40% 黑遮罩（点遮罩/浮窗外或 Esc 收起，局部刷新换页后自动收回），并只补竖向滚动让浮窗完整可见；浮窗里放普通表单，提交行为不变
- **标题行右侧的入口链接**（如「优惠券」页的回收站）：标题行加 `has-title-link` 类，手机档标题改 `flex:0 1 auto`、链接后面放一个空的 `.title-gap` 吸收空档——否则标题会被挤成竖排，或链接紧贴到按钮上
- **装到桌面（PWA）只在后台页启用**：manifest 由 `shell()` 的 `admin` 分支输出（`public/manifest.webmanifest`，`scope:"/admin"`、`start_url:"/admin"`），公开页一律不挂，免得"装上打开的是后台"；`theme.js` 顺带同步 `<meta name="theme-color">`（浅 `#172033` / 深 `#0e121b`），所以它必须排在 `pwaHead` 之后。Service Worker 只许做**透传**：`public/sw.js` 由根路径 `/sw.js` 提供（`/assets/` 下的脚本默认拿不到 `/admin` 作用域），注册 scope 与 manifest 保持一致；它是给「仍要求 SW 才给安装」的手机浏览器（实测鸿蒙 4.x 的 Edge、华为浏览器）用的，**里面不许出现 `caches.*`**——后台要看实时数据，测试里有断言守着。图标在 `public/`（`icon-192.png`、`icon-512.png`、`icon-maskable-512.png`、`apple-touch-icon.png`），图形沿用 favicon 的 viewBox 64 比例，maskable 那张要把图形缩到约 62% 才落在安全区内
- 危险操作必须走页面内模态确认（`data-confirm`），不用 `window.confirm`
- GET 请求不得改变状态；核销等写操作用条件 UPDATE 的 `changes` 判成败
