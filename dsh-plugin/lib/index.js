/**
 * FORM 方构空间工作台 — DSH host plugin.
 *
 * Serves the existing block-studio page at /form/ and turns its two simulated
 * capabilities into real ones:
 *
 *   POST /form/api/agent   a real DSH Agent session (deepseek-flash) with a
 *                          scoped form_component_create tool
 *   POST /form/api/render  Seedream via Volcengine Ark (primary) or OpenRouter
 *
 * The agent geometry is built deterministically in lib/components.js, so a
 * model reply can never produce an invalid component.
 */

import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { buildComponent, summarize, SUPPORTED_KINDS } from './components.js';
import { RenderError, createRenderService } from './render.js';
import { createSharpService } from './sharp.js';
import { createRoamService } from './roam.js';
import { BUILTIN_NEGATIVE, BUILTIN_POSITIVE, PROMPT_VERSION, composePrompt } from './prompts.js';

export const name = 'form-studio';
export const inject = ['webServer', 'agents', 'llm'];

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(PLUGIN_DIR, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const MAX_AGENT_BODY = 1_000_000;
const MAX_RENDER_BODY = 24_000_000;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`请求体超过 ${Math.round(limit / 1024 / 1024)}MB 限制`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const text = await readBody(req, limit);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function createUserMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(text) }],
    source: { kind: 'user' },
  };
}

function assistantText(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

function systemPrompt() {
  return [
    '你是 FORM 方构空间工作台的组件设计 Agent。用户会用中文描述一个室内空间组件，你负责把它变成可放置、可碰撞检测的体块组件。',
    '',
    '工作方式：',
    '1. 用户描述一个组件时，必须调用 form_component_create 工具一次。尺寸一律使用毫米；颜色使用 #rrggbb。',
    '2. 工具会返回经过校验的组件和摘要。不要自己编造体块坐标或 JSON；以工具结果为准。',
    '3. 调用工具后，用中文简短回复：组件名称、宽 × 深 × 高（mm）、体块数量，并说明可以继续调整尺寸、颜色或样式。',
    '4. 如果用户只问问题、没有要求生成组件，就直接回答，不调用工具。',
    '5. 如果描述无法对应到受支持的 kind，先说明支持范围并追问一个关键尺寸，不要捏造。',
    '6. 组件几何是直角体块近似，不支持真正的圆形、弧形或曲面。用户要求这些形状时，必须明确说明会用方形/分段体块近似，不得把结果称为真实圆形或曲面。',
    '',
    `支持的 kind：${SUPPORTED_KINDS.join('、')}。`,
    '常见尺寸参考：书架 1800×400×2000 mm，三人沙发 2400×900×850 mm，茶几 1400×700×450 mm，落地窗 2000×200×2400 mm，花池 1500×500×600 mm。',
    '用户没有给尺寸时，按 kind 使用合理默认值，并在回复里说明。',
  ].join('\n');
}

function createComponentTool(conversation) {
  return {
    name: 'form_component_create',
    description:
      'Create one validated FORM space component from a semantic description. ' +
      'Use millimetres for dimensions and #rrggbb for colour. Call this exactly once per requested component; ' +
      'the tool builds the 3D blocks and returns a summary. Supported kinds: ' +
      SUPPORTED_KINDS.join(', ') + '. Geometry is a rectangular block approximation; true circles, arcs and curves are not supported.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'widthMm', 'depthMm', 'heightMm', 'color'],
      properties: {
        kind: {
          type: 'string',
          enum: SUPPORTED_KINDS,
          description: 'Component archetype. Choose the closest supported kind.',
        },
        widthMm: {
          type: 'integer',
          description: 'Overall width in millimetres (X axis), 150-4000.',
        },
        depthMm: {
          type: 'integer',
          description: 'Overall depth in millimetres (Y axis), 150-4000.',
        },
        heightMm: {
          type: 'integer',
          description: 'Overall height in millimetres (Z axis), 25-4000.',
        },
        color: {
          type: 'string',
          description: 'Main colour as #rrggbb, e.g. #c9b69a.',
        },
        name: {
          type: 'string',
          description: 'Optional short Chinese display name, at most 28 characters.',
        },
        notes: {
          type: 'string',
          description: 'Optional one-sentence design note shown to the user.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'componentJson'],
        properties: {
          summary: { type: 'string' },
          componentJson: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    execute(args) {
      const component = buildComponent({
        kind: args.kind,
        widthMm: args.widthMm,
        depthMm: args.depthMm,
        heightMm: args.heightMm,
        color: args.color,
        name: args.name,
        notes: args.notes,
        skill: conversation.skill,
      });
      conversation.lastComponent = component;
      conversation.lastComponentAt = Date.now();
      const summary = summarize(component);
      return Promise.resolve({ summary, componentJson: JSON.stringify(component) });
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `生成组件 · ${args.kind}`,
      kind: 'other',
      rawInput: args,
    }),
  };
}

function floorSystemPrompt() {
  return [
    '你是 FORM 方构空间工作台的地面材质设计 Agent。用户会用中文描述地面材质、颜色、纹理或空间氛围。',
    '',
    '工作方式：',
    '1. 用户描述地面时，必须调用 form_floor_generate 工具一次。',
    '2. 颜色使用 #rrggbb；厚度使用毫米，常规 80–300 mm；material 用简短中文名；pattern 可选，例如“直纹”“哑光”“水磨石颗粒”。',
    '3. 不要生成家具、墙体、窗户或其他组件。',
    '4. 调用后用中文简短回复：地面名称、材质、颜色、厚度，并说明可以继续调整。',
    '5. 如果描述无法确定具体材质，选择合理的浅色木地板/暖灰石材/微水泥，并在回复中说明。',
  ].join('\n');
}

function createFloorTool(conversation) {
  return {
    name: 'form_floor_generate',
    description:
      'Create one validated floor finish from a Chinese material/style description. ' +
      'Use a #rrggbb colour, a thickness in millimetres (20-1000), and a short material name.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['material', 'color', 'thicknessMm'],
      properties: {
        material: {
          type: 'string',
          description: 'Short Chinese floor material name, e.g. 浅橡木地板、暖灰水磨石、微水泥.',
        },
        color: {
          type: 'string',
          description: 'Main floor colour as #rrggbb.',
        },
        thicknessMm: {
          type: 'integer',
          description: 'Floor thickness in millimetres, 20-1000.',
        },
        pattern: {
          type: 'string',
          description: 'Optional short texture/pattern description, e.g. 直纹、哑光、颗粒.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'floorJson'],
        properties: {
          summary: { type: 'string' },
          floorJson: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    execute(args) {
      const color = /^#[0-9a-f]{6}$/i.test(String(args.color || ''))
        ? String(args.color).toLowerCase()
        : '#d5c9b4';
      const thicknessMm = Math.max(20, Math.min(1000, Math.round(Number(args.thicknessMm) || 140)));
      const floor = {
        material: String(args.material || '浅色木地板').slice(0, 40),
        color,
        thicknessMm,
        pattern: String(args.pattern || '').slice(0, 80),
      };
      conversation.lastFloor = floor;
      const summary = `地面：${floor.material} · ${floor.color} · ${floor.thicknessMm}mm`;
      return Promise.resolve({ summary, floorJson: JSON.stringify(floor) });
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `生成地面 · ${args.material}`,
      kind: 'other',
      rawInput: args,
    }),
  };
}

export function apply(ctx, config = {}) {
  const webRoot = path.resolve(config.webRoot || path.resolve(PACKAGE_DIR, '..'));
  const dshHome = process.env.DSH_HOME || path.resolve(process.env.USERPROFILE || '', '.dsh');
  const state = {
    model: null,
    conversations: new Map(),
    floorConversations: new Map(),
    directConversations: new Map(),
    disposed: false,
  };
  const renderService = createRenderService({ config, webRoot, dshHome });
  const sharpService = createSharpService({ config, webRoot });
  const roamService = createRoamService({ config, webRoot, renderService });
  const gsJobs = new Map();
  const roamJobs = new Map();
  const GS_DENOISE_PROMPT = [
    'Photoreal interior photograph refined from a 3D Gaussian Splatting view.',
    'Image 1 is the current 3DGS camera, perspective, framing and object placement; preserve its camera position and object layout strictly.',
    'PERSPECTIVE CORRECTION: correct optical perspective distortion while keeping the same camera position. Architectural verticals must be perfectly vertical, horizontals parallel to the horizon, and rectangular furniture rectangular; remove keystone, barrel distortion, wide-angle stretch, bowed walls, leaning columns and stretched furniture. Use a natural rectilinear interior lens, not fisheye or ultra-wide.',
    'Image 2 is the original approved render; use it only for materials, colors, lighting and fine detail.',
    'Remove splat noise, holes, blur and ghosting. Restore crisp architectural edges, realistic surfaces, fabric and wood grain, coherent shadows and natural light.',
    'Do not copy Image 2 camera or composition. Do not move, add or remove major furniture. No text, watermark, UI, duplicate objects or floating geometry.',
  ].join(' ');
  const agentProvider = config.agentProvider || 'deepseek-official';
  const preferredModel = config.agentModel || 'deepseek-flash';
  const agentTimeoutMs = Number(config.agentTimeoutMs) > 0 ? Number(config.agentTimeoutMs) : 180_000;

  async function resolveModel() {
    if (state.model) return state.model;
    let modelId = preferredModel;
    try {
      const models = await ctx.llm.listModels(agentProvider);
      if (Array.isArray(models) && models.length > 0 && !models.some((entry) => entry?.id === preferredModel)) {
        modelId = models.find((entry) => String(entry?.id || '').includes('flash'))?.id || models[0].id;
      }
    } catch {
      // The adapter may not expose discovery; the configured id still passes through.
    }
    state.model = { provider: agentProvider, model: modelId };
    return state.model;
  }

  function disposeConversation(conversation) {
    state.conversations.delete(conversation.id);
    conversation.handle?.dispose().catch(() => {});
  }

  function trimConversations() {
    const max = 12;
    if (state.conversations.size <= max) return;
    const idle = [...state.conversations.values()]
      .filter((conversation) => !conversation.busy)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (state.conversations.size > max && idle.length > 0) {
      disposeConversation(idle.shift());
    }
  }

  async function ensureConversation(requestedId) {
    const id = typeof requestedId === 'string' && /^form-[a-z0-9-]{6,}$/i.test(requestedId) ? requestedId : `form-${randomUUID()}`;
    const existing = state.conversations.get(id);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const conversation = {
      id,
      handle: null,
      busy: false,
      skill: typeof config.skill === 'string' ? config.skill : 'furniture',
      lastComponent: null,
      lastComponentAt: 0,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    };
    const route = await resolveModel();
    const agentOptions = { provider: route.provider, model: route.model, maxTokens: 4096 };
    const setup = async (agentCtx) => {
      agentCtx.tools.register(createComponentTool(conversation));
      agentCtx.systemPrompt.section({
        name: 'form:component-agent',
        order: 120,
        text: systemPrompt(),
      });
    };
    let handle;
    try {
      handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions, setup });
    } catch {
      // No persisted session yet (or resume is unsupported): create a fresh one.
      try {
        handle = await ctx.agents.create({
          sessionId: id,
          meta: { cwd: webRoot },
          agentOptions,
          setup,
        });
      } catch (error) {
        conversation.id = `form-${randomUUID()}`;
        handle = await ctx.agents.create({
          sessionId: conversation.id,
          meta: { cwd: webRoot },
          agentOptions,
          setup,
        });
      }
    }
    conversation.handle = handle;
    state.conversations.set(conversation.id, conversation);
    trimConversations();
    return conversation;
  }

  async function getFormDeepSeekKey() {
    if (process.env.DEEPSEEK_API_KEY) return String(process.env.DEEPSEEK_API_KEY).trim();
    try {
      const file = config.secretsFile || path.join(webRoot, '.form-secrets.json');
      const secrets = JSON.parse(await readFile(file, 'utf8'));
      return typeof secrets.deepseekApiKey === 'string' ? secrets.deepseekApiKey.trim() : '';
    } catch {
      return '';
    }
  }

  async function getDeepSeekKey() {
    try {
      const key = await renderService.getDeepSeekKey();
      if (key) return key;
    } catch { /* fall through */ }
    return getFormDeepSeekKey();
  }

  async function deepSeekRequest(apiKey, body) {
    const base = String(config.deepseekBaseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(agentTimeoutMs),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `DeepSeek HTTP ${response.status}`);
    return data;
  }

  function toolSchema(tool) {
    return {
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    };
  }

  async function chatViaDeepSeek(request, apiKey) {
    const message = typeof request.message === 'string' ? request.message.trim() : '';
    const conversationId = typeof request.conversationId === 'string' && /^form-[a-z0-9-]{6,}$/i.test(request.conversationId)
      ? request.conversationId
      : `form-direct-${randomUUID()}`;
    const history = state.directConversations.get(conversationId) || [];
    const tool = createComponentTool({ skill: request.skill || 'furniture' });
    const model = config.deepseekModel || 'deepseek-chat';
    const data = await deepSeekRequest(apiKey, {
      model,
      messages: [
        { role: 'system', content: systemPrompt() },
        ...history,
        { role: 'user', content: message },
      ],
      tools: [toolSchema(tool)],
      tool_choice: 'auto',
      temperature: 0.3,
    });
    const reply = data?.choices?.[0]?.message;
    if (!reply) throw new Error('DeepSeek 没有返回内容');
    const call = Array.isArray(reply.tool_calls) ? reply.tool_calls.find((item) => item?.function?.name === 'form_component_create') : null;
    let component = null;
    let text = typeof reply.content === 'string' ? reply.content.trim() : '';
    if (call) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      component = buildComponent({
        kind: args.kind,
        widthMm: args.widthMm,
        depthMm: args.depthMm,
        heightMm: args.heightMm,
        color: args.color,
        name: args.name,
        notes: args.notes,
        skill: request.skill || 'furniture',
      });
      text = summarize(component);
    }
    if (!text && !component) throw new Error('DeepSeek 没有返回组件或文字');
    state.directConversations.set(conversationId, [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: text || '已生成组件' },
    ].slice(-10));
    return {
      ok: true,
      conversationId,
      sessionId: conversationId,
      reply: text,
      component: component || null,
      model,
      provider: 'deepseek-api',
      elapsedMs: 0,
    };
  }

  async function chatFloorViaDeepSeek(request, apiKey) {
    const message = typeof request.message === 'string' ? request.message.trim() : '';
    const conversationId = typeof request.conversationId === 'string' && /^form-[a-z0-9-]{6,}$/i.test(request.conversationId)
      ? request.conversationId
      : `form-direct-floor-${randomUUID()}`;
    const history = state.directConversations.get(conversationId) || [];
    const tool = createFloorTool({});
    const model = config.deepseekModel || 'deepseek-chat';
    const data = await deepSeekRequest(apiKey, {
      model,
      messages: [
        { role: 'system', content: floorSystemPrompt() },
        ...history,
        { role: 'user', content: message },
      ],
      tools: [toolSchema(tool)],
      tool_choice: 'auto',
      temperature: 0.3,
    });
    const reply = data?.choices?.[0]?.message;
    if (!reply) throw new Error('DeepSeek 没有返回内容');
    const call = Array.isArray(reply.tool_calls) ? reply.tool_calls.find((item) => item?.function?.name === 'form_floor_generate') : null;
    let floor = null;
    let text = typeof reply.content === 'string' ? reply.content.trim() : '';
    if (call) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      const color = /^#[0-9a-f]{6}$/i.test(String(args.color || '')) ? String(args.color).toLowerCase() : '#d5c9b4';
      const thicknessMm = Math.max(20, Math.min(1000, Math.round(Number(args.thicknessMm) || 140)));
      floor = {
        material: String(args.material || '浅色木地板').slice(0, 40),
        color,
        thicknessMm,
        pattern: String(args.pattern || '').slice(0, 80),
      };
      text = `地面：${floor.material} · ${floor.color} · ${floor.thicknessMm}mm`;
    }
    if (!text && !floor) throw new Error('DeepSeek 没有返回地面或文字');
    state.directConversations.set(conversationId, [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: text || '已生成地面' },
    ].slice(-10));
    return {
      ok: true,
      conversationId,
      sessionId: conversationId,
      reply: text,
      floor: floor || null,
      model,
      provider: 'deepseek-api',
      elapsedMs: 0,
    };
  }

  async function chat(request) {
    const formKey = await getFormDeepSeekKey();
    if (formKey) return chatViaDeepSeek(request, formKey);
    try {
      return await chatViaDsh(request);
    } catch (error) {
      const apiKey = await getDeepSeekKey();
      if (!apiKey) throw error;
      return chatViaDeepSeek(request, apiKey);
    }
  }

  async function chatViaDsh(request) {
    const message = typeof request.message === 'string' ? request.message.trim() : '';
    if (!message) throw new Error('消息不能为空');
    if (message.length > 4000) throw new Error('消息过长（最多 4000 字）');
    const conversation = await ensureConversation(request.conversationId);
    if (request.skill === 'furniture' || request.skill === 'architecture' || request.skill === 'decor') {
      conversation.skill = request.skill;
    }
    if (conversation.busy) {
      const error = new Error('这个会话正在生成中，请稍候');
      error.code = 'BUSY';
      throw error;
    }
    conversation.busy = true;
    conversation.lastUsed = Date.now();
    conversation.lastComponent = null;
    conversation.lastComponentAt = 0;
    try {
      const session = conversation.handle.agent.session;
      const before = session.deriveMessages().length;
      conversation.handle.agent.followup(createUserMessage(message));
      let timer;
      await Promise.race([
        conversation.handle.agent.whenIdle(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            conversation.handle.agent.cancel({ kind: 'user' });
            const error = new Error('Agent 生成超时，请重试或缩短描述');
            error.code = 'TIMEOUT';
            reject(error);
          }, agentTimeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      const messages = session.deriveMessages().slice(before);
      const component = conversation.lastComponent;
      const reply = assistantText(messages) || (component ? summarize(component) : '');
      if (!reply && !component) {
        throw new Error('Agent 没有返回内容，请换个描述重试');
      }
      return {
        ok: true,
        conversationId: conversation.id,
        sessionId: conversation.id,
        reply,
        component: component || null,
        model: state.model?.model || preferredModel,
        elapsedMs: Date.now() - conversation.lastUsed,
      };
    } finally {
      conversation.busy = false;
      conversation.lastUsed = Date.now();
    }
  }

  async function ensureFloorConversation(requestedId) {
    const id =
      typeof requestedId === 'string' && /^form-[a-z0-9-]{6,}$/i.test(requestedId)
        ? requestedId
        : `form-floor-${randomUUID()}`;
    const existing = state.floorConversations.get(id);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const conversation = {
      id,
      handle: null,
      busy: false,
      lastFloor: null,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    };
    const route = await resolveModel();
    const agentOptions = { provider: route.provider, model: route.model, maxTokens: 2048 };
    const setup = async (agentCtx) => {
      agentCtx.tools.register(createFloorTool(conversation));
      agentCtx.systemPrompt.section({
        name: 'form:floor-agent',
        order: 121,
        text: floorSystemPrompt(),
      });
    };
    let handle;
    try {
      handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions, setup });
    } catch {
      try {
        handle = await ctx.agents.create({
          sessionId: id,
          meta: { cwd: webRoot },
          agentOptions,
          setup,
        });
      } catch (error) {
        conversation.id = `form-floor-${randomUUID()}`;
        handle = await ctx.agents.create({
          sessionId: conversation.id,
          meta: { cwd: webRoot },
          agentOptions,
          setup,
        });
      }
    }
    conversation.handle = handle;
    state.floorConversations.set(conversation.id, conversation);
    if (state.floorConversations.size > 4) {
      const idle = [...state.floorConversations.values()]
        .filter((entry) => !entry.busy)
        .sort((a, b) => a.lastUsed - b.lastUsed);
      while (state.floorConversations.size > 4 && idle.length > 0) {
        const old = idle.shift();
        state.floorConversations.delete(old.id);
        old.handle?.dispose().catch(() => {});
      }
    }
    return conversation;
  }

  async function chatFloor(request) {
    const formKey = await getFormDeepSeekKey();
    if (formKey) return chatFloorViaDeepSeek(request, formKey);
    try {
      return await chatFloorViaDsh(request);
    } catch (error) {
      const apiKey = await getDeepSeekKey();
      if (!apiKey) throw error;
      return chatFloorViaDeepSeek(request, apiKey);
    }
  }

  async function chatFloorViaDsh(request) {
    const message = typeof request.message === 'string' ? request.message.trim() : '';
    if (!message) throw new Error('消息不能为空');
    if (message.length > 4000) throw new Error('消息过长（最多 4000 字）');
    const conversation = await ensureFloorConversation(request.conversationId);
    if (conversation.busy) {
      const error = new Error('地面 Agent 正在生成中，请稍候');
      error.code = 'BUSY';
      throw error;
    }
    conversation.busy = true;
    conversation.lastUsed = Date.now();
    conversation.lastFloor = null;
    try {
      const session = conversation.handle.agent.session;
      const before = session.deriveMessages().length;
      conversation.handle.agent.followup(createUserMessage(message));
      let timer;
      await Promise.race([
        conversation.handle.agent.whenIdle(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            conversation.handle.agent.cancel({ kind: 'user' });
            const error = new Error('地面 Agent 生成超时，请重试或缩短描述');
            error.code = 'TIMEOUT';
            reject(error);
          }, agentTimeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      const messages = session.deriveMessages().slice(before);
      const floor = conversation.lastFloor;
      const reply = assistantText(messages) || (floor ? `${floor.material} · ${floor.thicknessMm}mm` : '');
      if (!reply && !floor) throw new Error('Agent 没有返回内容，请换个描述重试');
      return {
        ok: true,
        conversationId: conversation.id,
        sessionId: conversation.id,
        reply,
        floor: floor || null,
        model: state.model?.model || preferredModel,
        elapsedMs: Date.now() - conversation.lastUsed,
      };
    } finally {
      conversation.busy = false;
      conversation.lastUsed = Date.now();
    }
  }

  async function serveStatic(req, res, pathname) {
    let relative = pathname === '/form' ? '/index.html' : pathname.slice('/form'.length);
    if (!relative || relative === '/') relative = '/index.html';
    if (relative.includes('\0')) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const candidates = [path.resolve(webRoot, `.${relative}`)];
    if (relative === '/index.html') candidates.push(path.resolve(webRoot, 'FORM-preview.html'));
    for (const candidate of candidates) {
      if (!candidate.startsWith(webRoot + path.sep) && candidate !== webRoot) continue;
      const base = path.basename(candidate);
      if (base.startsWith('.')) continue;
      let info;
      try {
        info = await stat(candidate);
      } catch {
        continue;
      }
      if (!info.isFile()) continue;
      const ext = path.extname(candidate).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const data = await readFile(candidate);
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': data.length,
        'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=300',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(data);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }

  async function renderHistory(cameraId) {
    const dir = renderService.generatedDir;
    let files;
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const records = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const record = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        if (!record?.url || record.parentId) continue;
        if (cameraId && record.cameraId && record.cameraId !== cameraId) continue;
        records.push(record);
      } catch {
        // Ignore a half-written sidecar.
      }
    }
    records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return records.slice(0, 40);
  }

  async function handleForm(req, res) {
    const url = new URL(req.url || '/form/', 'http://form.local');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    try {
      if (pathname === '/form/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        const route = await resolveModel();
        const render = await renderService.status();
        sendJson(res, 200, {
          ok: true,
          service: 'form-studio',
          version: '1.0.0',
          productVersion: 'FORM v1',
          agent: { provider: route.provider, model: route.model },
          render,
          gs: sharpService.status(),
          roam: { available: roamService.available() },
          prompts: {
            version: PROMPT_VERSION,
            positive: BUILTIN_POSITIVE,
            negative: BUILTIN_NEGATIVE,
          },
          webRoot,
          time: new Date().toISOString(),
        });
        return;
      }
      if (pathname === '/form/api/agent' && req.method === 'POST') {
        const body = await readJson(req, MAX_AGENT_BODY);
        const result = await chat(body);
        sendJson(res, 200, result);
        return;
      }
      if (pathname === '/form/api/floor/agent' && req.method === 'POST') {
        const body = await readJson(req, MAX_AGENT_BODY);
        const result = await chatFloor(body);
        sendJson(res, 200, result);
        return;
      }
      if (pathname === '/form/api/settings/open-folder' && req.method === 'POST') {
        const body = await readJson(req, MAX_AGENT_BODY);
        const type = String(body.type || '');
        let target = '';
        if (type === 'sharp') target = sharpService.status().modelDir || '';
        else if (type === 'dsh') target = path.join(homedir(), '.dsh');
        else if (type === 'secrets') target = path.dirname(config.secretsFile || path.join(webRoot, '.form-secrets.json'));
        if (!target) {
          sendJson(res, 400, { ok: false, code: 'NO_FOLDER', message: '没有可打开的文件夹' });
          return;
        }
        target = path.resolve(target);
        await mkdir(target, { recursive: true }).catch(() => {});
        spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
        sendJson(res, 200, { ok: true, path: target });
        return;
      }
      if (pathname === '/form/api/settings' && req.method === 'GET') {
        const settings = await renderService.getSettings();
        settings.sharp = sharpService.status();
        try {
          const route = await resolveModel();
          settings.agent = { provider: route.provider, model: route.model, configured: true };
        } catch {
          settings.agent = { provider: agentProvider, model: preferredModel, configured: false };
        }
        sendJson(res, 200, { ok: true, ...settings });
        return;
      }
      if (pathname === '/form/api/settings' && req.method === 'POST') {
        const body = await readJson(req, MAX_AGENT_BODY);
        const settings = await renderService.updateSettings(body);
        sendJson(res, 200, { ok: true, ...settings });
        return;
      }
      if (pathname === '/form/api/prompt/preview' && req.method === 'POST') {
        const body = await readJson(req, MAX_AGENT_BODY);
        const finalPrompt = composePrompt({
          userPrompt: body.prompt,
          negativePrompt: body.negativePrompt,
          sceneBrief: body.sceneBrief,
          allowPeople: body.allowPeople === true,
          hasReferenceImage: body.hasReferenceImage !== false,
        });
        sendJson(res, 200, {
          ok: true,
          finalPrompt,
          length: finalPrompt.length,
          promptVersion: PROMPT_VERSION,
        });
        return;
      }
      if (pathname === '/form/api/render' && req.method === 'POST') {
        const body = await readJson(req, MAX_RENDER_BODY);
        const userPrompt = typeof body.prompt === 'string' ? body.prompt : '';
        const negativePrompt = typeof body.negativePrompt === 'string' ? body.negativePrompt : '';
        const sceneBrief = typeof body.sceneBrief === 'string' ? body.sceneBrief : '';
        const allowPeople = body.allowPeople === true;
        const finalPrompt = composePrompt({
          userPrompt,
          negativePrompt,
          sceneBrief,
          allowPeople,
          hasReferenceImage: body.hasReferenceImage !== false && body.keepLayout !== false,
        });
        const result = await renderService.generate({
          prompt: finalPrompt,
          resolution: body.resolution,
          referenceDataUrl: body.referenceDataUrl,
          keepLayout: body.keepLayout !== false,
          cameraId: body.cameraId,
          meta: {
            userPrompt,
            negativePrompt,
            sceneBrief,
            allowPeople,
            promptVersion: PROMPT_VERSION,
            cameraId: body.cameraId,
          },
        });
        sendJson(res, 200, { ok: true, ...result, finalPrompt });
        return;
      }
      if (pathname === '/form/api/3dgs/roam-ai' && req.method === 'POST') {
        const body = await readJson(req, MAX_RENDER_BODY);
        const renderId = String(body.renderId || '');
        if (!/^form-[a-z0-9-]+$/.test(renderId)) {
          sendJson(res, 400, { ok: false, code: 'INVALID_ID', message: '效果图 ID 无效' });
          return;
        }
        if (!roamService.available()) {
          sendJson(res, 503, { ok: false, code: 'ROAM_UNAVAILABLE', message: '本机未配置 AI 漫游视频处理环境' });
          return;
        }
        const jobId = `roam-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
        const job = { status: 'running', stage: '准备', progress: 0, result: null, error: null };
        roamJobs.set(jobId, job);
        roamService.generate({
          renderId,
          videoDataUrl: String(body.videoDataUrl || ''),
          path: String(body.path || 'dolly'),
          duration: Number(body.duration) || 8000,
          onProgress: (stage, progress) => { job.stage = stage; job.progress = progress; },
        }).then((result) => {
          job.status = 'complete';
          job.stage = '完成';
          job.progress = 100;
          job.result = result;
          setTimeout(() => { if (roamJobs.get(jobId) === job) roamJobs.delete(jobId); }, 10 * 60_000);
        }).catch((error) => {
          job.status = 'error';
          job.error = error instanceof Error ? error.message : String(error);
        });
        sendJson(res, 202, { ok: true, jobId, status: 'running' });
        return;
      }
      if (pathname === '/form/api/3dgs/roam-ai/status' && req.method === 'GET') {
        const jobId = url.searchParams.get('jobId') || '';
        const job = roamJobs.get(jobId);
        if (!job) {
          sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '没有找到漫游视频任务' });
          return;
        }
        if (job.status === 'running') {
          sendJson(res, 202, { ok: true, jobId, status: 'running', stage: job.stage, progress: job.progress });
          return;
        }
        if (job.status === 'error') {
          sendJson(res, 400, { ok: false, code: 'ROAM_FAILED', message: job.error || '漫游视频处理失败' });
          return;
        }
        sendJson(res, 200, { ok: true, jobId, status: 'complete', ...job.result });
        return;
      }
      if (pathname === '/form/api/3dgs/generate' && req.method === 'POST') {
        const body = await readJson(req, MAX_AGENT_BODY);
        const renderId = String(body.renderId || '');
        if (!/^form-[a-z0-9-]+$/.test(renderId)) {
          sendJson(res, 400, { ok: false, code: 'INVALID_ID', message: '效果图 ID 无效' });
          return;
        }
        const cache = sharpService.cached(renderId);
        if (cache) {
          sendJson(res, 200, { ok: true, status: 'complete', ...cache });
          return;
        }
        if (!sharpService.available()) {
          sendJson(res, 503, { ok: false, code: 'GS_UNAVAILABLE', message: '本机未配置 SHARP 3DGS 推理环境' });
          return;
        }
        const existing = gsJobs.get(renderId);
        if (existing && existing.status === 'running') {
          sendJson(res, 202, { ok: true, renderId, status: 'running' });
          return;
        }
        const job = { status: 'running', startedAt: Date.now(), result: null, error: null };
        gsJobs.set(renderId, job);
        sharpService.generate(renderId)
          .then((result) => {
            job.status = 'complete';
            job.result = result;
            job.finishedAt = Date.now();
            setTimeout(() => { if (gsJobs.get(renderId) === job) gsJobs.delete(renderId); }, 10 * 60_000);
          })
          .catch((error) => {
            job.status = 'error';
            job.error = error instanceof Error ? error.message : String(error);
            job.finishedAt = Date.now();
          });
        sendJson(res, 202, { ok: true, renderId, status: 'running' });
        return;
      }
      if (pathname === '/form/api/3dgs/status' && req.method === 'GET') {
        const renderId = url.searchParams.get('renderId') || '';
        const cache = sharpService.cached(renderId);
        if (cache) {
          sendJson(res, 200, { ok: true, status: 'complete', ...cache });
          return;
        }
        const job = gsJobs.get(renderId);
        if (!job) {
          sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '还没有生成 3DGS', available: sharpService.available() });
          return;
        }
        if (job.status === 'running') {
          sendJson(res, 202, { ok: true, renderId, status: 'running' });
          return;
        }
        if (job.status === 'error') {
          sendJson(res, 400, { ok: false, code: 'GS_FAILED', message: job.error || '3DGS 生成失败' });
          return;
        }
        sendJson(res, 200, { ok: true, status: 'complete', ...job.result });
        return;
      }
      if (pathname === '/form/api/3dgs/denoise' && req.method === 'POST') {
        const body = await readJson(req, MAX_RENDER_BODY);
        const renderId = String(body.renderId || '');
        const viewDataUrl = String(body.viewDataUrl || '');
        if (!/^form-[a-z0-9-]+$/.test(renderId)) {
          sendJson(res, 400, { ok: false, code: 'INVALID_ID', message: '效果图 ID 无效' });
          return;
        }
        if (!/^data:image\/(png|jpeg|webp);base64,/i.test(viewDataUrl)) {
          sendJson(res, 400, { ok: false, code: 'INVALID_VIEW', message: '3DGS 视角截图无效' });
          return;
        }
        const recordPath = path.join(webRoot, 'assets', 'generated', `${renderId}.json`);
        let record;
        try {
          record = JSON.parse(await readFile(recordPath, 'utf8'));
        } catch {
          sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '找不到原始效果图' });
          return;
        }
        const sourceFile = path.join(webRoot, 'assets', 'generated', path.basename(record.file || ''));
        let sourceDataUrl;
        try {
          const mediaType = record.mediaType || 'image/jpeg';
          sourceDataUrl = `data:${mediaType};base64,${(await readFile(sourceFile)).toString('base64')}`;
        } catch {
          sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '原始效果图文件不存在' });
          return;
        }
        const tier = body.tier === 'fine' ? 'fine' : 'fast';
        const model = tier === 'fine' ? renderService.arkModel : renderService.flashModel;
        const result = await renderService.generate({
          prompt: GS_DENOISE_PROMPT,
          resolution: tier === 'fine' ? '2K' : '1K',
          model,
          referenceDataUrls: [viewDataUrl, sourceDataUrl],
          keepLayout: true,
          meta: {
            userPrompt: '3DGS 降噪渲染',
            negativePrompt: '',
            sceneBrief: '',
            allowPeople: false,
            promptVersion: PROMPT_VERSION,
            cameraId: record.cameraId || '',
            renderTier: tier,
          },
        });
        sendJson(res, 200, { ok: true, ...result, fixedPrompt: GS_DENOISE_PROMPT, tier });
        return;
      }
      if (pathname === '/form/api/render/history' && req.method === 'GET') {
        const records = await renderHistory(url.searchParams.get('cameraId') || '');
        sendJson(res, 200, { ok: true, records });
        return;
      }
      if (pathname.startsWith('/form/api/render/') && req.method === 'DELETE') {
        const id = pathname.slice('/form/api/render/'.length);
        const result = await renderService.deleteRender(id);
        sendJson(res, 200, result);
        return;
      }
      if (pathname.startsWith('/form/api/')) {
        sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '未知 API' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD, POST' });
        res.end();
        return;
      }
      await serveStatic(req, res, pathname);
    } catch (error) {
      const code = error instanceof RenderError ? error.code : error?.code || 'ERROR';
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RenderError && code === 'NOT_CONFIGURED') {
        sendJson(res, 503, { ok: false, code, message, hint: '配置 ARK_API_KEY 或 OPENROUTER_API_KEY 后重试' });
        return;
      }
      ctx.logger?.warn?.(`form-studio: ${message}`);
      sendJson(res, code === 'BUSY' ? 409 : code === 'TIMEOUT' ? 504 : 400, { ok: false, code, message });
    }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/form',
        handler: (req, res) => {
          handleForm(req, res).catch((error) => {
            ctx.logger?.warn?.(`form-studio: unhandled ${error instanceof Error ? error.message : String(error)}`);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, code: 'INTERNAL', message: 'FORM 服务内部错误' }));
            } else {
              res.end();
            }
          });
        },
      }),
    'form-studio:routes',
  );

  ctx.effect(
    () => () => {
      state.disposed = true;
      for (const conversation of [...state.conversations.values()]) {
        conversation.handle?.dispose().catch(() => {});
      }
      state.conversations.clear();
    },
    'form-studio:conversations',
  );

  ctx.logger?.info?.(`form-studio: serving ${webRoot} at /form/`);
}
