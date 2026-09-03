# Pivi 推广计划与文案

> 生成日期：2026-08-29　|　版本背景：Pivi 0.19.4，已上架 Community Plugins，桌面端，macOS 已测试
>
> **统一信息主线（四个卖点，所有渠道都用这个顺序）：**
> 1. **零额外安装** — Pi agent 引擎直接内置在插件里。装 Pivi = 装好一切，没有独立 App、终端、Node 环境、`npm install`。
> 2. **为 Obsidian vault 而生** — 工具层建在 Obsidian 插件 API 和官方 Obsidian CLI 上（wikilink / frontmatter / backlinks，不是裸文件路径）。每次改笔记前自动写入官方 File Recovery 快照，删除走回收站——没有 plan mode 审批弹窗，但数据始终可恢复。
> 3. **Local & provider friendly** — 订阅直接登：Claude Pro/Max、ChatGPT (Codex)、Grok、OpenRouter、Kimi 均为 OAuth 一键登录；也支持 API key；完全本地跑 Ollama / LM Studio / llama.cpp；任意 OpenAI / Anthropic 兼容端点可自定义接入。
> 4. **为选中文本而设计** — 选中任意文字，编辑器上方浮出自定义 toolbar：润色/改写等 Pivi 命令、vault skills、甚至 Obsidian 原生编辑动作都能放上去，在 Settings → Toolbar 里自由开关排序；AI 改动以 diff 预览后落笔，不打断写作流。

## 一、渠道优先级（先做前 3 个）

| 优先级 | 渠道 | 为什么 | 形式 | 预估投入 |
|---|---|---|---|---|
| 1 | **Obsidian 官方论坛** Share & showcase → Plugins 板块 | 用户意图最强（都在找插件），加 `plugin-release` tag 后会被收录进目录索引，长尾流量持续 | 英文长帖 + GIF/截图 | 1 小时 |
| 2 | **Reddit r/ObsidianMD** | Obsidian 最大的英文社区，"I built…" 类帖子天然受欢迎，一条帖子几千浏览常见 | 英文帖，标题以场景切入 | 30 分钟 + 当天回复评论 |
| 3 | **Obsidian Discord 官方服务器** | `#updates` 频道发 release，`#plugin-dev` 拿 developer 角色后可发插件公告；新用户问题直接在这里答疑 | 短消息 + 链接 | 20 分钟 |
| 4 | **中文渠道：少数派、知乎、B 站、即刻、小红书** | 中文 Obsidian 用户集中在少数派和知乎；知乎靠"回答现有问题"引流比发新帖效果好 | 少数派投稿长文 / 知乎回答 / B 站 3 分钟演示 | 每篇 1–2 小时 |
| 5 | **X / Bluesky** | Kepano 和官方账号（@obsdmd）活跃，带 #obsidian hashtag 有机会被转发 | 1 条短推 + GIF | 15 分钟 |
| 6 | **Newsletter / 聚合站** | obsidian-plugin-stats.vercel.app 会自动收录更新；可主动投稿 PKM Weekly（Ed Nico）、"This Week in Obsidian"；给 awesome-obsidian 类列表发 PR | 邮件 / PR | 30 分钟 |

## 二、发帖前检查清单

1. 论坛先搜 "Pivi" 确认没有旧帖；有旧帖就更新旧帖而不是新开。
2. 每个渠道用不同开头——复制粘贴同一段会被判广告。
3. GIF 优先于截图（README 里的 4 张图可以直接转 GIF 用）。
4. 明确写 "macOS tested, Windows/Linux should work"——避免用户踩坑后差评。
5. 发完第一天守评论区，前 24 小时的回复率决定帖子热度。
6. **卖点 2 的措辞纪律**：说 "no plan-mode approval loops, changes recoverable through Obsidian's own File Recovery snapshots and trash"——不说 "完全无风险"；被追问安全模型时指向 SECURITY.md。

## 三、文案

### 3.1 英文 — 官方论坛（Share & showcase → Plugins，tag: `plugin-release` + `ai`）

**标题：** Pivi — a vault-native AI agent, Pi built in, no plan mode, works with your subscriptions

**正文：**

> I've been building **Pivi**, an AI agent that lives inside Obsidian's sidebar — and I'd love feedback from this community.
>
> **1. Nothing else to install.** The Pi agent engine ships *inside* the plugin. Install Pivi from the community directory and you're done — no separate app, no terminal, no Node environment, no `npm install`. It's a plugin, not a dev tool.
>
> **2. Built for your vault, not for your codebase.** Pivi's tools sit on Obsidian's plugin API and the official Obsidian CLI: they understand wikilinks, frontmatter, and backlinks — not raw file paths. It can map orphans and unresolved links, manage properties, work with Bases and daily notes. And because it's made for knowledge work, there are **no plan-mode approval popups**: before every edit Pivi snapshots the note into **Obsidian's own File Recovery**, and deletes go to trash — your data stays recoverable through the Obsidian features you already trust.
>
> **3. Built around your selection.** Select any text and a toolbar floats right above it: polish and rewrite commands, your vault skills, even native Obsidian editor actions — all enabled and reordered in **Settings → Toolbar**. AI edits preview as a diff before landing, so your writing flow never breaks.
>
> **4. Local-friendly, provider-friendly.** Sign in with what you already pay for: **Claude Pro/Max, ChatGPT (Codex), Grok, OpenRouter, and Kimi** are one-click OAuth — no API keys to create. Prefer keys? They work too, stored in Obsidian's secretStorage. Prefer fully local? **Ollama, LM Studio, and llama.cpp** run out of the box, and any OpenAI- or Anthropic-compatible endpoint can be added as a custom provider. No telemetry either way.
>
> Beyond the core loop: delegate big jobs ("scan the vault and summarize every project folder") to concurrent **subagents**, teach it your workflows with **vault skills** ([kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) installs with one confirmation), and wire in **MCP servers** with OAuth.
>
> Install: community plugins → search **Pivi**, or [the plugin page](https://community.obsidian.md/plugins/pivi). Repo and docs: https://github.com/shuuul/obsidian-pivi
>
> **Requirements:** Obsidian 1.12.0+, desktop. Tested on macOS; Windows and Linux should work but aren't officially supported yet — reports from those platforms genuinely appreciated.
>
> What workflows would you want an in-vault agent to handle? That directly shapes what tools get built next.

*发帖时在正文顶部插入 subagents GIF 或 slash-selector GIF。*

### 3.2 英文 — Reddit r/ObsidianMD

**标题（选一）：**
- I built an AI agent that lives inside my vault — Pi engine built in, no plan mode, signs in with my Claude/ChatGPT subscription
- An AI agent for Obsidian with nothing else to install: no separate app, no terminal, no approval popups

**正文：**

> I write long-form notes and kept bouncing between Obsidian and a terminal AI to use my vault as context. So I built **Pivi** — an AI agent that runs in Obsidian's sidebar.
>
> Three things that make it feel different:
>
> - **Nothing else to install.** The Pi agent engine is bundled inside the plugin. Install Pivi, add nothing else — no desktop app, no terminal, no Node setup.
> - **It's built for the vault, not for code.** Its tools use Obsidian's plugin API and the official CLI — wikilinks, frontmatter, backlinks — so I can ask "find orphan notes about X and link them into my MOC" and it works on vault structure, not grep. No plan-mode approval loops either: every edit snapshots the note into Obsidian's own File Recovery first, deletes go to trash, and that's the whole safety story.
> - **It takes my existing subscription.** Claude Pro/Max, ChatGPT/Codex, Grok, OpenRouter, and Kimi are one-click OAuth sign-ins. Or go fully local with Ollama / LM Studio / llama.cpp, or plug in any OpenAI/Anthropic-compatible endpoint.
> - **It lives where I write.** Select a paragraph and a toolbar floats above it — "tighten this", any vault skill, even native Obsidian editor actions, all customizable in Settings → Toolbar. The edit previews as a diff before it lands.
>
> Day to day: big jobs get split across subagents (summarize 30 meeting notes) while I keep typing; skills (kepano's obsidian-skills work out of the box) and MCP servers plug in when I need them. No telemetry, keys live in Obsidian's secretStorage.
>
> Install: Community plugins → search "Pivi"　|　Repo: https://github.com/shuuul/obsidian-pivi
>
> Fair warning: desktop + macOS-tested (Win/Linux should work). AMA — especially about the tool design, happy to go deep.

### 3.3 英文 — X / Bluesky（一条）

> Pivi: an AI agent that lives inside Obsidian.
> - Pi engine built in — nothing else to install
> - Vault-native tools + File Recovery snapshots before every edit; no plan-mode popups
> - Select text → floating toolbar: polish, vault skills, your own shortcuts — fully customizable
> - Signs in with Claude Pro/Max, ChatGPT, Grok, OpenRouter — or runs fully local (Ollama/LM Studio)
> https://community.obsidian.md/plugins/pivi
> #obsidian

### 3.4 中文 — 知乎（回答现有问题用，例如"Obsidian 有哪些好用的 AI 插件"）

> 推荐一个我最近在用的（也是我开发的，利益相关预警）：**Pivi**。
>
> 它和常见 Obsidian AI 插件的区别有四点：
>
> 1. **不用额外装任何东西。** Pi agent 引擎直接内置在插件里——没有独立 App、没有终端、没有 Node 环境。装 Pivi 一个插件就完事。
> 2. **它是给笔记库设计的，不是给代码库设计的。** 工具层建在 Obsidian 插件 API 和官方 CLI 上，理解 wikilink / frontmatter / 反链，所以"找出关于 X 的孤儿笔记并链接到我的 MOC"这种话它真能做。没有 plan mode 审批弹窗——每次改笔记前它先写入 Obsidian 官方的 File Recovery 快照，删除走回收站，数据安全靠的是 Obsidian 自带的机制而不是一堆确认框。
> 3. **为选中文本设计。** 选中任意文字，编辑器上方浮出 toolbar：润色改写、你的 vault skills、甚至 Obsidian 原生编辑动作，都能在 Settings → Toolbar 里自由开关排序；AI 改动先出 diff 预览再落笔。
> 4. **订阅直接登。** Claude Pro/Max、ChatGPT (Codex)、Grok、OpenRouter、Kimi 都是 OAuth 一键登录，不用申请 API key；想本地跑也行，Ollama / LM Studio / llama.cpp 开箱即用，任意 OpenAI/Anthropic 兼容端点都能自定义接入。无遥测。
>
> 另外支持并行 subagent（比如"扫全库给每个项目文件夹写摘要"）、Agent Skills（kepano 官方的 obsidian-skills 开箱即用）和 MCP 服务器。
>
> 安装：社区插件市场搜 Pivi。目前桌面端，macOS 测试最充分。GitHub：https://github.com/shuuul/obsidian-pivi
>
> 欢迎在评论区提需求，工具路线图基本跟着用户工作流走。

### 3.5 中文 — 少数派（投稿标题 + 大纲）

**标题：** 不用装第二个 App：我给 Obsidian 做了一个"自带引擎、订阅直登"的 AI Agent——Pivi 使用详解

**大纲（正文按此展开 2000–3000 字）：**
1. 痛点：现有 AI 方案三选一都很别扭——独立 App 切来切去 / 编程 agent 硬塞进笔记（权限弹窗、终端、装环境）/ 纯聊天面板改写不了结构
2. Pivi 的答案一：Pi 引擎内置，装一个插件 = 装好一切
3. Pivi 的答案二：vault-native 工具层（API + 官方 CLI），以及"没有 plan mode 但数据安全"的设计——File Recovery 快照 + 回收站
4. Pivi 的答案三：选中即用——自定义 selection toolbar（Pivi 命令 / skills / Obsidian 原生动作），diff 预览落笔
5. Pivi 的答案四：订阅直登（Claude Pro/Max、ChatGPT、Grok、OpenRouter、Kimi）与全本地（Ollama / LM Studio / llama.cpp）
6. 三个日常场景演示：选中润色、整理库（孤儿笔记/死链）、subagent 并行摘要
7. Skills 与 MCP：把"我的工作流"教给 agent
8. 安装与上手：社区插件市场搜 Pivi → Settings → Pivi 登录订阅 → 第一条建议指令

### 3.6 中文 — 即刻 / 小红书（短版）

> 做了个 Obsidian AI 插件叫 Pivi 🧩 四个特点：
> ① Pi 引擎内置，装完插件就完事，不用再装 App / 终端 / Node
> ② 为笔记库设计：理解双链和 frontmatter，改笔记前自动存 Obsidian 官方快照，没有 plan mode 弹窗
> ③ 选中文字直接浮出 toolbar：润色 / skills / 自定义快捷操作，diff 预览再落笔
> ④ Claude Pro/Max、ChatGPT、Grok 订阅一键登录；Ollama / LM Studio 全本地也行
> 社区插件市场搜 "Pivi"。求反馈 🙏

## 四、后续节奏（做完前 3 项再回头看）

- 每次发 minor 版本：论坛旧帖回帖 + Discord `#updates` + X 一条（自动被 plugin-stats 收录）
- 攒 3–5 个用户真实用例后，再投少数派长文——有案例的教程比纯介绍转化高得多
- B 站/YouTube 3 分钟演示视频：等论坛帖收集到高频问题后拍，一条视频同时回答十个问题
