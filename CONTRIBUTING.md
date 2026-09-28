# 贡献指南

感谢关注！Issue 与 PR 均欢迎。

## 开始之前

- 环境搭建、测试与辅助脚本：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- 提交前确保 `npm test` 全部通过
- **安全漏洞请勿公开提 Issue**，走 [SECURITY.md](SECURITY.md) 的私下报告渠道

## 代码约定

- 界面文案首选中文，面向客人的页面每条提示要**简洁而全面**：说清事实与下一步，正式而不学术、不堆解释
- 服务端渲染、零构建；严格 CSP 要求模板**禁止内联 `<script>`、`style=` 属性与内联事件属性**（`onclick=` 等），否则功能会被浏览器直接拒绝执行
- SQL 一律 `db.prepare(...)` 预编译参数化，禁止拼接；HTML 输出一律 `esc()` 转义
- 时间一律 UTC 存储、北京时间显示（`beijingTime`）；有效期按 `Asia/Shanghai` 自然日比较
- 修改 `src/` 后需重启进程；`public/` 静态文件即改即生效
- 提交信息以中文一句话概括主题，正文用无序列表列要点；`feat:` / `fix:` / `docs:` 前缀可选

## 授权

贡献的代码以 [AGPL-3.0-only](LICENSE) 授权。
