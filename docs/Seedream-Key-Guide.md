# Seedream Key 申请与配置指南（火山方舟）

本指南对应 FORM 的 Seedream 出图通道。目标：拿到火山方舟 API Key，并让 <http://127.0.0.1:52482/form/> 显示“Seedream 已连接 · 火山方舟”。

> Key 只写进本机文件或系统环境变量，**不要发到聊天、不要提交到 git**。真实出图按张计费，首次测试用 2K。

## 0. 准备

- 火山引擎账号（手机号/邮箱注册）。
- 实名认证：个人身份证或企业执照。未实名通常无法开通方舟模型。
- 可支付方式（如需付费）；新用户可能有赠送额度，以控制台实时显示为准。

## 1. 注册 / 登录

<https://www.volcengine.com/> → 右上角「登录 / 注册」。

如果还没有账号，按下面做（电脑浏览器，不要用微信内置浏览器）：

1. 打开 <https://www.volcengine.com/>。
2. 右上角点「登录」，弹窗底部点「注册 / 立即注册」。
3. 选择「手机号注册」，国家区号选中国大陆 `+86`，填手机号。
4. 点「获取验证码」，填短信验证码。
5. 设置密码（一般 8-20 位，字母+数字，部分页面要求符号），勾选协议。
6. 点「注册」，然后用手机号+密码登录。
7. 登录后右上角头像 →「账号中心」→「实名认证」，选个人，填姓名+身份证号，按提示做人脸/银行卡验证。

常见问题：

- 收不到验证码：确认手机号、等 60 秒重试、换 Edge/Chrome、关闭广告拦截。
- 密码总是不合格：用 10 位以上，含大小写字母+数字+符号。
- 实名失败：换「银行卡验证」或提交人工审核；姓名/身份证号必须完全一致。
- 页面提示账号风险/需要企业认证：联系火山引擎客服，或改用 OpenRouter 备选。

## 2. 实名认证

控制台右上角账号菜单 →「账号中心」→「实名认证」。

- 个人：身份证 + 人脸/银行卡验证。
- 企业：营业执照 + 对公打款或法人验证。

认证通过后再继续。

## 3. 进入火山方舟

<https://console.volcengine.com/ark/region:cn-beijing/overview>

或在火山引擎控制台顶部搜索「火山方舟」。左侧菜单应有「模型广场」「开通管理」「API Key 管理」。

## 4. 开通 Seedream 5.0 Flash

1. 左侧「模型广场」：<https://console.volcengine.com/ark/region:cn-beijing/model>
2. 搜索 `Seedream 5.0 Flash` / `Doubao-Seedream`。
3. 打开 [Seedream 5.0 Flash 模型页](https://console.volcengine.com/ark/region:cn-beijing/model/detail?name=doubao-seedream-5-0-flash)。
4. 点「开通服务 / 立即开通」，计费方式选按量付费，确认。
5. 回到「开通管理」，确认 `doubao-seedream-5-0-flash-260915` 显示已开通。

如果显示“安心体验模式”，通常表示先消耗赠送额度；额度用完需要充值或开通付费。

> 报错 `MODEL_NOT_OPEN` / “account ... has not activated the model ...” 表示 Key 有效，但账号还没开通这个模型；完成本步后直接重新生成即可，不需要换 Key。

## 5. 创建 API Key

1. 左侧「API Key 管理」，直达：<https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey>
2. 「创建 API Key」，名称例如 `form-studio`。
3. 复制 `sk-` 开头的完整 Key（通常只完整显示一次）。
4. 没有创建按钮/无权限：用主账号，或给子账号授予方舟 `ArkFullAccess`。

## 6. 先在线验证（推荐）

方舟控制台「在线体验 / 体验中心」→ 选 Seedream 4.0 → 生成一张测试图。

- 成功：实名、开通、额度都正常。
- 失败：按页面提示先解决（未实名 / 未开通 / 欠费 / 限流），再继续。

## 7. 写入本机

在 `<FORM_ROOT>`：

1. 复制 `.form-secrets.example.json`。
2. 重命名为 `.form-secrets.json`。
3. 用记事本打开，填写：

```json
{
  "arkApiKey": "sk-完整Key",
  "openrouterApiKey": ""
}
```

4. 保存为 UTF-8。

也可以用系统环境变量 `ARK_API_KEY`（用户级即可）；环境变量优先于文件。插件还会读取 `%USERPROFILE%\.dsh\.credentials.yaml` 中同名条目。

## 8. 重启 FORM 服务

服务已运行时，直接点 `start-form.cmd` 不会重新读 Key，需要先停止：

```powershell
cd "<FORM_ROOT>"
powershell -ExecutionPolicy Bypass -File .\stop-form.ps1
.\start-form.cmd
```

或使用新加的 `restart-form.cmd`。

重启后页面右上角应显示：

- `已连接 DSH · Seedream · Ark`
- 出图页横幅：`Seedream 已连接 · 火山方舟`

然后进入「02 视角与出图」→ 填提示词 →「生成效果图」（先选 2K）。

## 9. 常见卡点

| 提示 | 处理 |
|---|---|
| 未实名 / 无权限 | 完成实名，或用主账号 |
| 模型未开通 / `MODEL_NOT_OPEN` | 到「开通管理」开通 Seedream 5.0 Flash，不用换 Key |
| 余额不足 / 欠费 | 费用中心充值，或先用赠送额度 |
| `API key format is incorrect` | Key 复制不全/错误，重新创建 |
| `AccessDenied` | 子账号缺 `ArkFullAccess` |
| `RateLimitExceeded` | 稍后重试或检查限流 |
| 页面仍显示未配置 | 检查文件名是否为 `.form-secrets.json`、JSON 是否合法、是否重启服务 |

## 10. 备选：OpenRouter

如果 Ark 暂时不可用：

1. 登录 <https://openrouter.ai>，在 <https://openrouter.ai/credits> 充值。
2. <https://openrouter.ai/keys> → Create Key。
3. 写入 `.form-secrets.json` 的 `openrouterApiKey`，或设置 `OPENROUTER_API_KEY`。
4. 重启服务；Ark 失败时会自动尝试 OpenRouter，页面显示实际 provider。

## 官方链接

- [火山方舟控制台](https://console.volcengine.com/ark)
- [获取 API Key 并配置](https://console.volcengine.com/ark/region:cn-beijing/docs/api-key)
- [图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-api)
- [API Key 管理直达](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)
