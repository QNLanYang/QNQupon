# 生产部署

## 部署模型

- Node 默认只监听 `127.0.0.1:3100`，不要让端口在内网或公网可直连
- 对外提供服务经反向代理（Nginx、Caddy 等）：只放行公开路径（`/`、`/r/`、`/verify`、`/api/verify/`、`/assets/`），`/admin` 与 `/healthz` 不对外
- 管理后台：本机（`localhost` / `127.0.0.1` / `[::1]`）恒可访问、无需配置；从其他机器访问需把该 Host 写入 `ADMIN_HOSTS`，并建议仅内网可达

三条铁律：

1. **`HOST=127.0.0.1`**——否则可绕过反向代理的 TLS、路径白名单与限流直连 Node，上层防护全部白做
2. **反向代理透传 `Host` + 覆盖式写 `X-Forwarded-For` + 应用设 `TRUST_PROXY`**——否则 Host 白名单失效、限流与审计拿到的 IP 失真
3. **`/admin` 不对外**——反代侧拒绝 + 应用侧 Host 白名单，两层缺一不可

对外怎么暴露（公网端口、隧道、CDN 等）由部署方自行决定，本文不作规定；应用只依赖上面两条约定。

> **AGPL 第 13 条提示**：若将本系统（含修改版）置于公网供他人交互使用，须以显著方式向交互用户提供对应源码的获取途径（指向本仓库的链接即可）；仅内网或自用部署无此项要求。

## 环境要求

- Node.js 22+（Windows 可用外置 `node/` 目录）
- 反向代理（可选但强烈建议；示例配置见 [`docs/nginx/`](nginx/)）

## 券面 PNG 字体

券面 PNG 正文字体在「服务设置 → 券面展示」选择（默认思源黑体），**仅按名称引用、仓库不携带字体文件**，需渲染机装有对应字体，缺字体时回退系统无衬线体（文字照样出图，只是字形不同）。品牌行 `QNQupon · 券能行` 是入库的字标轮廓，任何机器渲染一致，不受本节影响。

- **Linux（Debian/Ubuntu 示例，默认字体思源黑体 = Noto Sans CJK）**：

```bash
sudo apt install fonts-noto-cjk
fc-cache -fv            # 刷新字体缓存后重启服务
```

其他发行版安装 Noto Sans CJK / Source Han Sans SC 的对应包即可；选了 MiSans 或 HarmonyOS Sans SC 则自行下载安装到字体目录。

- **Windows**：把字体文件（如 `SourceHanSansSC-Bold.otf`、`MiSans.ttf`）复制到 `C:\Windows\Fonts` 安装（双击安装亦可），或放到服务账号可读的目录后在「字体设置」中安装；安装完成后重启 QNQupon 服务使渲染子进程拿到新字体。

## 配置 `.env`

复制 `.env.example` 为 `.env`，逐项说明：

| 变量 | 生产值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Node 监听地址，**最好是本机回环** |
| `PORT` | `3100` | Node 端口 |
| `PUBLIC_BASE_URL` | `https://coupon.example.com` | 新券二维码的公开 URL 基础；改域名后旧券需保留旧域名转发或重新导出 |
| `ADMIN_HOSTS` | 按需 | 管理后台允许的 Host（逗号分隔、大小写不敏感）；`localhost`、`127.0.0.1`、`[::1]` 恒放行无需配置，从其他地址访问后台（内网域名或 IP）必须写入，否则后台 404 |
| `TRUST_PROXY` | `127.0.0.1` | 只信任本机反代传来的 `X-Forwarded-For`。留空=不信任任何代理；**不要设 `true`**（全信任=可伪造）。不设则反代后全站共享一个限流桶（详见 SECURITY.md「IP 信任链」） |
| `DATABASE_PATH` | `./data/qnqupon.db` | 数据库路径 |
| `APP_ENCRYPTION_KEY` | 足够随机的长字符串（建议 ≥32 位） | 加密 SMTP 密码与 Token 副本；**丢了无法解密**，务必备份。生成方式不限——运行 `node scripts/generate-secrets.js` 可一次生成两串，也可自行敲入或用任意随机字符串生成器；与 `SESSION_SECRET` 各填一串 |
| `SESSION_SECRET` | 同上 | 会话相关密钥 |
| `COOKIE_SECURE` | `true` | 全站 HTTPS 时保持 `true`；仅纯 HTTP 联调时才临时设 `false` |
| `SESSION_HOURS` | `12` | 后台登录会话有效期（小时），允许 1–720 |
| `PASSWORD_MIN_LENGTH` | `12` | 密码最少位数，允许 8–128；前后台校验与表单提示随之变化 |
| `RATE_LIMIT_*` | 见 `.env.example` | 各入口限流，格式「次数/窗口」（如 `10/10m`）；写法非法回退默认值，对应关系见 SECURITY.md「限流」 |
| `TURNSTILE_SITEKEY` / `TURNSTILE_SECRET` | 空 = 关闭 | 登录页 Cloudflare Turnstile 人机验证：两键必须同时填写、改后重启生效；启用前提与停用方法见 SECURITY.md「登录人机验证」 |

以上防护参数改 `.env` 后需重启；**业务保留参数不走 `.env`**——登录后台「服务设置」直接修改（回收站静置/保留天数、确认码可查小时数、临期提醒天数），保存即生效。

SMTP 不写在 `.env` 里：登录后台 → **系统设置** 填写，密码用 AES-256-GCM 加密入库，页面有「发送测试邮件」按钮（已在真实 SMTP 验证可用）。

## 首次启动

```powershell
node\npm.cmd ci --cache .npm-cache
node\node.exe src\server.js
```

首次启动终端会输出可直接点开的 `/admin/setup` 链接与**一次性初始化口令**（经反代或域名访问时把地址换成你配置的后台域名）→ 打开创建唯一超级管理员（口令随即失效）。之后在系统设置里配置 SMTP 与备份保留份数。

## 反向代理

示例配置在 [`docs/nginx/`](nginx/)：

- `public.conf.example`——对外入口：只放行 `/`、`/r/`、`/verify`、`/api/verify/`、`/assets/`，`/admin` 与 `/healthz` 返 404
- `lan.conf.example`——管理入口：网段 `allow/deny` + 全路径代理（示例为自签证书）

两处**必须**做对的约定（否则应用限流失效或后台 404）：

```nginx
proxy_set_header Host $host;                     # 透传 Host，否则应用的 Host 白名单把后台判 404
# 覆盖式写入客户端 IP（$proxy_add_x_forwarded_for 是追加式，可被客户端伪造）：
#   直连场景用 $remote_addr（冲掉客户端自带的伪造 XFF）；
#   经 CDN 或隧道（如 cloudflared）时改用该层在边缘写入的客户端头，
#   例如 Cloudflare：proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
proxy_set_header X-Forwarded-For $remote_addr;
```

管理入口需要 TLS，自签即可（浏览器会警告，内部使用可接受）：

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout admin.example.com.key -out admin.example.com.crt -subj "/CN=admin.example.com"
```

Nginx 侧建议同时：`server_tokens off;`、`limit_req` 粗限流（示例已含）、`proxy_hide_header Server;`、`client_max_body_size 1m;`。

请求体上限 `client_max_body_size` 保持 nginx 默认 1m 即可：应用表单最大约 20KB、应用自身上限 32KB。若在别处（`http` 块或其它 include）配了更小的值，提交创建券面会**先撞 nginx 自带的英文 413 页**、请求根本到不了应用——用 `nginx -T` 查最终生效的 `client_max_body_size`，改回 `1m` 后 reload。

## 对外暴露（任选）

把服务暴露到公网的方式由你决定，应用只依赖上面两条约定。常见做法：

- 反向代理直接监听公网端口 + TLS（防火墙只开对应端口）
- 隧道类方案——从服务器**出站**建立连接，防火墙无需开放任何公网入站端口
- CDN / 边缘代理——注意 `X-Forwarded-For` 必须用该层**覆盖写入**的客户端头，且 `TRUST_PROXY` 只信任你的代理入口

无论采用哪种方式：**管理后台都不要对外暴露**——对外入口对 `/admin` 返 404，后台仅经内网地址或本机访问。

## 作为服务运行

- **Linux（systemd 示例）**：

```ini
[Unit]
Description=QNQupon
After=network.target

[Service]
WorkingDirectory=/opt/qnqupon
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
User=qnqupon

[Install]
WantedBy=multi-user.target
```

- **Windows**：`nssm install qnqupon "D:\path\to\node\node.exe" "D:\path\to\src\server.js"`，或任务计划程序"开机启动"。

## 备份与恢复

备份位于 `data/backups/`，每天由 SQLite **backup API** 产生（一致性快照，不是粗暴复制 WAL 运行中的文件），保留份数在后台「系统设置」调整（1–365）。

**恢复步骤**：

1. 停止服务
2. 将目标备份复制为 `data/qnqupon.db`，并处理同目录残留的 `-wal` / `-shm` 文件（删除或一并替换）
3. 启动服务，核对概览、券面与核销记录
4. `APP_ENCRYPTION_KEY` 与 `SESSION_SECRET` 必须与备份时一致，否则 SMTP 密码与 Token 副本无法解密——**密钥要另行备份**

**恢复演练建议**：部署后在测试机上完整走一遍以上四步，确认备份真的能用；此后每次升级前重复"备份 → 拷出 `data/`"。

## 升级须知

- 升级流程：停服 → 备份 `data/` → 更新代码 → `npm ci` → 启动 → 核对

## 常见问题

| 现象 | 原因与解法 |
| --- | --- |
| 全站/后台 404 | 反向代理没透传 `Host`，或 `ADMIN_HOSTS` 未包含访问后台所用的 Host（`localhost` / `127.0.0.1` 除外） |
| 对外域名能打开管理后台 | 对外入口没有屏蔽 `/admin`——对照 `public.conf.example` 补 `location` |
| 接口全 429 或限流"对不上人" | `TRUST_PROXY` 与反代 XFF 写法不匹配（必须覆盖式 + 只信任 127.0.0.1） |
| 提交表单返回 413（nginx 英文错误页） | 反代的 `client_max_body_size` 小于表单体积（表单最大约 20KB）——用 `nginx -T` 查最终生效值，改回 `1m` 后 reload |
| 本机打不开管理后台 | 理论上 `localhost` / `127.0.0.1` 恒放行——若经代理访问，请确认代理透传了 `Host` 且目标 Host 在白名单内 |
| Cookie 不生效、反复跳登录 | HTTPS 站点 `COOKIE_SECURE` 不是 `true`，或站点实际是 HTTP |
| 客人扫码打不开 | `PUBLIC_BASE_URL` 与实际公开域名不一致 |
| 邮件发不出 | 后台「发送测试邮件」看错误；核对 SMTP 端口/加密方式与发件账号授权码 |
