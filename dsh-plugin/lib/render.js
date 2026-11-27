/**
 * Seedream rendering for FORM.
 *
 * Provider order: Volcengine Ark (Seedream 4.0, primary) then OpenRouter
 * (Seedream 4.5, backup). A missing key is reported as NOT_CONFIGURED — this
 * module never substitutes a demo image.
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { randomUUID } from 'node:crypto';

export class RenderError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
    this.detail = detail;
  }
}

const DATA_URL_PNG = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i;

function nowId() {
  return `form-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

async function readSecrets(file) {
  try {
    const text = await readFile(file, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function readDshCredentials(home) {
  try {
    const text = await readFile(path.join(home, '.credentials.yaml'), 'utf8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+):\s*(\S+)\s*$/.exec(line);
      if (match) out[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

export function createRenderService({ config = {}, webRoot, dshHome }) {
  const generatedDir = path.join(webRoot, 'assets', 'generated');
  const secretsFile = config.secretsFile
    ? path.resolve(config.secretsFile)
    : path.resolve(webRoot, '..', '.form-secrets.json');
  const arkBaseUrl = (config.arkBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  const openrouterBaseUrl = (config.openrouterBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const arkModel = config.seedreamModel || 'doubao-seedream-5-0-pro-260628';
  const flashModel = config.seedreamFlashModel || 'doubao-seedream-5-0-flash-260915';
  const openrouterModel = config.openrouterModel || 'bytedance-seed/seedream-4.5';
  const timeoutMs = Number(config.requestTimeoutMs) > 0 ? Number(config.requestTimeoutMs) : 300_000;

  async function resolveKey(ref) {
    if (!ref) return '';
    if (process.env[ref]) return String(process.env[ref]).trim();
    const secrets = await readSecrets(secretsFile);
    const aliases = {
      ARK_API_KEY: ['arkApiKey', 'ARK_API_KEY'],
      OPENROUTER_API_KEY: ['openrouterApiKey', 'OPENROUTER_API_KEY'],
      DEEPSEEK_API_KEY: ['deepseekApiKey', 'DEEPSEEK_API_KEY'],
    };
    for (const key of aliases[ref] || []) {
      if (typeof secrets[key] === 'string' && secrets[key].trim()) return secrets[key].trim();
    }
    const dsh = await readDshCredentials(dshHome || process.env.DSH_HOME || '');
    if (dsh[ref]) return dsh[ref];
    return '';
  }

  async function status() {
    const [ark, openrouter] = await Promise.all([
      resolveKey(config.arkApiKeyRef || 'ARK_API_KEY'),
      resolveKey(config.openrouterApiKeyRef || 'OPENROUTER_API_KEY'),
    ]);
    return {
      configured: Boolean(ark),
      primary: ark ? 'ark' : null,
      providers: {
        ark: { configured: Boolean(ark), model: arkModel, flashModel },
        openrouter: { configured: Boolean(openrouter), model: openrouterModel },
      },
      secretsFile,
    };
  }

  function normalizeReference(referenceDataUrl) {
    if (typeof referenceDataUrl !== 'string' || !referenceDataUrl) return undefined;
    if (!DATA_URL_PNG.test(referenceDataUrl)) {
      throw new RenderError('INVALID_REFERENCE', '参考图必须是 data:image/png|jpeg|webp;base64 数据');
    }
    if (referenceDataUrl.length > 18_000_000) {
      throw new RenderError('INVALID_REFERENCE', '参考图超过 18MB 限制');
    }
    return referenceDataUrl;
  }

  function directLocalAddresses() {
    const found = [];
    for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
      if (/xray|tun|tap|loopback|vethernet|bluetooth/i.test(name)) continue;
      for (const address of addresses || []) {
        if (address.family !== 'IPv4' || address.internal) continue;
        if (address.address.startsWith('169.254.')) continue;
        if (!found.includes(address.address)) found.push(address.address);
      }
    }
    return found;
  }

  function directHttpsJson(url, body, headers) {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const request = https.request(
        {
          hostname: target.hostname,
          port: target.port || 443,
          path: `${target.pathname}${target.search}`,
          method: 'POST',
          headers,
          servername: target.hostname,
          family: 4,
          localAddress: directLocalAddresses()[0],
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            resolve({ status: response.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') });
          });
        },
      );
      request.setTimeout(Math.min(timeoutMs, 60_000), () => {
        request.destroy(new Error('direct TLS request timeout'));
      });
      request.on('error', reject);
      request.end(JSON.stringify(body));
    });
  }

  async function postJson(url, body, headers, label) {
    let status = 0;
    let text = '';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new RenderError('TIMEOUT', `${label} 请求超过 ${Math.round(timeoutMs / 1000)} 秒未完成`);
      }
      let fallback;
      let fallbackError = error;
      // A local VPN/TUN can steal the default route and reset Ark TLS. Retry the
      // same request on the physical LAN interface before reporting a network error.
      if (/(^|\.)volces\.com$/i.test(new URL(url).hostname) && directLocalAddresses().length) {
        try {
          fallback = await directHttpsJson(url, body, headers);
        } catch (directError) {
          fallbackError = directError;
        }
      }
      if (!fallback) {
        throw new RenderError(
          'NETWORK_ERROR',
          `${label} 连接失败：${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
      }
      status = fallback.status;
      text = fallback.text;
    }
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 800) };
    }
    if (status < 200 || status >= 300) {
      const detail = data?.error?.message || data?.message || data?.raw || `HTTP ${status}`;
      const errCode = data?.error?.code || data?.code || '';
      if (errCode === 'ModelNotOpen' || /not activated/i.test(String(detail))) {
        throw new RenderError(
          'MODEL_NOT_OPEN',
          `火山方舟账号尚未开通模型 ${body.model}：请到方舟控制台「开通管理」开通 Seedream 5.0 Pro，然后重新生成。`,
          detail,
        );
      }
      if (errCode === 'InvalidEndpointOrModel.NotFound') {
        throw new RenderError(
          'MODEL_NOT_FOUND',
          `火山方舟没有找到模型 ${body.model}，或当前账号无权访问；请在控制台确认模型 ID。`,
          detail,
        );
      }
      if (/overdue|balance|欠费|余额/i.test(String(detail))) {
        throw new RenderError(
          'BALANCE_DUE',
          '火山方舟账号余额不足或欠费：请到火山引擎费用中心充值/结清后再生成。',
          detail,
        );
      }
      const code = status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR';
      throw new RenderError(code, `${label} HTTP ${status}：${String(detail).slice(0, 500)}`);
    }
    return data;
  }
  async function persistImage(source, suggestedExt = 'png', meta = {}) {
    await mkdir(generatedDir, { recursive: true });
    const id = nowId();
    const fileName = `${id}.${suggestedExt}`;
    const target = path.join(generatedDir, fileName);
    let buffer;
    let mediaType = `image/${suggestedExt}`;
    if (typeof source === 'string' && source.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/s.exec(source);
      if (!match) throw new RenderError('BAD_RESPONSE', '模型返回了无法解析的图片数据');
      mediaType = match[1];
      buffer = Buffer.from(match[2], 'base64');
    } else if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
      const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new RenderError('DOWNLOAD_FAILED', `下载生成图片失败：HTTP ${response.status}`);
      mediaType = response.headers.get('content-type') || mediaType;
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      throw new RenderError('BAD_RESPONSE', '模型没有返回图片 URL 或数据');
    }
    const ext = mediaType.includes('jpeg') ? 'jpg' : mediaType.includes('webp') ? 'webp' : 'png';
    const finalName = `${id}.${ext}`;
    const finalTarget = path.join(generatedDir, finalName);
    await writeFile(finalTarget, buffer);
    const record = {
      id,
      file: finalName,
      url: `/form/assets/generated/${finalName}`,
      createdAt: new Date().toISOString(),
      bytes: buffer.length,
      mediaType,
      ...meta,
    };
    await writeFile(path.join(generatedDir, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  async function generateWithArk(apiKey, { prompt, reference, references = [], size, model = arkModel, meta = {} }) {
    const body = {
      model,
      prompt,
      response_format: 'url',
      size,
      watermark: false,
    };
    const images = [];
    if (reference) images.push(reference);
    for (const item of references) if (item) images.push(item);
    if (images.length) body.image = images;
    const data = await postJson(
      `${arkBaseUrl}/images/generations`,
      body,
      { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      '火山方舟 Seedream',
    );
    const item = Array.isArray(data.data) ? data.data[0] : undefined;
    const source = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined);
    if (!source) throw new RenderError('BAD_RESPONSE', '火山方舟响应中没有图片结果');
    return persistImage(source, 'png', {
      provider: 'volcengine-ark',
      model: data.model || model,
      prompt,
      size,
      referenceUsed: Boolean(reference || references.length),
      ...meta,
    });
  }

  async function generateWithOpenRouter(apiKey, { prompt, reference, references = [], meta = {} }) {
    const content = [{ type: 'text', text: prompt }];
    if (reference) content.push({ type: 'image_url', image_url: { url: reference } });
    for (const item of references) if (item) content.push({ type: 'image_url', image_url: { url: item } });
    const data = await postJson(
      `${openrouterBaseUrl}/chat/completions`,
      {
        model: openrouterModel,
        messages: [{ role: 'user', content }],
        modalities: ['image', 'text'],
        stream: false,
      },
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://127.0.0.1:52482/form/',
        'X-Title': 'FORM Studio',
      },
      'OpenRouter Seedream',
    );
    const images = data?.choices?.[0]?.message?.images;
    const source = Array.isArray(images) ? images[0]?.image_url?.url || images[0]?.image_url : undefined;
    if (!source) throw new RenderError('BAD_RESPONSE', 'OpenRouter 响应中没有图片结果');
    return persistImage(source, 'png', {
      provider: 'openrouter',
      model: data?.model || openrouterModel,
      prompt,
      size: 'auto',
      referenceUsed: Boolean(reference || references.length),
      ...meta,
    });
  }

  async function generate(request = {}) {
    const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (!prompt) throw new RenderError('INVALID_PROMPT', '提示词不能为空');
    if (prompt.length > 4000) throw new RenderError('INVALID_PROMPT', '提示词过长（最多 4000 字）');
    const extraReferences = Array.isArray(request.referenceDataUrls)
      ? request.referenceDataUrls.map(normalizeReference).filter(Boolean).slice(0, 4)
      : [];
    const reference = extraReferences.length ? undefined : (request.keepLayout === false ? undefined : normalizeReference(request.referenceDataUrl));
    const size = String(request.resolution || '').split(' ')[0];
    if (!['1K', '2K'].includes(size)) throw new RenderError('INVALID_SIZE', 'Seedream 5.0 支持 1K、2K');
    const requestedModel = typeof request.model === 'string' && request.model ? request.model : arkModel;
    if (![arkModel, flashModel].includes(requestedModel)) throw new RenderError('INVALID_MODEL', '不支持的 Seedream 模型');
    const ark = await resolveKey(config.arkApiKeyRef || 'ARK_API_KEY');
    // Only request an explicitly allowed Seedream model; never silently switch tiers.
    const openrouter = null;
    const failures = [];
    if (ark) {
      try {
        return await generateWithArk(ark, { prompt, reference, references: extraReferences, size, model: requestedModel, meta: request.meta });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        if (!openrouter) throw error;
      }
    }
    if (openrouter) {
      try {
        return await generateWithOpenRouter(openrouter, { prompt, reference, references: extraReferences, meta: request.meta });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        throw new RenderError('PROVIDER_FAILED', failures.join('；'), failures);
      }
    }
    throw new RenderError(
      'NOT_CONFIGURED',
      'Seedream 5.0 Pro 未配置：请设置火山方舟 ARK_API_KEY。',
    );
  }

  async function getDeepSeekKey() {
    return resolveKey(config.deepseekApiKeyRef || 'DEEPSEEK_API_KEY');
  }

  async function getSettings() {
    const [ark, openrouter, deepseek] = await Promise.all([
      resolveKey(config.arkApiKeyRef || 'ARK_API_KEY'),
      resolveKey(config.openrouterApiKeyRef || 'OPENROUTER_API_KEY'),
      resolveKey(config.deepseekApiKeyRef || 'DEEPSEEK_API_KEY'),
    ]);
    const mask = (value) => {
      if (!value) return '';
      if (value.length <= 8) return `${value.slice(0, 2)}••••`;
      return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
    };
    return {
      configured: Boolean(ark),
      model: arkModel,
      modelLabel: 'Doubao Seedream 5.0 Pro',
      hasArk: Boolean(ark),
      hasOpenRouter: Boolean(openrouter),
      arkKeyHint: mask(ark),
      openrouterKeyHint: mask(openrouter),
      hasDeepSeek: Boolean(deepseek),
      deepseekKeyHint: mask(deepseek),
      models: [
        {
          id: 'seedream-pro',
          name: 'Seedream 5.0 Pro',
          model: arkModel,
          provider: 'ark',
          providerLabel: '火山方舟',
          usage: '02 出图 / 03 精细降噪',
          keyRef: 'arkApiKey',
          keyLabel: '火山方舟 API Key',
          configured: Boolean(ark),
          required: true,
        },
        {
          id: 'seedream-flash',
          name: 'Seedream 5.0 Flash',
          model: flashModel,
          provider: 'ark',
          providerLabel: '火山方舟',
          usage: '03 3DGS 降噪 / 04 AI 漫游',
          keyRef: 'arkApiKey',
          keyLabel: '火山方舟 API Key',
          configured: Boolean(ark),
          required: true,
        },
        {
          id: 'seedream-openrouter',
          name: 'Seedream 4.5 备用',
          model: openrouterModel,
          provider: 'openrouter',
          providerLabel: 'OpenRouter',
          usage: '备用出图通道（当前未启用）',
          keyRef: 'openrouterApiKey',
          keyLabel: 'OpenRouter API Key',
          configured: Boolean(openrouter),
          required: false,
        },
      ],
      secretsFile,
    };
  }

  async function updateSettings(input = {}) {
    const secrets = await readSecrets(secretsFile);
    const ark = typeof input.arkApiKey === 'string' ? input.arkApiKey.trim() : '';
    const openrouter = typeof input.openrouterApiKey === 'string' ? input.openrouterApiKey.trim() : '';
    if (ark) {
      if (ark.length < 8 || ark.length > 512) throw new RenderError('INVALID_KEY', '火山方舟 API Key 长度不正确');
      secrets.arkApiKey = ark;
    }
    if (openrouter) {
      if (openrouter.length < 8 || openrouter.length > 512) throw new RenderError('INVALID_KEY', 'OpenRouter API Key 长度不正确');
      secrets.openrouterApiKey = openrouter;
    }
    const deepseek = typeof input.deepseekApiKey === 'string' ? input.deepseekApiKey.trim() : '';
    if (deepseek) {
      if (deepseek.length < 8 || deepseek.length > 512) throw new RenderError('INVALID_KEY', 'DeepSeek API Key 长度不正确');
      secrets.deepseekApiKey = deepseek;
    }
    await mkdir(path.dirname(secretsFile), { recursive: true });
    await writeFile(secretsFile, `${JSON.stringify(secrets, null, 2)}\n`, 'utf8');
    return getSettings();
  }
  async function deleteRender(id) {
    if (!/^form-[a-z0-9-]+$/.test(id)) throw new RenderError('INVALID_ID', '效果图 ID 无效');
    const recordPath = path.join(generatedDir, `${id}.json`);
    let record = null;
    try { record = JSON.parse(await readFile(recordPath, 'utf8')); } catch { return { ok: true, deleted: false }; }
    const files = new Set([record.file]);
    for (const asset of record.decomposition?.assets || []) files.add(asset.file);
    for (const file of files) {
      if (!file) continue;
      const safe = path.basename(String(file));
      if (!safe || safe === '.' || safe === '..') continue;
      await unlink(path.join(generatedDir, safe)).catch(() => {});
    }
    await unlink(recordPath).catch(() => {});
    return { ok: true, deleted: true, id };
  }
  return {
    status,
    getSettings,
    updateSettings,
    generate,
    deleteRender,
    generatedDir,
    getDeepSeekKey,
    arkModel,
    flashModel,
    openrouterModel,
    secretsFile,
  };
}
