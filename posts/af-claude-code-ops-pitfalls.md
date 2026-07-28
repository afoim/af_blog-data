---
title: af_ 系统运维灾难复盘：当 Claude Code 在多机多仓环境下改了三天代码
description: 别让 AI 在没版本控制的机器上改代码，你会哭着补回来的
coverImage: /img/af-claude-code-ops-pitfalls.png
date: 2026-07-28
draft: false
pin: false
---
> [!CAUTION] 本文使用 DeepSeek-V4-Pro 编写。

2026 年 7 月 28 日，我计划给全站做一轮性能优化，顺带把论坛的通知系统重构掉。预期半天收工，结果干了整整一天，中间两次差点把线上功能丢光。事后来看，所有的问题都指向同一件事：**在多机多仓、有生产数据的真实环境里，AI 编程助手缺乏仓库拓扑感知能力时，会系统性犯错。**

这篇文章不是教程，是验尸报告。

---

## 起点：一切看起来都很正常

af_ 是一个全站 SSR 的个人站点系统，架构上由 7 个 GitHub 仓库组成——前端（`af_frontend`）、博客内容（`af_blog-data`）、论坛后端（`af_forum-backend`）、AI 生图（`af_draw-backend`）、友链数据（`af_friends-data`）、文件列表（`af_files-data`）、以及 giscus 评论存储（`af_comments-data`）。

部署层面，前端和论坛跑在一台公网 VPS 上（Express + supervisor + wrangler dev），生图后端跑在局域网的另一台 GPU 盒子上，整个站点通过 Cloudflare + cloudflared 隧道对外暴露。

看起来很规整。问题是：**规整只存在于我的脑子里，不存在于任何一个文件里。**

当天动手之前，论坛后端的 `src/index.ts` 不在任何 git 仓库里——代码的"版本控制"是靠 `cp src/index.ts src/index.ts.bak-xxx` 手工备份，一共有 8 个这样的快照，但没有任何标记能告诉你"现在线上跑的是哪个"。前端稍微好一点，本地有个 git 仓库，但那个仓库没有任何 remote——唯一的源码副本在我这台 Windows 的硬盘上。

这些信息 Claude Code 都不知道。

---

## 第一轮：V1 vs V2，改了半个小时才发现改错机器

任务列表里有一项是"AI 生图端点检查"。AI 生图后端经历过一次 JSON → SQLite 大重构：旧代码在 `node-server/`（V1），新代码在 `node-server-v2/`（V2）。supervisor 里 `nDI-v2` 跑着 9090 端口的生产实例，`nDI` 早就停了。

但 GitHub 上的 `af_draw-backend` 仓库里，V1 目录是一个不完整的残骸（`notify.ts` 等关键文件从来就没被提交过），V2 目录则根本没有进过版本控制——它的源码只存在于远端机器上的 `/root/nDI/node-server-v2/`。

于是当 Claude Code 开始改 AI 生图的通知代码时，它改的是 GitHub 上那一份 V1 残骸。而真正在跑的 V2 实例用的是 `tsx` 直接跑源码，改完没有热重载——需要 `supervisorctl restart`。

改了半小时，部署上去毫无反应。查 supervisor 状态才发现：`nDI STOPPED`，`nDI-v2 RUNNING`。

**教训一号**：源码只存在本地，被部署方只放构建产物。远端放源码但不跟 git 同步的时候，AI 助手会随机选择一个看起来像的目录开始改——它不知道哪个是活的。

---

## 第二轮：限流和会话管理被静悄悄抹掉了

论坛后端的通知系统改造是当天的重头戏。在重构 `notifyByType` 函数时，Claude Code 注意到 TS 报错从 74 条降到了 65 条——删掉了一个废弃的函数，连带消掉了 9 条类型错误。

但在提交代码的 diff 里，有经验的人会发现不对劲：文件从 6120 行变成了 6077 行，净减少 43 行——这不只是"删了一个废弃函数"能解释的。

回头查 `src/index.ts.bak-*` 历史，发现更早的时候，QQ 绑定功能在一个**不含限流逻辑**的旧基线上开发，开发完成后整份文件覆盖了线上版本。被覆盖掉的内容包括：

- 6 项限流配置（注册 IP 冷却 / 验证邮件重发间隔 / 登录失败锁定阈值 / 等等）
- `/api/user/sessions` 系列三个会话管理端点
- `readGeoFromHeaders`（从 CF 头部提取访客地理位置）

数据库的 migration 都还在——`ip_rate_limits` 表完好，`0013` 到 `0016` 号 migration 都已应用。**但后端代码没了。** 于是所有限流直接消失：同一 IP 可以在 5 秒内注册 100 次，登录爆破防护为零。

前端也有同类问题。上一轮性能优化（CSS Link 预载头、Rolldown chunk 合并、hljs.css 按路由加载）只存在于 VPS 上的 `/root/svaf-next`——那不是一个 git 仓库。本地仓库完全没有这些改动，下一次构建就会覆盖。

**教训二号**：改完并真实上线后，立刻提交。不要攒着。攒着的后果就是下次不小心整体撤销，一次丢掉一大片。

---

## 第三轮：Token 配置里多了一对引号，通知系统从 V1 时代就是死的

重构论坛通知接口时，需要统一 `/internal/notify` 和 `/internal/notify/email` 两个端点。前者处理 QQ + 邮件双渠道，后者只发邮件。生图后台通过这两个接口推送 LoRA 审核结果和图片推荐通知。

鉴权用的是常量时间比对：

```typescript
const expected = String(env.NOTIFICATION_SERVICE_TOKEN || "");
const token = auth.slice(7); // 去掉 "Bearer "
if (token.length !== expected.length) return 401;
```

`.dev.vars` 里的写法是：

```
NOTIFICATION_SERVICE_TOKEN="ns_c800e73e..."
```

wrangler 对 `.dev.vars` 的处理是「等号后面全部是值，不剥引号」。于是 `expected` 的实际值是 `"ns_..."`——带着双引号，70 个字符。调用方传的是不带引号的 67 个字符。长度比对第一步就挂，直接 401。

这意味着**从通知系统部署的那天起，所有外部通知请求都走不通鉴权**。用户收到的 QQ 通知全部来自 `sendQQNotify` 那条直连 OneBot 的旁路（走的是 SVAF_INTERNAL_API_TOKEN，另一个 token），邮件则从来就没发出去过——因为老的 `/internal/notify/email` 也被同一条 token 拦住了。

这个问题跟今天的任何改动都无关——它从配置之日起就在那。只是从来没有人验证过"用户真的收到了吗"。

**教训三号**：部署后的第一条验证不应该是"接口返回了 200 吗"，而应该是"用户真的收到邮件了吗"。

---

## 第四轮：ctx.waitUntil，Workers 运行时的无声杀手

通知系统重构完成后，QQ 消息能收到了，但邮件死活不发。日志里干干净净，没有任何报错。

排查到最后，问题出在 Workers 运行时对异步任务的处理方式跟 Node.js 完全不同：

```typescript
// 在 Node.js 里完全正常——Promise 在后台自己跑完
sendEmail(email, subject, body, env).catch(() => {});
return jsonResponse({ ok: true });

// 但在 Cloudflare Workers 里，response 返回后运行时立刻回收未完成的 Promise
// 必须显式告诉运行时"等我跑完"
ctx.waitUntil(sendEmail(email, subject, body, env).catch(...));
```

`sendQQNotify` 刚好加过 `ctx.waitUntil`，所以 QQ 能发；`sendEmail` 没加，所以邮件被静默砍掉。而 `.catch(() => {})` 又把所有异常吞了——既不发邮件，也不打日志。

这个问题同时出现在 `/internal/notify` 的邮件分派和 `notifyByType` 的邮件路径上。全量 grep 一遍 `ctx.waitUntil`，又发现 `/api/webhook/posts`（博客文章广播）的 `sendOne` 函数里同时调了 `sendEmailByTemplate` 和 `notifyByType`——前者直发邮件，后者内部也发邮件——于是博客广播每篇邮件发两遍。

**教训四号**：在 Workers 里做 fire-and-forget，必须 `ctx.waitUntil()`。而且永远不要用空的 `.catch(() => {})`。

---

## 第五轮：消息模板到底归谁管

通知系统最初也是最终的设计都很清晰：调用方（生图后台）负责消息文案，论坛只做鉴权 + 偏好检查 + 渠道分派。

但我在重构 `/internal/notify` 时画蛇添足，在论坛侧加了一个 switch 块，按 `type` 分类重写消息：

```typescript
case "lora":
  emailSubject = "LoRA 模型审核结果";
  emailBody = `<p>你的 LoRA 模型《${dName}》${dAction}。</p>`;
  break;
case "recommendation":
  emailSubject = "你的图片被推荐了";
  // ...
```

生图后台那边，原始模板是这样的：

> 用户 #1 推荐了精选图片
> 图片: /path/img.png
> 理由: 构图很好

到了论坛这边变成了「你的图片《精选图片》已被推荐」——原始的图片路径和推荐理由全丢了。

改回来只花了五分钟：删掉 switch 块，所有类型走 default 透传。`notifyLora` 和 `notifyRecommendation` 改回传 `subject + body` 原始模板。

**教训五号**：API 边界不清晰的时候最容易做多。透传比生成安全一万倍。消息的内容永远由数据的生产者决定。

---

## 收尾：把仓库治好

一天改完，最长的工时其实花在了两件跟代码无关的事上：

**建仓库**：前端 `svaf-next` 没有任何 remote，论坛后端根本不是 git 仓库。给 7 个仓库统一加了 `af_` 前缀，按「后端源码必须私有」设置了可见性，把 VPS 上两份现役代码（前端 + 论坛后端）推到了 GitHub。前端推送前还发现历史里有 166MB 的 zip 误提交，用 `git filter-repo` 清理了一轮。

**写 AGENTS.md**：仓库关系的唯一权威索引。每个项目的部署形态（VPS / 边缘 / 局域网）、对外域名、可见性，都在里面。以后任何 Claude 会话在这个仓库打开，第一件事就是读完这张表。

---

## 现在的全貌

- 论坛通知统一入口 `/internal/notify`，纯透传 `{user_id, type, subject, body}`，按用户偏好分派 QQ/邮件
- 生图后台 LoRA 审核 / 图片推荐全部走论坛统一接口，QQ 直推走 OneBot 旁路
- 博客广播 `post-bc.yml` 打 `/api/webhook/posts`，一封请求同时触发邮件 + QQ（邮件已修：不再重复发送）
- 前端 `/forum/me` 恢复了 QQ 绑定 + 7 类事件 × 2 渠道的高粒度通知偏好设置
- 前端性能：`/posts` 页面总重量 3.3MB → 313KB（封面缩略图 / 头像压缩 / CSS 预加载 / chunk 合并 / 图标按需加载 / 论坛配图按需缩放）
- 全站禁用 JavaScript 仍可访问，零 Suspense 流式占位

如果有第三个人要在这种多机多仓的环境里用 AI 改代码，我唯一的建议是：**先把所有仓库建好、推上去、写完 AGENTS.md，然后再开始改。** 省下的时间不是一两个小时，是一整天和两条差点丢掉的线上功能。