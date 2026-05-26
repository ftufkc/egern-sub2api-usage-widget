# Egern Sub2API Usage Widget

Egern 小组件模块，用来查看 Sub2API 今天的用量：

- 总请求数
- 总 Token
- 实际消费
- 平均耗时

## 安装

在 Egern 中进入 `工具` -> `模块` -> 右上角 `+`，添加下面的模块 URL：

```text
https://raw.githubusercontent.com/ftufkc/egern-sub2api-usage-widget/main/sub2api-usage.module.yaml
```

保存后进入模块的 `Env` 配置，填写：

| 参数 | 说明 |
| --- | --- |
| `BASE_URL` | Sub2API 站点根地址，例如 `https://example.com`，不要填写 `/admin/usage` |
| `EMAIL` | Sub2API 管理员邮箱 |
| `PASSWORD` | Sub2API 管理员密码 |

然后进入 `分析` -> 左上角小组件画廊，选择 `Sub2API 今日用量`。添加到 iOS 主屏幕后，长按 Egern 小组件并在编辑界面选择这个小组件名称。

## 数据口径

小组件每次刷新时会：

1. 请求 `POST /api/v1/auth/login` 登录；
2. 请求 `GET /api/v1/admin/usage/stats?period=today` 读取今日统计；
3. 显示 `total_requests`、`total_tokens`、`total_actual_cost`、`average_duration_ms`。

脚本会携带当前系统时区；无法读取时默认使用 `Asia/Shanghai`。刷新时间由 iOS 和 Egern 共同调度，脚本会请求约 10 分钟后刷新。

## 隐私

仓库不包含任何默认站点、账号或密码。你的 `BASE_URL`、`EMAIL`、`PASSWORD` 只应填写在 Egern 模块 Env 中。

如果账号启用了 2FA，小组件无法自动完成登录，会显示错误提示。

## 本地测试

```bash
npm test
```
