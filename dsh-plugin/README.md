# FORM 方构空间工作台 · DSH 插件

把 `block-studio` 工作台接入 DeepSeek Harness：组件 Agent 变成真实 DSH Agent 会话，出图交给 Seedream。原页面里“组件 Agent 本地模板模拟”和“演示出图”两条路径被替换为真实接口；服务不可达时自动回到原来的离线模拟，并在界面明确标注。

## 目录

- 插件包：`<FORM_ROOT>\dsh-plugin`
- 前端页面：`<FORM_ROOT>`（插件通过 `/form/` 托管）
- DSH profile：`%USERPROFILE%\.dsh\profiles\form`
- 启动脚本：`<FORM_ROOT>\start-form.cmd` / `start-form.ps1`
- 停止脚本：`<FORM_ROOT>\stop-form.ps1`
- 重启脚本：`<FORM_ROOT>\restart-form.cmd`（改 Key 后必须重启才生效）
- 状态诊断：`<FORM_ROOT>\check-form.ps1`（不读取 Key 内容）
- Key 配置向导：`<FORM_ROOT>\configure-ark-key.ps1`（输入不回显）
- 申请指南：`<FORM_ROOT>\docs\Seedream-Key-Guide.md`
- 提示词方案：`<FORM_ROOT>\docs\Prompt-Scheme.md`
- 同步脚本：`<FORM_ROOT>\sync-form-plugin.ps1`（改完插件代码后复制到 profile 并重启）
- 页面地址：<http://127.0.0.1:52482/form/>

独立 profile 使用端口 **52482**，与当前 GUI 的 `52481`、旧预览服务的 `4173` 不冲突。

## 已实现

### 1. 组件 Agent（真实 DSH Agent）

- 每个 FORM 对话对应一个真实 DSH Agent 会话，模型 `deepseek-official / deepseek-flash`。
- 会话按 FORM 的 `conversationId` 持久化到 `%USERPROFILE%\.dsh\sessions\--G-sp~0020ai-block-studio--\<session-id>\`，插件重启后可恢复继续聊。
- Agent 挂载一个 `form_component_create` 工具：模型只负责理解 `kind / 宽 / 深 / 高 / 颜色`，体块几何由插件确定性地生成并校验，避免模型编造无效坐标。
- 支持 `shelf / sofa / table / window / door / planter / plant / rug / cabinet / bed / chair / desk / light`。
- 生成结果可在原 Agent 窗口预览、加入组件库、直接放置、继续编辑；与原有重叠标红/落地/撤销逻辑一致。
- 多轮对话：同一 `conversationId` 继续发送即可；插件重启后会通过 `ctx.agents.resume()` 恢复。

### 2. 出图（Seedream）

- 主通道：火山方舟 Ark，`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`。当前 profile 配置模型为 `doubao-seedream-5-0-flash-260915`；代码未显式配置时默认 `doubao-seedream-4-0-250828`。
- 备选：OpenRouter，`POST https://openrouter.ai/api/v1/chat/completions`，默认模型 `bytedance-seed/seedream-4.5`。
- 默认 2K，可选 4K；`response_format: url`，`watermark: false`。
- 勾选“保持空间布局”时，把当前机位体块预览的 PNG 作为参考图随提示词提交（图生图）；不勾选则纯文生图。
- 结果图片与参数 JSON 保存到 `assets/generated/`，服务端保留历史，页面 localStorage 也记录出图历史。
- **风格锁定**：固定效果图后再生成新机位，前端把固定图转成第二张参考图（`styleReferenceDataUrl`）并发送双图：image 1 = 新机位体块，image 2 = 已批准风格；提示词要求只换角度，材质/颜色/光线/陈设匹配固定图。
- **地面 Agent**：结构栏“地面设置”独立窗口；DSH deepseek-flash 通过 `form_floor_generate` 返回材质/颜色/厚度，前端应用到地面；Agent 不可用时回退本地近似。
- **提示词分层**：内置正向规则（英文）+ 实时场景简报（英文，逐个物体列出位置/尺寸/颜色/相机相对方向）+ 用户描述（保留中文）+ 内置负面/额外负面。火山方舟图片 API 没有独立 `negative_prompt` 字段，负面词合并进最终 `prompt` 的 `AVOID:` 段，不伪造参数。
- **参考图定位**：内置规则明确说明参考图只用于机位、位置、比例和基础颜色，不要复制方块/体素/像素/网格风格。
- **场景简报**：生成时从 `state.objects` 实时计算，1 格 = 0.5m，用现有包围盒/旋转/缩放数据，逐个列出每个模型对象；墙体方块也会逐个列出（按确认要求）。
- **长度预算**：Seedream 提示词上限 4000 字符；场景简报使用 `id|type|size|center|color|side|depth` 紧凑格式，当前初始场景最终 prompt 约 3914 字符。超限返回 `PROMPT_TOO_LONG`，需缩短用户描述/负面词或减少物体。
- **允许人物**：出图页新增勾选；未勾选时内置负面包含 people/human figures/crowd，勾选后移除并加入“人物可出现但不喧宾夺主”的说明。
- **提示词预览**：`查看最终提示词` 只拼装、不调用 Seedream，不产生费用；内置规则只读展示。
- **没有密钥时不会生成任何替代图**：接口返回 `NOT_CONFIGURED`，页面显示“Seedream 未配置”遮罩与提示。

## 配置密钥

复制 `<FORM_ROOT>\.form-secrets.example.json` 为 `<FORM_ROOT>\.form-secrets.json`，填入至少一个：

```json
{
  "arkApiKey": "你的火山方舟 API Key",
  "openrouterApiKey": "可选的 OpenRouter API Key"
}
```

也支持系统环境变量 `ARK_API_KEY` / `OPENROUTER_API_KEY`（优先级高于文件）。插件还会尝试读取 `%USERPROFILE%\.dsh\.credentials.yaml` 中同名条目。

### 怎么获取火山方舟 Key（主通道）

1. 打开 <https://console.volcengine.com/ark>，登录并完成实名认证。
2. 进入「模型广场」，搜索 `Doubao-Seedream`，打开 [Seedream 5.0 Flash 模型页](https://console.volcengine.com/ark/region:cn-beijing/model/detail?name=doubao-seedream-5-0-flash)，点「开通服务」。按张计费，先看价格/免费额度，建议设置预算告警。
3. 左侧「API Key 管理」→「创建 API Key」，复制保存（通常只显示一次）。
4. 在模型详情页复制模型 ID：当前使用 `doubao-seedream-5-0-flash-260915`（Seedream 5.0 Flash）；4.0 为 `doubao-seedream-4-0-250828`，4.5 为 `doubao-seedream-4-5-251128`（以控制台为准）。
5. 写入 `.form-secrets.json`，或设置系统环境变量 `ARK_API_KEY`。
6. 重启 FORM 服务（`stop-form.ps1` 后 `start-form.ps1`），页面右上角应显示“Seedream 已连接 · 火山方舟”。
7. 若报 `MODEL_NOT_OPEN` / “尚未开通模型”，说明 Key 有效但账号未开通该模型：到方舟控制台「开通管理」开通 Seedream 5.0 Flash，然后重新生成；不需要换 Key。

官方参考：[API Key 与配置](https://ark.volcengine.com/region:cn-beijing/docs/api-key)、[图片生成 API](https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api)。

### 怎么获取 OpenRouter Key（备选）

1. 登录 <https://openrouter.ai>，在 <https://openrouter.ai/credits> 充值。
2. 打开 <https://openrouter.ai/keys> → Create Key，复制 `sk-or-v1-...`。
3. 写入 `.form-secrets.json` 的 `openrouterApiKey`，或设置 `OPENROUTER_API_KEY`。
4. 重启服务。Ark 请求失败时会自动尝试 OpenRouter；页面会显示实际使用的 provider。

> 费用由对应平台按实际调用计费，本项目不代管额度。真实出图会产生费用。

## 安装 / 升级

已安装到 profile `form`，依赖与 bundles 位于 `%USERPROFILE%\.dsh\profiles\form\package.json`：

```json
{
  "dependencies": { "dsh-form-studio": "file:<FORM_ROOT>/dsh-plugin" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-form-studio"] } }
}
```

首次安装或换机器：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& "D:\Users\ASUS\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" --expose-internals `
  "D:\Users\ASUS\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile form add "file:<FORM_ROOT>\dsh-plugin"
```

然后把 `dsh-form-studio` 加入 profile 的 `dsh.profile.bundles`（已配置过则跳过），重启服务。

插件代码改动后需要：

```powershell
<FORM_ROOT>\sync-form-plugin.ps1
```

它会复制 `lib/*.js` 与 `cordis.patch.yml` 到 profile 并重启服务。pnpm 的 `file:` 安装是硬链接/复制，不会自动跟随源码修改。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/form/api/health` | 服务、Agent 模型、Seedream provider 配置状态 |
| POST | `/form/api/agent` | `{ conversationId?, message, skill }` → 回复 + 结构化组件 |
| POST | `/form/api/floor/agent` | `{ conversationId?, message }` → 回复 + 地面材质/颜色/厚度 |
| POST | `/form/api/prompt/preview` | `{ prompt, negativePrompt, sceneBrief, allowPeople }` → 最终提示词，不生成图 |
| POST | `/form/api/render` | `{ prompt, negativePrompt, sceneBrief, allowPeople, resolution, referenceDataUrl?, styleReferenceDataUrl?, styleReference, hasReferenceImage, keepLayout, cameraId }` → 图片记录 + finalPrompt |
| GET | `/form/api/render/history?cameraId=` | 服务端出图历史（JSON sidecar） |
| GET | `/form/` | 工作台页面 |
| GET | `/form/assets/generated/<file>` | 生成的图片 |

`/form/api/agent` 成功返回：

```json
{
  "ok": true,
  "conversationId": "form-...",
  "sessionId": "form-...",
  "reply": "已生成「浅木色书架」……",
  "component": { "type": "custom", "sx": 3.6, "sy": 0.8, "...": "..." },
  "model": "deepseek-flash"
}
```

`/form/api/floor/agent` 成功返回：

```json
{
  "ok": true,
  "conversationId": "form-floor-...",
  "reply": "已生成地面材质：浅橡木地板……",
  "floor": { "material": "浅橡木地板", "color": "#c9a876", "thicknessMm": 150, "pattern": "直纹、哑光" },
  "model": "deepseek-flash"
}
```

`/form/api/render` 成功返回：

```json
{
  "ok": true,
  "id": "form-...",
  "url": "/form/assets/generated/form-....png",
  "provider": "volcengine-ark",
  "model": "doubao-seedream-4-0-250828",
  "size": "2K",
  "referenceUsed": true,
  "createdAt": "..."
}
```

错误统一为 `{ ok:false, code, message }`，例如 `NOT_CONFIGURED`、`INVALID_PROMPT`、`TIMEOUT`、`AUTH`、`RATE_LIMITED`。

## 历史与数据

| 数据 | 位置 | 说明 |
|---|---|---|
| 场景/机位/提示词/预设 | 浏览器 localStorage（`http://127.0.0.1:52482`） | 与旧 `file://` 不同源；页面提供“导入项目 JSON”迁移 |
| 组件 Agent 会话 | `%USERPROFILE%\.dsh\sessions\--G-sp~0020ai-block-studio--\` | DSH 真实会话，zstd JSONL，可恢复 |
| 出图图片/参数 | `assets/generated/` | 服务端保存，页面重启后仍可访问 |
| 出图历史引用 | 浏览器 localStorage + 服务端 sidecar | 页面显示缩略图，服务端保留记录 |
| FORM 进程的 workspace/settings 存储 | `%USERPROFILE%\.dsh\storages-form` | 与 desktop GUI 的 `storages` 隔离，避免两个进程争写 JSON |

## 验证

```powershell
# 健康检查
Invoke-RestMethod http://127.0.0.1:52482/form/api/health

# 真实组件 Agent（会调用 deepseek-flash）
curl.exe -sS -X POST http://127.0.0.1:52482/form/api/agent `
  -H "Content-Type: application/json" `
  --data-binary "@$env:TEMP\agent-body.json"

# 真实出图（配置 Key 后；会产生费用）
curl.exe -sS -X POST http://127.0.0.1:52482/form/api/render `
  -H "Content-Type: application/json" `
  --data-binary "@$env:TEMP\render-body.json"
```

开发回归脚本（不消耗真实 Seedream 额度）：

- `test/mock-ark.cjs`：本地模拟 Ark / OpenRouter 响应，含请求记录与 `MOCK_ARK_FAIL=1` 失败注入。
- `test/cdp-agent.cjs`：用 headless Edge 的 CDP 驱动 Agent 窗口并截图。
- `test/cdp-render.cjs`：驱动出图页并验证成功/未配置状态。
- `test/cdp-add.cjs`：验证“加入组件库 / 点击放置”状态。
- `test/cdp-camera-delete.cjs`：验证机位删除、最后一个机位保护、撤销、出图页删除。
- `test/cdp-add-camera.cjs`：验证“添加当前视角”进入取景并取消。
- `test/cdp-library-delete.cjs`：验证组件库删除。
- `test/cdp-library-pending.cjs`：验证删除待放置组件时取消放置。
- `test/cdp-prompt-preview.cjs`：验证内置提示词 chips、最终提示词预览、56 个物体逐个列出。
- `test/cdp-prompt-ui.cjs`：验证负面提示词行与最终提示词弹窗布局。
- `test/cdp-site.cjs`：验证场地宽深修改、地板/边界/相机适配、家具不缩放、一键清空与撤销。
- `test/cdp-wall-drag.cjs`：验证墙体拖动、长度向上取整、预览与碰撞校验。
- `test/cdp-wall-polar.cjs`：验证墙体拖动方向的 30° 极轴吸附。
- `test/cdp-window.cjs`：验证窗户只能放垂直墙面、自动吸附、窗台/窗高、墙体挖洞。
- `test/cdp-window-delete.cjs`：验证删除窗户后墙体恢复、地面放置被拒绝。
- `test/cdp-window-rotated.cjs`：验证窗户在 30° 旋转墙体上的吸附与挖洞。
- `test/cdp-window-move.cjs`：验证窗户沿墙水平/垂直移动、墙洞跟随、离墙/旋转被限制。
- `test/cdp-window-gizmo.cjs`：验证通过 3D 变换手柄实际拖动窗户时墙洞跟随。
- `test/cdp-window-initial.cjs`：验证初始场景窗户也能沿墙移动。
- `test/cdp-overlap-orbit.cjs`：验证重叠放置、红色高亮、中键点击点旋转与 ±4° 旋转吸附。
- `test/cdp-floor-orbit.cjs`：验证地面设置窗口、地面 Agent、SketchUp 式中键定点旋转。
- `test/cdp-pinned-result.cjs`：验证固定效果图、切换机位仍保留、取消固定。
- `test/cdp-style-pin.cjs`：验证固定图转成第二张风格参考、双图请求体和风格提示词。
- `test/style-render-test.mjs`：用 mock Ark 验证一次请求发送两张参考图。
- `test/cdp-reload.cjs`：验证窗户/墙洞保存后刷新仍恢复。

## 已知限制

- 组件是**体块近似模型**，不是工程精度建模；生成后仍受地面/边界约束，组件间允许重叠并标红。
- `form_component_create` 只负责生成组件，不负责把它放进场景；放置仍由用户在工作台完成。
- Seedream 同步接口耗时取决于方舟网关，插件请求超时默认 300 秒、页面等待 320 秒；4K 或复杂参考图可能更慢。
- Ark 与 OpenRouter 的模型 ID/可用画幅会变化，以平台控制台为准；可通过插件 `config` 覆盖 `seedreamModel` / `openrouterModel`。
- 服务只监听 `127.0.0.1`，没有额外登录鉴权；不要绑定到公网。
- 独立 profile 与当前 desktop GUI 共用 `%USERPROFILE%\.dsh`，但 FORM Agent 会话属于 form 进程；是否出现在 desktop 侧栏取决于 workspace 收录规则。
- 插件升级后需同步 `lib` 并重启服务；pnpm `file:` 依赖不会自动热更新。

## 故障排查

1. 页面右上角“FORM 服务未连接”：运行 `start-form.ps1`，检查 52482 是否被占用。
2. “Seedream 未配置”：检查 `<FORM_ROOT>\.form-secrets.json` 或 `ARK_API_KEY`，重启服务。
3. 出图 401：Key 无效或未开通 Seedream 模型；到方舟控制台确认。
4. `MODEL_NOT_OPEN` / “尚未开通模型”：Key 有效但账号未开通 `doubao-seedream-5-0-flash-260915`；到方舟控制台「开通管理」开通后重新生成，不用换 Key。
4. 出图 429：限流/额度；稍后重试或检查账户额度。
5. Agent 超时：换短描述重试；检查 DeepSeek 凭据（DSH Models 配置）。
6. 页面仍显示旧资源：浏览器强刷（Ctrl+F5），插件静态文件为 `no-cache`。
