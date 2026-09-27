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
| `test/security.test.js` | 随机 Token、密码哈希、AES-256-GCM 加解密与篡改检测、定长确认码字符集、确认码输入规范化（大小写/空格/连字符与非法字符）、Turnstile 回源校验（成功、缺 token、无效、网络错误与来源域名核对） |
| `test/db.test.js` | 券面/券码两级状态机与联动、券码 ID 格式与唯一性、单张创建/改名/备注、券码名重复与显示覆写（单张 `show_name` 与全局开关）、原子核销（并发 12 次只成功 5 次）、回收生命周期与保留参数（后台可调、脏值回退默认）、全局核销记录查询（最近列表/分页/券面与日期筛选）、审计分页（类别/操作人/日期筛选）、设置加密读写、东八区日期边界、凭证查询（默认 72 小时窗口与最小字段） |
| `test/coupon-image.test.js` | 券面 PNG 魔数与 1080×1528 尺寸 |
| `test/views.test.js` | 各状态不出现核销按钮、三色结果面板、查询结果页层级（确认码小标题、结果为视觉重心、查询下一个按钮）、直白失败原因、HTML 转义、角色导航隐藏、券面/券码详情（含券码名显示表单）、回收站两栏、状态配色、北京时间、权限不足页、限流提示页、查询页三态与不泄漏后台信息、保留策略表单与参数插值、券面展示开关、核销记录总页与概览最近核销面板、审计页筛选与分页、首页介绍与全站页脚、三态主题（变量中枢与深色双入口、页脚主题开关与 theme.js）、登录页人机验证组件（配置才渲染） |

### 登录人机验证本地联调（可选）

`.env` 填入 Turnstile 测试密钥后重启，登录页组件直接给出可预期结果、无需真实挑战：恒过 sitekey `1x00000000000000000000AA` 配恒过 secret `1x0000000000000000000000000000000AA`，恒失败 sitekey `2x00000000000000000000AB`。自动化用例不访问真实网络——`verifyTurnstile` 支持注入 `fetch`。

## 辅助脚本（除生成密钥外，均需要 `.env`）

```powershell
node\node.exe scripts\seed-dev.mjs             # 幂等生成测试账号与示例数据
node\node.exe scripts\sqlite.mjs "<SELECT语句>"  # 只读查询，输出 JSON
node\node.exe scripts\token.mjs cd-3Kd9xWm2QaP7 # 解密打印某券码原始 Token（ID 见后台券码详情页）
node\node.exe scripts\generate-secrets.js       # 生成 .env 密钥
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
├─ coupon-image.js  1080×1528 PNG 版面计算
├─ png-render.js    渲染子进程管理（串行队列、60s 空闲退出）
└─ png-child.js     渲染子进程端（NDJSON 协议）
public/             app.css、app.js、theme.js（唯一前端资源，无构建步骤）
scripts/            辅助脚本
test/               node --test 测试
docs/               架构 / 部署 / 开发文档与 Nginx 示例配置
```

## 代码约定

- **严格 CSP（硬约定）**：模板中禁止内联 `<script>`、`style=` 属性、`onclick=` 等内联事件属性——CSP 只允许 `script-src 'self'`，违反的功能会被浏览器直接拒绝执行。新页面必须走外链 `/assets/app.js` + `data-*` 属性绑定行为
- **主题颜色一律走变量**：浅色值定义在 `:root`、深色值集中在 `--dk-*`，由两个入口映射（`html[data-theme="dark"]` 与 `prefers-color-scheme`，`theme.js` 负责读写选择与页脚开关）；新增颜色先入变量表，禁止在规则里写主题敏感的硬编码色；深色阴影必须短行程低透明（配 1px 边框分层），避免深底大渐变产生色带断层
- SQL 一律 `db.prepare(...)` 预编译参数化，禁止拼接；HTML 输出统一 `esc()`、表单值 `attr()`
- 时间一律 UTC 存储、`beijingTime` 展示；有效期按 `Asia/Shanghai` 自然日比较
- 界面文案中文；面向客人的页面每条提示要**简洁而全面**——一句话说清事实与下一步动作，正式而不学术、不堆解释、不要 AI 味（避免连环破折号、自问自答、空泛安抚）；超管后台可更简短
- 危险操作必须走页面内模态确认（`data-confirm`），不用 `window.confirm`
- GET 请求不得改变状态；核销等写操作用条件 UPDATE 的 `changes` 判成败
