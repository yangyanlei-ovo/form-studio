# FORM · Seedream 提示词方案（已确认并实现）

日期：2026-11-05
状态：已实现；Seedream 账号欠费，等待真实出图验证。

## 目标

- 参考图只做**机位、位置、比例、基础颜色**参考，不让 Seedream 复制方块/体素/像素块风格。
- 内置提示词主动增加**精致度**：材质细节、木纹/布纹/石材、金属五金、玻璃反射、自然光+实用光、环境光遮蔽、软阴影、少量陈设，而不是只生成空房间。
- 告诉 Seedream **每个物体是什么、在什么位置、和相机的关系**，由工作台实时计算，而不是让模型猜。
- 用户描述仍然控制风格/氛围/材质/颜色；内置规则只控制细节与真实度，不锁死风格。
- 负面提示词单独一行；内置负面锁定，用户可追加。
- 除用户输入保留中文外，内置规则、场景简报、负面词用英文。
- “允许人物”作为选项，默认不出现人物。

## 最终 prompt 结构

```text
[内置正向规则 - 英文，只读]
[REFERENCE IMAGE ROLE - 英文，只读]
[SCENE BRIEF - 英文，实时计算，只读]
[USER REQUEST - 用户输入，保留中文]
[PEOPLE - 勾选“允许人物”时出现]
[AVOID - 内置负面 + 用户追加负面]
```

## 固定风格模式（固定效果图后）

固定一张效果图后，新机位生成会发送两张参考图：

- **image 1**：新机位的体块预览，决定相机、几何、物体位置/尺寸；
- **image 2**：固定效果图，只提供材质、颜色、光线、陈设和精致度；
- 提示词要求“只更换相机角度，保持风格一致”，并明确不要复制 image 2 的机位/构图。

内置正向会切换为：

```text
Photorealistic high-end interior photograph, fully resolved. Image 1 is the new camera/layout blockout; image 2 is the approved style reference. Use image 1 and the scene brief for camera, geometry, object positions and scale; match image 2's materials, colors, lighting, decor and detail level. Change only the camera angle; keep the style consistent. Do not copy image 2's framing or block/pixel style. User request may adjust details; do not add, remove or move major furniture.
```

固定风格模式最终 prompt 约 **3422 字符**（初始场景，56 个对象行），低于 4000 上限。若关闭“使用机位参考图”，则只发送固定图作为风格参考，场景几何由 prompt 描述。

火山方舟图片生成 API 没有独立 `negative_prompt` 字段，所以负面词合并进 `prompt` 的 `AVOID:` 段；请求体不会伪造不支持的参数。

## 内置正向规则（英文，只读）

```text
Photorealistic high-end architectural interior photograph, magazine quality, fully resolved. Attached image: massing reference for camera, placement, proportions and base colors only. Do NOT copy its blocks, voxels, pixels, grid, wireframe or low-poly style. Keep every described major object's position, count and scale; enrich materials, lighting and restrained styling without changing the layout. Show believable material depth: wood grain and joinery, fabric weave and seams, stone veining, metal hardware, glass reflections, matte/gloss contrast, micro-texture. Use layered daylight and practical light, global illumination, contact shadows, ambient occlusion, straight verticals and realistic perspective. Add small props only: artwork, books, ceramics, plants, textiles, ceiling/wall details, outdoor context. User request controls style, mood, materials and color; reduce styling for minimal/empty requests. Do not move major furniture; do not force a specific style.

REFERENCE IMAGE ROLE: it is a layout/color reference only. Do not copy its block or pixel style.
```

## 实时场景简报（英文，逐个列出，紧凑格式）

生成时从当前 `state.objects` 计算：

- 1 格 = 0.5m；
- 使用现有 `boundsOf()` / `colliderParts()` 得到旋转、缩放后的实际包围盒；
- 每个对象一行，家具格式：`id|type|size|center|color|screen|depth`；
- 墙体/地板/窗等结构体在超长压缩时改为：`id|type|size|center`（基础颜色和朝向由参考图提供），保证仍然逐个列出；
- 墙体方块也逐个列出（按用户确认要求）；
- custom 组件使用 Agent 生成的名字、尺寸、颜色、parts 数量；
- 相机行包含 eye、target、投影类型、yaw、pitch；
- Seedream 侧上限 4000 字符，因此每行使用缩写和紧凑数字（`.17` 而不是 `0.17`），不再重复距离/长句。

示例：

```text
Scene in meters (1 grid=0.5m). One line per object: id|type|size wxd xh|center x,y,z|color|screen L/C/R|depth N/M/F/B.
L=left C=center R=right; N=near M=mid F=far B=behind camera.
Room 7.0x6.0m, floor at Z=0.
Camera: eye 8.68,-5.62,3.58; target 3.5,3,.8; perspective; yaw -59; pitch 15.
Objects (56):
01|floor|7x6x.14|3.5,3,-.07|warm-beige|C|F
02|block|.17x.5x2.8|.09,.25,1.4|cream-white|L|F
...
```

当前初始场景：56 行、最终 prompt 约 **3924 字符**，低于 4000 上限；内置精致度规则保留，结构体行在超长时自动压缩为四列。用户描述或额外负面更长时可能超限，服务端会返回 `PROMPT_TOO_LONG`，需要缩短描述/负面词或减少物体。

## 内置负面词（英文，只读）

```text
pixel art, voxel blocks, Minecraft, low-poly cubes, visible grid,
wireframe, blueprint, schematic, text, watermark, logo, UI,
duplicate furniture, floating objects, clipping, wrong perspective,
fisheye, cartoon, illustration, oversaturation, noise,
flat lighting, empty room, sparse styling, low detail,
CGI, plastic, waxy, people, crowds
```

勾选“允许人物”后，`people / crowds` 从负面列表移除，并加入：

```text
PEOPLE: people may appear naturally if the scene calls for them, but they must stay secondary to the interior.
```

## UI

- 出图页新增“负面提示词”行：内置负面 chips（只读）+ 额外负面输入框；按机位保存。
- “使用机位参考图（仅位置/颜色）”替代原来的“保持空间布局”。
- 新增“允许人物”复选框，默认不勾选。
- “查看最终提示词”只拼装、不调用 Seedream，不产生费用；弹窗显示完整内容。
- “内置提示词（只读）”折叠区显示内置规则。

## 后端

- `lib/prompts.js`：内置正向/负面、`composePrompt()`、4000 字符上限与超限压缩。
- `POST /form/api/prompt/preview`：只拼装提示词。
- `POST /form/api/render`：接收 `prompt / negativePrompt / sceneBrief / allowPeople`，服务端拼装最终 prompt，传给 Seedream；sidecar 保存用户原文、负面词、场景简报、最终 prompt、promptVersion。
- 页面 `form-bridge.js` 实时生成场景简报并提交；历史记录保存负面词/允许人物/finalPrompt。

## 待验证

Seedream 5.0 Flash 目前已开通但账号欠费；结清后需要验证：

1. 3924 字符的最终 prompt 是否被 Seedream 5.0 Flash 接受（当前低于 4000 上限）；
2. 参考图是否不再被渲染成像素块/体素；
3. 逐个物体描述是否真的改善位置关系；
4. 负面词合并进 prompt 的实际效果（火山方舟无独立 negative 参数）；
5. 允许人物开关的差异。
