---
title: af_ 系统运维灾难复盘：当 Claude Code 在多机多仓环境下改了三天代码
date: '2026-07-28'
description: 别让 AI 在没版本控制的机器上改代码，你会哭着补回来的
pin: false
draft: false
coverImage: /img/af-claude-code-ops-pitfalls.png
---

## 背景

af_ 是一个全站 SSR 的个人站点系统，由 7 个 GitHub 仓库（前端 / 博客数据 / 论坛后端 / AI 生图后端 / 友链数据 / 文件列表 / 评论存储）组成，跑在两台 VPS 上——一台公网主力、一台局域网 GPU 盒子。全站通过 Cloudflare CDN + cloudflared 隧道对外暴露。

2026 年 7 月 28 日，我用 Claude Code 做了一轮全站性能优化和论坛通知系统重构，踩出了一批「只有在真实多机环境下才会爆」的坑。这篇文章不是教程，是验尸报告。

## 坑一：GitHub 仓库里躺着 V1，生产跑着 V2

AI 生图后端经历过一次 JSON → SQLite 大重构，旧代码在 `node-server/`（V1），新代码在 `node-server-v2/`（V2）。看似井水不犯河水——supervisor 管着 `nDI-v2`（9090 端口），`nDI`（V1）早就停了。

但问题是：我收 V2 源码进 GitHub 的时候，从远端拉回来的已经是**被我改过的文件**——因为我在 scp 上去之前先在远端就地改了一轮，V2 的原始代码从未进入过任何版本库。而留在 GitHub 上的 `node-server/` 是一个不完整的 V1 残骸，缺了 `notify.ts` 等关键文件。

然后我又在没区分 V1/V2 的情况下，对 V1 目录一顿改。等发现 `tsx watch` 热重载不生效、supervisor 重启之后改了的东西全丢了，才意识到——我根本没动生产实例。

**教训**：远端放源码但不跟 git 同步的时候，你永远不知道你改的是哪一份。要么远端只放构建产物，要么远端就是 `git clone`，没有第三条路。

## 坑二：Token 配置里的引号让通知系统从上线第一天就是死的

论坛的 `/internal/notify` 是对外通知接口，生图后台通过它推送 LoRA 审核结果和图片推荐通知给用户。鉴权用的是常量时间比对：

```ts
const expected = String(env.NOTIFICATION_SERVICE_TOKEN || "");
const token = auth.slice(7); // 去掉 "Bearer "
if (token.length !== expected.length) return 401;
```

而 `.dev.vars` 里的写法是：

```
NOTIFICATION_SERVICE_TOKEN="ns_c800e73e..."
```

wrangler 对 `.dev.vars` 的处理是「等号后面全部是值」，所以 `expected` 的实际值是 `"ns_..."`——带着双引号，70 个字符。调用方传的是不带引号的 67 个字符。长度比对直接挂掉，返回 401。

这意味着**从通知系统部署的那天起，所有外部通知请求都是 401**。用户收到的 QQ 通知全部来自 `sendQQNotify` 那条直连 OneBot 的旁路，邮件则从来就没发出去过——因为邮件走的是 `/internal/notify/email`，同样被这条 token 拦住了。

**教训**：`.dev.vars` 里面不要加引号。更根本的是——部署后的第一条验证不应该是「接口返回了 200 吗」，而应该是「用户真的收到了吗」。

## 坑三：不创建 git 提交的开发模式 = 定时炸弹

论坛后端在很长时间里不是 git 仓库。代码改动靠 `cp src/index.ts src/index.ts.bak-xxx` 手工备份。于是就有了 8 个 `index.ts.bak-*` 文件，每个都是某个时间点的线上状态快照——但没有一个能告诉你「现在跑的是哪个」。

结果就是：QQ 绑定功能在一个不含限流逻辑的旧基线上开发，上线时整份覆盖了 `src/index.ts`，把已上线的 6 项限流配置（注册冷却 / 验证邮件重发 / 登录失败锁定等）、三个会话管理端点、地理位置读取函数全部抹掉。数据库的 migration 还在（`ip_rate_limits` 表完好），但后端代码没了——所有限流直接消失。

更离谱的是前端：上一轮性能优化（CSS 预加载头 / chunk 合并 / hljs.css 下放）只存在于 VPS 上的 `/root/svaf-next`（那不是 git 仓库），本地仓库里完全没有。下一次本地构建就会覆盖掉。

**教训**：代码改动一旦上线，立刻提交。这条不是靠自觉，是靠今天差点丢掉两套功能换来的肌肉记忆。

## 坑四：Workers 运行时会在 return 之后砍掉你的异步任务

通知系统重构后，QQ 能收到了，邮件怎么都发不出去。排查了半天，发现是 Workers 运行时的行为跟 Node.js 不一样：

```ts
// 这段代码在 Node.js 里完全正常
sendQQNotify(userId, qqMsg).catch(() => {});
return jsonResponse({ ok: true });
// sendQQNotify 在后台继续跑，最终发出

// 但在 Cloudflare Workers 里
ctx.waitUntil(sendQQNotify(userId, qqMsg).catch(() => {}));
return jsonResponse({ ok: true });
// 不加 ctx.waitUntil，sendQQNotify 的 Promise 会被运行时在 response 返回后立刻 GC
```

`sendEmail` 同样中招。问题是 `.catch(() => {})` 把错误也吞了，日志里什么都不会出现——你以为发出去了，实际上被悄无声息地砍了。

**教训**：在 Workers 里做 fire-and-forget，必须 `ctx.waitUntil()`。而且永远不要用空 catch。

## 坑五：论坛的 `res.set()` 不是「设置」，是「追加」

`@react-router/express` 搬运 RR Response 头到 Express response 时用的是 append 而非 set。这意味着如果在中间件里 `res.set("Cache-Control", "max-age=0, must-revalidate")`，它不是覆盖路由自己的 `Cache-Control`，而是**追加第二条**。

实测后果：`/__manifest` 同时带上 `max-age=0, must-revalidate` 与 `max-age=31536000, immutable`。Cloudflare 看到两条冲突指令，直接判 `DYNAMIC` 全量回源。URL 里带 `?version=<内容哈希>` 的 manifest 本该是永久缓存的，结果一次访问下两遍。

更惨的是 `/posts/rss.xml`、`/forum/rss.xml`、`/llms.txt`、`/robots.txt`——它们各自声明了 `max-age=600` 之类的缓存策略，全部被全局兜底值污染，没有一个生效。

**教训**：在 `@react-router/express` 架构下设全局响应头，必须覆盖 `res.writeHead` 而不是 `res.set`。

## 坑六：消息模板到底归谁管

通知系统最初的设计是：生图后台通过 `sendEmail(type, subject, body)` 向论坛推送原始消息文本，论坛只做鉴权和转发。但我在重构时自作主张在论坛侧加了 switch 块，按 `type` 分类重写消息——"你的 LoRA 模型《xxx》已通过审核"、"你的图片《xxx》已被推荐"。

用户立刻发现：消息变成了四不像。原来的模板被扔掉了，新生成的消息既没有上下文也没有风格。

正确做法是：**论坛只做透传，调用方决定消息内容**。论坛的职责是鉴权 + 偏好检查 + 渠道分派（QQ / 邮件），消息文案一律由调用方（生图后台）在调用时确定。论坛侧一个模板都不该有。

**教训**：API 边界不清晰的时候，最容易做多。透传比生成安全一万倍。

## 现在的状态

- 论坛通知系统：统一入口 `/internal/notify`，纯透传 `{user_id, type, subject, body}`，自动根据用户偏好分派 QQ/邮件
- 生图后台：LoRA 审核 / 图片推荐的通知全部走论坛统一接口，QQ 直推走 OneBot 旁路
- 博客广播：`post-bc.yml` 打论坛 `/api/webhook/posts`，一份请求同时触发邮件和 QQ
- QQ 绑定 + 高粒度通知偏好设置已恢复到 `/forum/me`
- 两个仓库均已纳入 git 版本控制并推送到 GitHub 私有仓库
- 前端性能：`/posts` 页面总重量 3.3MB → 313KB

如果这篇文章能救一个人免于在没 git 的机器上改三天代码，那这些坑就没白踩。
