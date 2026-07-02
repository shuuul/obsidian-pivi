# ContextBadge 重构设计

## 背景

Pivi 现在已经有多种“上下文 token / badge / chip”形态，但它们分散在不同模块中：

- 已发送消息中的 mention badge：`src/ui/shared/mention/renderMentionBadges.ts`
- composer 内联 mention badge：`src/ui/shared/mention/inlineMentionBadgeDom.ts`
- `@` mention dropdown：`src/ui/shared/mention/MentionDropdownController.ts`
- 文件附件 chip：`src/ui/chat/ui/file-context/view/FileChipsView.ts`
- slash command dropdown：`src/ui/shared/components/SlashCommandDropdown.ts`
- 相关样式：`src/styles/components/mention-badges.css`、`src/styles/components/input.css`、`src/styles/features/file-context.css`、`src/styles/features/slash-commands.css`

这些实现已经在视觉上接近，但数据模型、label/icon/tooltip 逻辑、DOM 结构、可点击/可删除行为、序列化方式都不是同一套。继续新增 skill、folder、MCP、agent、inline context 时，会不断复制逻辑并造成 UI 漂移。

Zed 的相关设计提供了一个更稳的方向：用统一 typed mention 模型表达 file、directory、skill、thread、diagnostics 等上下文类型，再由模型派生 label、icon、tooltip、click behavior 和 prompt payload。Pivi 可以借鉴这个方向，但需要按 Obsidian plugin 的约束做 TypeScript/DOM 化落地。

## 目标

大规模重构的目标是建立一套统一的 **ContextBadge** 系统：

1. 所有上下文类 UI token 使用同一个 view model。
2. composer 内联 badge、已发送消息 badge、文件 chip 使用同一个渲染 primitive。
3. file、folder、skill、MCP、agent、inline context 的 label/icon/tooltip/serialization 只定义一次。
4. slash command 与 ContextBadge 在视觉语言上对齐；其中“注入上下文/能力”的 slash skill 可以转为 ContextBadge，纯 UI command 保持命令语义。
5. prompt serialization 和 UI 展示分离，避免把 UI label 当作发送给 Pi 的真实 payload。
6. 保持当前 Pi-only、linear session 的方向，不重新引入 conversation tree 概念。

## 非目标

- 不把所有 slash command 都持久化为 badge。
- 不把 Pi session 改回 tree/leaf 模型。
- 不引入外部 UI 框架。
- 不一次性改动 prompt/runtime 语义；第一阶段只统一 UI 与 token 模型，prompt payload 保持兼容。
- 不把 Obsidian API 直接泄漏到平台中立 package；Obsidian 打开文件等行为仍留在 UI/app 或 host boundary。

## 核心概念

### ContextBadgeKind

ContextBadge 是“用户可以看见、可选可点、可选可删除，并可能参与 prompt 构建的上下文 token”。建议的初始类型：

```ts
export type ContextBadgeKind =
  | 'file'
  | 'folder'
  | 'mcp'
  | 'skill'
  | 'agent'
  | 'inline-context'
  | 'attachment';
```

说明：

- `file`：vault note 或外部文件引用。
- `folder`：vault folder 或外部 context root。
- `mcp`：MCP server/tool mention。
- `skill`：slash skill 或 `@skill` 选择后产生的能力/上下文 token。
- `agent`：子 agent mention。
- `inline-context`：选中文本/块级上下文。
- `attachment`：当前文件 chip 的后继，表示 composer 已附加文件。

### ContextBadgeToken

模型需要区分“显示所需字段”和“发送/恢复所需字段”。建议先放在 UI 共享层，等语义稳定后再考虑移动到 `@pivi/core` 或新 package。

```ts
export type ContextBadgeToken =
  | {
      kind: 'file';
      token: string;
      path: string;
      label?: string;
      source?: 'vault' | 'external';
    }
  | {
      kind: 'folder';
      token: string;
      path: string;
      label?: string;
      source?: 'vault' | 'external';
    }
  | {
      kind: 'mcp';
      token: string;
      serverName: string;
      toolName?: string;
    }
  | {
      kind: 'skill';
      token: string;
      commandName: string;
      source?: string;
      skillPath?: string;
    }
  | {
      kind: 'agent';
      token: string;
      agentId: string;
      label: string;
      source?: string;
    }
  | {
      kind: 'inline-context';
      token: string;
      label: string;
      context: InlineContextRef;
    }
  | {
      kind: 'attachment';
      token: string;
      path: string;
      label?: string;
    };
```

`token` 是 composer 文本中实际保存/发送/恢复的稳定 token，不等于 label。比如：

- file：`@[[Note.md]]` 或现有 raw token。
- folder：现有 folder mention raw token。
- MCP：`@server` 或现有 MCP mention raw token。
- skill：`/skill-name`、`@skill:name` 或后续确定的稳定 token。
- inline-context：现有 inline context raw token。

### ContextBadgeViewModel

所有渲染入口先把 token 规范化为 view model：

```ts
export interface ContextBadgeViewModel {
  kind: ContextBadgeKind;
  token: string;
  label: string;
  tooltip?: string;
  icon: ContextBadgeIcon;
  tone: ContextBadgeTone;
  clickable: boolean;
  removable: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}
```

建议 tone 保持克制：

```ts
export type ContextBadgeTone =
  | 'context'
  | 'tool'
  | 'inline'
  | 'attachment'
  | 'muted';
```

视觉区别主要依赖 icon 和轻量 tint，不为每种 kind 发明完全不同布局。

## 模块边界

建议新增或重组为：

```text
src/ui/shared/context-badge/
  ContextBadgeTypes.ts
  ContextBadgeModel.ts
  ContextBadgeRenderer.ts
  ContextBadgeDom.ts
  ContextBadgeParser.ts
  ContextBadgeActions.ts
  index.ts
```

职责：

- `ContextBadgeTypes.ts`：公共类型。
- `ContextBadgeModel.ts`：label、tooltip、icon、tone、disambiguation。
- `ContextBadgeRenderer.ts`：渲染单个 badge、badge strip、inline badge。
- `ContextBadgeDom.ts`：DOM helpers、contenteditable selection/remove handling。
- `ContextBadgeParser.ts`：把 message/composer text 解析为 `plain | badge` parts。
- `ContextBadgeActions.ts`：打开 vault path、打开 skill、展开 MCP 设置等 UI 行为的 thin adapter。

迁移后，旧模块应逐步变成兼容 wrapper，最终删除：

- `renderMentionBadges.ts`
- `inlineMentionBadgeDom.ts`
- `mentionBadgeTypes.ts`
- `mentionBadgeLabels.ts`
- `parseMessageMentions.ts`
- `FileChipsView.ts` 中的独立 chip DOM 逻辑

## UI 设计规范

### 统一 badge primitive

所有 badge 使用同一基础结构：

```html
<button class="pivi-context-badge pivi-context-badge--context">
  <span class="pivi-context-badge-icon"></span>
  <span class="pivi-context-badge-label"></span>
  <span class="pivi-context-badge-remove"></span>
</button>
```

contenteditable 内可以使用 `span[contenteditable=false]`，但内部 class 和尺寸仍与 button 版本一致。

### 尺寸

- height：约 20–22px。
- icon：12–14px。
- horizontal padding：6–8px。
- gap：4px。
- radius：使用 Obsidian `--radius-s` 或接近 pill 的统一值。
- label：单行、ellipsis、最大宽度按容器类型限制。

### 状态

- default：低对比 background + border。
- hover：轻微 background 提升。
- focus-visible：使用现有 accessibility outline 规则。
- disabled：仍可读，不可点击，opacity 不要过低。
- removable：右侧 `×` 或 close icon，hit target 比视觉区域略大。
- loading：只用于未来需要异步解析的 skill/context，不作为初始必需状态。

### 类型图标建议

| kind | icon |
| --- | --- |
| file | 根据扩展名选择 `file-text` / `image` / `file` |
| folder | `folder` |
| mcp | 现有 MCP icon |
| skill | `sparkles` |
| agent | `bot` |
| inline-context | `text-select` |
| attachment | 与 file 相同 |

## Slash command 的处理

Slash command 分成两类：

### CommandAction

纯命令，不变成 ContextBadge。例如：

- refine
- inline edit 快捷命令
- UI-only action

这些继续由 `SlashCommandDropdown` 管理，但 item 样式应该和 ContextBadge 的 icon/label/tone 对齐。

### ContextProducer

选择后会产生上下文 token。例如：

- skill
- folder context
- MCP server/tool
- future: diagnostics / branch diff / current selection

这些应在 confirm 后插入 `ContextBadgeToken`，composer 中显示 badge，发送时恢复为稳定 token 或 resolved context payload。

## Prompt 与 session 语义

ContextBadge 必须区分三个层次：

1. **Display token**：用户看到的 badge。
2. **Serialized token**：composer/session 中保存的稳定文本 token。
3. **Resolved payload**：发送给 Pi 的上下文内容或 prompt 片段。

建议规则：

- session history 保存用户可见消息文本和稳定 token，不保存临时 DOM state。
- restore 时从 serialized token 重新解析成 ContextBadge。
- Pi prompt 构建时由 runtime/prompt helper 解析 token，生成 context XML / MCP mention transform / skill prompt 注入。
- 不在 UI renderer 中拼 Pi prompt payload。

这符合当前“恢复完整对话、Pi 线性处理”的设计：ContextBadge 是消息内容的一部分，不是 session tree 节点。

## 迁移计划

### Phase 1：建立 ContextBadge 基础层

- 新增 `src/ui/shared/context-badge/`。
- 把现有 mention part 类型迁移/映射到 `ContextBadgeToken`。
- 集中实现 icon、label、tooltip、tone。
- 保持旧 API wrapper，避免一次性改所有调用点。

验收：

- 已发送消息中的 file/folder/MCP/skill/agent/inline context badge 外观不变或更统一。
- 测试覆盖 token -> view model、parser、renderer class。

### Phase 2：替换已发送消息与 composer inline badge

- `renderMentionBadges.ts` 改为调用 `ContextBadgeRenderer`。
- `inlineMentionBadgeDom.ts` 改为调用同一 renderer 的 inline mode。
- 删除重复的 `getFileIconName()`、skill/MCP label 逻辑。

验收：

- 发送消息后 badge 与 composer 内 badge 使用相同 label/icon/tooltip。
- contenteditable 的提取与删除行为保持稳定。

### Phase 3：迁移 file chip / attachment chip

- `FileChipsView` 不再手写 `.pivi-file-chip` DOM。
- attachment 作为 `ContextBadgeToken(kind: 'attachment')` 渲染。
- `.pivi-file-chip*` 样式变成兼容 alias 或删除。

验收：

- 附件 chip 与 mention badge 尺寸、hover、focus、remove 行为一致。
- 文件打开/删除行为不退化。

### Phase 4：slash command 与 ContextProducer 对齐

- `SlashCommandDropdown` 的 item view model 增加 `kind: 'action' | 'context-producer'`。
- skill 类 command confirm 后插入 `ContextBadgeToken(kind: 'skill')`。
- 纯 command 只执行命令或插入文本，不持久化为 badge。

验收：

- skill 在 composer 中以 badge 展示。
- `/` dropdown 视觉与 context badge 统一，但行为仍区分 command/action 与 context token。

### Phase 5：清理旧模块与样式

- 删除旧 mention badge label/icon helper。
- 删除或 alias 旧 CSS：`.pivi-file-chip`、`.pivi-inline-mention-badge`、`.pivi-mention-badge`。
- 更新 accessibility selector。
- 更新相关 tests。

验收：

- `rg "pivi-file-chip|pivi-inline-mention-badge|pivi-mention-badge" src tests` 只剩兼容 alias 或完全消失。
- `npm run typecheck && npm run lint && npm run test && npm run build` 通过。

## 测试策略

建议新增或调整测试：

- `ContextBadgeModel.test.ts`
  - file/folder/MCP/skill/agent/inline-context 的 label/icon/tooltip/tone。
  - 同名 file/skill 的 disambiguation。
- `ContextBadgeParser.test.ts`
  - 现有 raw mention token 兼容解析。
  - plain text 与 badge part 的顺序保持。
- `ContextBadgeRenderer.test.ts`
  - rendered class、title、aria-label、disabled/clickable/removable。
- composer tests
  - inline badge extract 回原 token。
  - remove badge 后 cursor 与 input event 正常。
- slash command tests
  - skill confirm 生成 ContextBadgeToken。
  - action command 不生成 ContextBadgeToken。
- regression tests
  - session restore 后 badge 可重新渲染。
  - sent message badge 和 composer badge label 一致。

## 风险与规避

### 风险：prompt payload 被 UI label 污染

规避：所有发送逻辑只读取 `token` 或 resolved payload，不读取 badge label。

### 风险：contenteditable selection 回归

规避：先把现有 `inlineMentionBadgeDom.ts` 的 selection/remove 逻辑迁入 `ContextBadgeDom.ts`，不要重写算法；迁移后补测试。

### 风险：slash command 语义混乱

规避：明确区分 `CommandAction` 和 `ContextProducer`，不要把所有 `/command` 都 badge 化。

### 风险：大改 CSS 影响消息布局

规避：先新增 `.pivi-context-badge`，旧 class alias 到新 class；最后再删除旧 class。

### 风险：package boundary 变差

规避：ContextBadge 第一阶段留在 `src/ui/shared/`；只有纯类型和稳定 token 语义成熟后，才考虑移动到 `@pivi/core`。

## 推荐实施顺序

1. 先提交当前 fork UX 修复，避免与 ContextBadge 大重构混在一起。
2. 单独 PR/commit 新增 ContextBadge 类型、model、parser，并让旧 renderer 通过 adapter 使用它。
3. 单独 PR/commit 迁移 sent message badge 与 inline composer badge。
4. 单独 PR/commit 迁移 file chips。
5. 单独 PR/commit 调整 slash skill/context producer。
6. 最后清理旧 class、旧 helper、旧 tests。

每一步都应保持可运行、可回滚，避免一次性把 parser、DOM、CSS、slash、session 全部打散。
