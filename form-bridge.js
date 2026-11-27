/**
 * FORM × DSH bridge.
 *
 * Loaded after the original workbench scripts. When the FORM DSH plugin is
 * reachable it replaces the two local simulations (component agent and demo
 * rendering) with real API calls. When it is not reachable, the original
 * offline behaviour stays untouched and the UI says so explicitly.
 */
(() => {
  'use strict';

  const $id = (id) => document.getElementById(id);
  const api = (suffix) => `/form/api/${suffix}`;
  const CONVERSATION_KEY = 'form-agent-conversation';
  if (typeof state === 'undefined') return;

  const ui = {
    status: null,
    health: null,
    agentBusy: false,
    renderBusy: false,
    lastImageUrl: '',
    lastComponent: null,
    historyPatched: false,
    libraryPatched: false,
  };

  function notify(message) {
    const fn = globalThis.toast;
    if (typeof fn === 'function') fn(message);
  }

  function setText(selector, text) {
    const element = document.querySelector(selector);
    if (element) element.textContent = text;
  }

  function showResultOverlay(title, detail, action) {
    const wrap = $id('resultWrap');
    if (!wrap) return;
    let overlay = wrap.querySelector('.form-result-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'form-result-overlay';
      wrap.append(overlay);
    }
    overlay.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = detail;
    overlay.append(strong, span);
    if (action?.href) {
      const link = document.createElement('a');
      link.href = action.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = action.label || action.href;
      overlay.append(link);
    }
  }

  function clearResultOverlay() {
    document.querySelectorAll('#resultWrap .form-result-overlay').forEach((node) => node.remove());
  }

  function addStatusPill() {
    const topRight = document.querySelector('.top-right');
    if (!topRight) return;
    const pill = document.createElement('span');
    pill.id = 'formServiceStatus';
    pill.className = 'saved';
    pill.innerHTML = '<i></i> 连接 FORM 服务…';
    const badge = topRight.querySelector('.demo-badge');
    topRight.insertBefore(pill, badge || topRight.firstChild);
    ui.status = pill;
    const style = document.createElement('style');
    style.textContent = `
      #formServiceStatus.offline{color:#9a6b5f}
      #formServiceStatus.offline i{background:#b07363}
      .form-agent-note{margin:6px 0 0;color:#7d8378;font-size:11px;line-height:1.5}
      .form-agent-error{color:#a65f50}
      .form-generate-error{margin:0;color:#a65f50;font-size:12px;line-height:1.6}
      #resultWrap{position:relative}
      .form-result-overlay{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:32px;text-align:center;background:#f6f4eed9;backdrop-filter:blur(2px);color:#3f483d}
      .form-result-overlay strong{font-size:18px;font-weight:500;letter-spacing:.02em}
      .form-result-overlay span{max-width:360px;font-size:12px;line-height:1.7;color:#6f776a}
      .form-result-overlay a{font-size:12px;color:#6d8755;text-decoration:underline;text-underline-offset:3px}
      .form-history-badge{position:absolute;right:6px;bottom:6px;background:#ffffffd9;color:#5c6b60;border-radius:999px;padding:1px 6px;font-size:9px;letter-spacing:.06em}
      .history-item{position:relative}
      .camera-delete{position:absolute;top:7px;right:7px;z-index:2;width:21px;height:21px;border:1px solid #eadfd9;border-radius:50%;background:#ffffffeb;color:#a26b5e;font-size:14px;line-height:1;display:grid;place-items:center;opacity:.85}
      .camera-delete:hover{background:#fff;color:#8d4d40;opacity:1}
      #formDeleteCamera{color:#a26b5e;margin-right:4px}
      .library-delete{position:absolute;top:4px;left:5px;z-index:2;width:18px;height:18px;border:1px solid #eadfd9;border-radius:50%;background:#ffffffeb;color:#a26b5e;font-size:12px;line-height:1;display:grid;place-items:center;opacity:.85}
      .library-delete:hover{background:#fff;color:#8d4d40;opacity:1}
    `;
    document.head.append(style);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    let data;
    try {
      data = await response.json();
    } catch {
      data = { ok: false, message: `服务返回了无法解析的响应（HTTP ${response.status}）` };
    }
    if (!data || typeof data !== 'object') data = { ok: false, message: `HTTP ${response.status}` };
    return { response, data };
  }

  async function health() {
    try {
      const { response, data } = await fetchJson(api('health'), { signal: AbortSignal.timeout(8000) });
      if (response.ok && data.ok) {
        ui.health = data;
        return data;
      }
    } catch {
      // handled by caller
    }
    return null;
  }

  function markOffline() {
    if (ui.status) {
      ui.status.classList.add('offline');
      ui.status.innerHTML = '<i></i> FORM 服务未连接 · 本地模拟';
    }
    const badge = document.querySelector('.render-settings .demo-badge');
    if (badge) badge.textContent = '本地模拟 · 未连接 FORM 服务';
    showResultOverlay('FORM 服务未连接', '当前页面使用本地模拟，不会生成新的效果图。请先启动 FORM 服务。');
  }

  function markOnline(info) {
    renderBuiltinPrompts(info.prompts);
    if (ui.status) {
      ui.status.classList.remove('offline');
      const render = info.render?.configured
        ? `Seedream · ${info.render.primary === 'ark' ? 'Ark' : 'OpenRouter'}`
        : 'Seedream 未配置';
      ui.status.innerHTML = `<i></i> 已连接 DSH · ${render}`;
    }
    const badge = document.querySelector('.render-settings .demo-badge');
    if (badge) {
      badge.textContent = info.render?.configured
        ? `Seedream 已连接 · ${info.render.primary === 'ark' ? '火山方舟' : 'OpenRouter'}`
        : 'Seedream 未配置 · 请设置 API Key';
    }
    const note = document.querySelector('.demo-note');
    if (note) {
      note.textContent = info.render?.configured
        ? `真实出图：${info.render.primary === 'ark' ? '火山方舟 Seedream' : 'OpenRouter Seedream'}；未配置时不会生成示例图。`
        : '未检测到 Seedream 密钥。请设置 ARK_API_KEY 或 OPENROUTER_API_KEY；配置前不会伪造生成结果。';
    }
    setText('.generate-controls strong', 'Doubao Seedream 5.0 Pro');
    if (!info.render?.configured) {
      showResultOverlay(
        'Seedream 未配置',
        '当前显示的是内置示例图；设置 ARK_API_KEY 或 OPENROUTER_API_KEY 后才会生成新图。',
        { href: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', label: '打开火山方舟控制台 →' },
      );
    } else {
      clearResultOverlay();
    }
    const generate = $id('generate');
    if (generate) {
      const span = generate.querySelector('span');
      if (span) span.textContent = '生成效果图';
    }
    const topBadge = document.querySelector('.top-right .demo-badge');
    if (topBadge) topBadge.textContent = 'FORM v1 · DSH 插件';
    const agentHeader = document.querySelector('.agent-window header p');
    if (agentHeader) agentHeader.innerHTML = `<i></i> 已连接 DSH · ${info.agent?.model || 'deepseek-flash'}`;
    const agentTag = document.querySelector('.agent-launch .local-tag');
    if (agentTag) agentTag.textContent = 'DSH';
    const intro = document.querySelector('#agentMessages .chat-message.assistant p');
    if (intro) {
      intro.textContent = '描述一个组件，我会调用 DSH Agent 生成可放置的体块组件。支持书架、沙发、桌子、门窗、绿植、花池、柜子、床、椅子和灯具；尺寸会自动校验。';
    }
    const introSmall = document.querySelector('#agentMessages .chat-message.assistant small');
    if (introSmall) introSmall.textContent = `真实 Agent 会话 · ${info.agent?.model || 'deepseek-flash'}`;
    const input = $id('agentInput');
    if (input) input.placeholder = '例如：浅木色书架，宽1800 深400 高2000 mm';
    const send = $id('agentSend');
    if (send) send.textContent = '生成 ↑';
  }

  // ---------------------------------------------------------------- agent ---

  function addChat(role, text, extraClass = '') {
    const messages = $id('agentMessages');
    if (!messages) return null;
    const div = document.createElement('div');
    div.className = `chat-message ${role} ${extraClass}`.trim();
    const label = document.createElement('span');
    label.textContent = role === 'user' ? 'YOU' : 'FORM AGENT · DSH';
    const p = document.createElement('p');
    p.textContent = String(text)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
    div.append(label, p);
    messages.append(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function componentCard(component) {
    const messages = $id('agentMessages');
    if (!messages) return;
    const message = addChat('assistant', `已生成「${component.name}」。尺寸 ${[component.sx, component.sy, component.sz]
      .map((value) => Math.round(value * 500))
      .join(' × ')} mm。可加入组件库后摆放和编辑。`);

    const canvas = document.createElement('canvas');
    canvas.className = 'agent-component-preview';
    message.append(canvas);

    const meta = document.createElement('small');
    meta.className = 'form-agent-note';
    meta.textContent = `DSH Agent · ${ui.health?.agent?.model || 'deepseek-flash'} · ${component.parts.length} 个体块`;
    message.append(meta);

    const button = document.createElement('button');
    button.className = 'button primary add-generated';
    button.textContent = '＋ 加入组件库';
    button.onclick = () => {
      state.customComponents = state.customComponents || [];
      if (!state.customComponents.some((entry) => entry.id === component.id)) {
        state.customComponents.push(structuredClone(component));
      }
      if (typeof save === 'function') save();
      if (typeof library === 'function') library('furniture');
      document.querySelectorAll('[data-lib]').forEach((tab) => tab.classList.toggle('active', tab.dataset.lib === 'furniture'));
      button.textContent = '✓ 已加入 · 点击放置';
      button.onclick = () => {
        pendingCustom = structuredClone(component);
        type = 'custom';
        if (typeof setMode === 'function') setMode('build');
        const panel = document.querySelector('.agent-window');
        if (panel) panel.hidden = true;
        notify('组件已就绪，左键放置，右键取消');
      };
      notify('已加入组件库，本地保存');
    };
    message.append(button);

    requestAnimationFrame(() => {
      try {
        const object = structuredClone(component);
        object.x = 7 - object.sx / 2;
        object.y = 6 - object.sy / 2;
        render(
          canvas,
          { yaw: -0.85, pitch: 0.45, zoom: Math.min(2.3, 9 / Math.max(object.sx, object.sy, object.sz)), projection: 'ortho' },
          true,
          [object],
        );
        messages.scrollTop = messages.scrollHeight;
      } catch (error) {
        meta.textContent = `预览渲染失败：${error.message}`;
      }
    });
  }

  async function sendAgent() {
    if (ui.agentBusy) return;
    const input = $id('agentInput');
    const send = $id('agentSend');
    const text = input?.value.trim();
    if (!text) {
      notify('先描述你想要的组件');
      return;
    }
    ui.agentBusy = true;
    if (send) send.disabled = true;
    addChat('user', text);
    input.value = '';
    const pending = addChat('assistant', '正在调用 DSH Agent…', 'form-agent-note');
    try {
      const conversationId = localStorage.getItem(CONVERSATION_KEY) || undefined;
      const { data } = await fetchJson(api('agent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: text,
          skill: typeof agentSkill === 'string' ? agentSkill : 'furniture',
        }),
        signal: AbortSignal.timeout(200_000),
      });
      pending?.remove();
      if (!data.ok) throw new Error(data.message || 'Agent 调用失败');
      if (data.conversationId) localStorage.setItem(CONVERSATION_KEY, data.conversationId);
      addChat('assistant', data.reply || '已生成组件。');
      if (data.component) {
        ui.lastComponent = data.component;
        componentCard(data.component);
      }
    } catch (error) {
      pending?.remove();
      addChat('assistant', `生成失败：${error.name === 'TimeoutError' ? '请求超时，请重试' : error.message}`, 'form-agent-error');
    } finally {
      ui.agentBusy = false;
      if (send) send.disabled = false;
      input?.focus();
    }
  }

  function installAgentBridge() {
    const input = $id('agentInput');
    const send = $id('agentSend');
    if (!input || !send) return;
    send.onclick = sendAgent;
    input.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          sendAgent();
        }
      },
      true,
    );
  }

  // --------------------------------------------------------------- render ---

  function capturePreview() {
    const canvas = $id('previewCanvas');
    if (!canvas) return undefined;
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  function setResult(record) {
    clearResultOverlay();
    const image = $id('resultImage');
    if (image) {
      image.src = record.url;
      image.alt = record.prompt ? `Seedream 生成：${record.prompt.slice(0, 40)}` : 'Seedream 生成效果图';
      image.onerror = () => showResultOverlay('图片不可用', '这条生成记录的图片文件已丢失，请重新生成。');
    }
    const dialogImage = document.querySelector('#imageDialog img');
    if (dialogImage) dialogImage.src = record.url;
    ui.lastImageUrl = record.url;
    const badge = document.querySelector('#resultWrap .result-badge');
    if (badge) badge.innerHTML = `<svg><use href="#spark"/></svg> Seedream 生成`;
    const name = $id('resultName');
    if (name) name.textContent = record.model || 'Seedream 生成';
    const meta = $id('resultMeta');
    if (meta) {
      meta.textContent = `${record.provider || 'Seedream'} · ${record.size || '2K'} · ${new Date(record.createdAt).toLocaleString('zh-CN')}`;
    }
    const note = document.querySelector('.demo-note');
    if (note) note.textContent = `真实出图 · ${record.provider || 'Seedream'} · ${record.model || ''}`;
  }

  function showRenderError(message) {
    const notConfigured = message.includes('未配置');
    const notOpen = message.includes('尚未开通') || message.includes('未开通') || message.includes('not activated');
    const authFailed = message.includes('鉴权') || message.includes('HTTP 401') || message.includes('API key');
    const balanceDue = message.includes('余额') || message.includes('欠费') || message.includes('overdue');
    const tooLong = message.includes('提示词过长') || message.includes('PROMPT_TOO_LONG');
    const title = notConfigured
      ? 'Seedream 未配置'
      : balanceDue
        ? '火山方舟余额不足'
        : tooLong
          ? '提示词过长'
          : notOpen
            ? 'Seedream 模型未开通'
            : authFailed
              ? 'Seedream 鉴权失败'
              : '生成失败';
    const action = balanceDue
      ? { href: 'https://console.volcengine.com/finance/', label: '打开火山引擎费用中心 →' }
      : notOpen
        ? { href: 'https://console.volcengine.com/ark/region:cn-beijing/model/detail?name=doubao-seedream-5-0-pro', label: '打开 Seedream 5.0 Pro 模型页 →' }
        : notConfigured || authFailed
          ? { href: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', label: '打开火山方舟控制台 →' }
          : undefined;
    showResultOverlay(title, message, action);
    const note = document.querySelector('.demo-note');
    if (note) note.textContent = message;
    notify(message);
  }

  function clearRenderError() {
    document.querySelectorAll('.form-generate-error').forEach((node) => node.remove());
  }

  async function imageUrlToDataUrl(url) {
    if (!url) return null;
    if (String(url).startsWith('data:image/')) return url;
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`固定效果图读取失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    try {
      const bitmap = await createImageBitmap(blob);
      const max = 1800;
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('固定效果图读取失败'));
        reader.readAsDataURL(blob);
      });
    }
  }

  async function generate() {
    if (ui.renderBusy || busy) return;
    const prompt = $id('prompt')?.value.trim();
    if (!prompt) {
      notify('先写下你想要的空间氛围');
      return;
    }
    if (typeof updatePrompt === 'function') updatePrompt();
    const keepLayout = Boolean($id('keepLayout')?.checked);
    const referenceDataUrl = keepLayout ? capturePreview() : undefined;
    ui.renderBusy = true;
    busy = true;
    const resolution = $id('resolution')?.value || '2K · 预览';
    const generateButton = $id('generate');
    const cameraSelect = $id('cameraSelect');
    const generating = $id('generating');
    ui.renderBusy = true;
    busy = true;
    if (generateButton) generateButton.disabled = true;
    if (cameraSelect) cameraSelect.disabled = true;
    if (generating) generating.hidden = false;
    clearRenderError();
    clearResultOverlay();
    const camera = state.cameras.find((entry) => entry.id === currentCamera);
    const fields = promptControls();
    const negativePrompt = fields.negative?.value || '';
    const allowPeople = Boolean(fields.allowPeople?.checked);
    const sceneBrief = buildSceneBrief(camera);
    try {
      const { data } = await fetchJson(api('render'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          negativePrompt,
          allowPeople,
          sceneBrief,
          resolution,
          referenceDataUrl,
          hasReferenceImage: Boolean(referenceDataUrl),
          keepLayout,
          cameraId: currentCamera,
        }),
        signal: AbortSignal.timeout(320_000),
      });
      if (!data.ok) throw new Error(data.message || '生成失败');
      setResult(data);
      const history = state.history || (state.history = {});
      const list = history[currentCamera] || (history[currentCamera] = []);
      const item = {
        id: data.id,
        name: 'Seedream 出图',
        prompt,
        negativePrompt,
        allowPeople,
        finalPrompt: data.finalPrompt,
        sceneBrief,
        keepLayout,
        revision: state.revision,
        view: camera ? structuredClone(camera.view) : structuredClone(state.view),
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        imageUrl: data.url,
        model: data.model,
        provider: data.provider,
        createdAt: data.createdAt,
      };
      list.push(item);
      activeHistory = list.length - 1;
      if (typeof save === 'function') save();
      // Persist the composite before a second, independently retryable API call.
      busy = false;
      if (typeof historyUI === 'function') historyUI();
      busy = true;
      notify('Seedream 出图完成');
    } catch (error) {
      showRenderError(
        error.name === 'TimeoutError'
          ? '生成超时；Seedream 同步接口可能需要更长时间，请重试或改用 2K。'
          : error.message,
      );
    } finally {
      ui.renderBusy = false;
      busy = false;
      if (generateButton) generateButton.disabled = false;
      if (cameraSelect) cameraSelect.disabled = false;
      if (generating) generating.hidden = true;
    }
  }

  function installRenderBridge() {
    const generateButton = $id('generate');
    if (generateButton) generateButton.onclick = generate;
    const download = $id('downloadImage');
    if (download) {
      download.onclick = () => {
        const url = ui.lastImageUrl || $id('resultImage')?.src;
        if (!url) return;
        const link = document.createElement('a');
        link.href = url;
        link.download = 'FORM-Seedream.png';
        link.click();
      };
    }
    const fullscreen = $id('fullscreen');
    if (fullscreen) {
      fullscreen.onclick = () => {
        const dialog = $id('imageDialog');
        const image = dialog?.querySelector('img');
        if (image && ui.lastImageUrl) image.src = ui.lastImageUrl;
        dialog?.showModal();
      };
    }
  }

  function patchHistory() {
    if (ui.historyPatched) return;
    ui.historyPatched = true;
    const originalSelect = selectHistory;
    const originalHistory = historyUI;
    if (typeof originalSelect === 'function') {
      selectHistory = function patchedSelectHistory(index) {
        originalSelect(index);
        try {
          const item = getHistory?.()[index];
          const fields = promptControls();
          if (item && Object.prototype.hasOwnProperty.call(item, 'negativePrompt') && fields.negative) {
            fields.negative.value = item.negativePrompt || '';
          }
          if (item && Object.prototype.hasOwnProperty.call(item, 'allowPeople') && fields.allowPeople) {
            fields.allowPeople.checked = Boolean(item.allowPeople);
          }
          if (item?.imageUrl) setResult({
            url: item.imageUrl,
            model: item.model,
            provider: item.provider || 'Seedream',
            prompt: item.prompt,
            size: '2K',
            createdAt: item.createdAt || new Date().toISOString(),
          });
        } catch {
          // Keep the original rendering when the item predates real images.
        }
      };
    }
    if (typeof originalHistory === 'function') {
      historyUI = function patchedHistoryUI() {
        originalHistory();
        try {
          const history = getHistory?.() || [];
          document.querySelectorAll('#history img').forEach((image, index) => {
            const item = history[index];
            if (item?.imageUrl) image.src = item.imageUrl;
          });
        } catch {
          // non-fatal
        }
      };
    }
  }

  // ------------------------------------------------------------- api settings ---

  function installApiSettings(info) {
    const dialog = $id('apiDialog');
    const button = $id('apiSettings');
    if (!dialog || !button) return;
    const modelList = $id('apiModelList');
    const modelDetail = $id('apiModelDetail');
    const keyState = $id('apiKeyState');
    const status = $id('apiStatus');
    let configured = Boolean(info?.render?.configured);
    let settings = { models: [], sharp: info?.gs || {}, agent: info?.agent || {} };
    let selected = '';
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const rows = () => {
      const list = Array.isArray(settings.models) ? settings.models.map((item) => ({ ...item, kind: 'api' })) : [];
      const sharp = settings.sharp || {};
      const agent = settings.agent || {};
      list.push({
        id: 'sharp-local',
        kind: 'local',
        name: 'Apple SHARP 3DGS',
        model: sharp.modelFile ? 'sharp_2572gikvuh.pt' : '本地模型未配置',
        providerLabel: '本地',
        usage: '03 3DGS 生成',
        keyLabel: '无需 Key',
        configured: Boolean(sharp.available),
        required: true,
        stateText: sharp.available ? '已就绪' : (sharp.modelInstalled ? (sharp.runtimeReady ? '配置不完整' : '模型已装 / 运行环境缺失') : '未安装'),
        stateClass: sharp.available ? 'ok' : (sharp.modelInstalled ? 'local' : 'missing'),
        modelDir: sharp.modelDir || '',
      });
      const deepseekConfigured = Boolean(settings.hasDeepSeek);
      list.push({
        id: 'deepseek-agent',
        kind: 'agent',
        name: 'DeepSeek Flash',
        model: agent.model || 'deepseek-flash',
        providerLabel: 'DeepSeek / DSH',
        usage: '组件 / 地面 Agent',
        keyLabel: 'DeepSeek API Key',
        keyRef: 'deepseekApiKey',
        configured: deepseekConfigured || Boolean(agent.configured),
        required: false,
        stateText: deepseekConfigured ? 'API Key 已配置' : (agent.configured ? 'DSH 管理' : '未连接'),
        stateClass: deepseekConfigured || agent.configured ? 'local' : 'off',
        provider: agent.provider || 'deepseek-official',
        deepseekConfigured,
      });
      return list;
    };
    const stateOf = (item) => {
      if (item.kind === 'local') return { className: item.stateClass || 'local', text: item.stateText || '本地' };
      if (item.kind === 'agent') return { className: item.stateClass || 'off', text: item.stateText || 'DSH 管理' };
      if (item.configured) return { className: 'ok', text: '已配置' };
      return { className: item.required ? 'missing' : 'off', text: item.required ? '缺少 Key' : '未启用' };
    };
    const keyHintFor = (item) => {
      if (item.keyRef === 'arkApiKey') return settings.arkKeyHint || '';
      if (item.keyRef === 'openrouterApiKey') return settings.openrouterKeyHint || '';
      if (item.keyRef === 'deepseekApiKey') return settings.deepseekKeyHint || '';
      return '';
    };
    const saveKey = async (item, value) => {
      if (!value) { notify('请先填写 Key'); return false; }
      const body = item.keyRef === 'openrouterApiKey' ? { openrouterApiKey: value } : item.keyRef === 'deepseekApiKey' ? { deepseekApiKey: value } : { arkApiKey: value };
      try {
        const { data } = await fetchJson(api('settings'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!data.ok) throw new Error(data.message || '保存失败');
        settings = { ...settings, ...data };
        configured = Boolean(data.configured);
        await load(data);
        notify(item.keyRef === 'openrouterApiKey' ? 'OpenRouter Key 已保存' : item.keyRef === 'deepseekApiKey' ? 'DeepSeek Key 已保存' : '火山方舟 Key 已保存');
        const latest = await health();
        if (latest) markOnline(latest);
        return true;
      } catch (error) {
        notify('保存失败：' + error.message);
        return false;
      }
    };
    const openFolder = async (type) => {
      try {
        const { data } = await fetchJson(api('settings/open-folder'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type }),
        });
        if (!data.ok) throw new Error(data.message || '打开文件夹失败');
        notify('已打开文件夹');
      } catch (error) {
        notify('打开文件夹失败：' + error.message);
      }
    };
    const renderDetail = () => {
      if (!modelDetail) return;
      const item = rows().find((row) => row.id === selected);
      if (!item) { modelDetail.innerHTML = ''; return; }
      if (item.kind === 'local') {
        modelDetail.innerHTML = '<div class="api-detail-head"><div><strong>Apple SHARP 3DGS</strong><small>本地模型 · 无需 API Key</small></div><span class="api-model-state ' + (item.stateClass || 'local') + '">' + escape(item.stateText) + '</span></div><p>生成 3DGS 需要把模型文件放在下面的文件夹中。模型已随安装包提供，但 PyTorch / SHARP 运行环境仍需本机具备。</p><code>' + escape(item.modelDir || '模型文件夹未配置') + '</code><div class="api-detail-actions"><button class="button primary" type="button" data-folder="sharp">打开模型文件夹</button><button class="button subtle" type="button" data-folder="secrets">打开配置文件夹</button></div>';
      } else if (item.kind === 'agent') {
        const hint = keyHintFor(item);
        modelDetail.innerHTML = '<div class="api-detail-head"><div><strong>DeepSeek Flash</strong><small>' + escape(item.provider || 'deepseek-official') + ' / ' + escape(item.model) + '</small></div><span class="api-model-state ' + (item.stateClass || 'off') + '">' + escape(item.stateText) + '</span></div><p>新电脑没有 DSH 凭据时，FORM 会用这里的 DeepSeek API Key 直接调用 deepseek-chat；有 DSH 时优先走 DSH。</p><label><span>DeepSeek API Key</span><input id="apiDetailKey" type="password" autocomplete="off" placeholder="' + escape(hint ? '已配置 ' + hint + '，输入新 Key 可替换' : 'sk-...') + '"></label><div class="api-detail-actions"><button id="apiDetailSave" class="button primary" type="button">保存 Key</button><button class="button subtle" type="button" data-folder="dsh">打开 DSH 配置文件夹</button></div>';
      } else {
        const hint = keyHintFor(item);
        const label = item.keyRef === 'openrouterApiKey' ? 'OpenRouter API Key' : '火山方舟 API Key';
        const note = item.keyRef === 'openrouterApiKey'
          ? '备用通道，当前未启用；填入后可保留。'
          : 'Seedream 5.0 Pro / Flash 共用这一个火山方舟 Key。';
        modelDetail.innerHTML = '<div class="api-detail-head"><div><strong>' + escape(item.name) + '</strong><small>' + escape(item.model) + '</small></div><span class="api-model-state ' + (stateOf(item).className) + '">' + escape(stateOf(item).text) + '</span></div><p>' + escape(note) + '</p><label><span>' + escape(label) + '</span><input id="apiDetailKey" type="password" autocomplete="off" placeholder="' + escape(hint ? '已配置 ' + hint + '，输入新 Key 可替换' : (item.keyRef === 'openrouterApiKey' ? 'sk-or-...' : 'ark-...')) + '"></label><div class="api-detail-actions"><button id="apiDetailSave" class="button primary" type="button">保存 Key</button></div>';
      }
      modelDetail.querySelectorAll('[data-folder]').forEach((btn) => { btn.onclick = () => openFolder(btn.dataset.folder); });
      const save = $id('apiDetailSave');
      if (save) save.onclick = async () => {
        const input = $id('apiDetailKey');
        if (!input) return;
        save.disabled = true;
        await saveKey(item, input.value.trim());
        save.disabled = false;
      };
    };
    const renderList = () => {
      if (!modelList) return;
      const all = rows();
      if (!selected || !all.some((row) => row.id === selected)) {
        selected = (all.find((row) => row.required && !row.configured) || all[0] || {}).id || '';
      }
      modelList.innerHTML = all.map((item) => {
        const state = stateOf(item);
        return '<button class="api-model-row' + (item.id === selected ? ' active' : '') + '" type="button" data-model="' + escape(item.id) + '"><div><strong>' + escape(item.name) + '</strong><small>' + escape(item.model) + '</small></div><span class="api-model-use">' + escape(item.usage) + '</span><span class="api-model-badge">' + escape(item.providerLabel || item.provider) + '</span><span class="api-model-state ' + state.className + '">' + escape(state.text) + '</span></button>';
      }).join('');
      modelList.querySelectorAll('[data-model]').forEach((row) => {
        row.onclick = () => { selected = row.dataset.model; renderList(); };
      });
      renderDetail();
    };
    const applySummary = () => {
      const arkHint = settings.arkKeyHint || '';
      const orHint = settings.openrouterKeyHint || '';
      if (keyState) {
        const pieces = [];
        pieces.push(arkHint ? '<b>火山方舟：已配置 ' + escape(arkHint) + '</b>' : '<span class="missing">火山方舟：未配置</span>');
        pieces.push(orHint ? 'OpenRouter：已配置' : 'OpenRouter：未配置');
        keyState.innerHTML = pieces.join(' · ');
      }
    };
    const load = async (preloaded) => {
      if (preloaded?.models) {
        settings = { ...settings, ...preloaded };
        configured = Boolean(preloaded.configured);
        renderList();
        applySummary();
        return;
      }
      try {
        const { data } = await fetchJson(api('settings'));
        if (data?.ok) {
          settings = { ...settings, ...data };
          configured = Boolean(data.configured);
          renderList();
          applySummary();
        }
      } catch { /* 服务尚未就绪 */ }
    };
    const open = async () => {
      if (status) {
        status.classList.remove('form-agent-error');
        status.textContent = '正在读取模型与 API 配置…';
      }
      if (!dialog.open) dialog.showModal();
      await load();
      if (status) status.textContent = '';
    };
    button.onclick = () => open();
    $id('closeApi').onclick = () => dialog.close();
    $id('apiCancel').onclick = () => dialog.close();
    renderList();
    load();
    if (info && info.render && info.render.configured === false) {
      setTimeout(open, 400);
    }
  }

  // ------------------------------------------------------------- pinned result ---

  function currentGeneratedItem() {
    try {
      const list = getHistory?.() || [];
      const item = list[activeHistory];
      return item?.imageUrl ? item : null;
    } catch {
      return null;
    }
  }

  function refreshPinButton() {
    const button = $id('pinResult');
    if (!button) return;
    const available = Boolean(currentGeneratedItem());
    button.disabled = !available;
    button.textContent = available && state.pinnedResult ? '更新固定' : '固定当前效果图';
  }

  function renderPinnedResultBar() {
    const bar = $id('pinBar');
    if (!bar) return;
    const pinned = state.pinnedResult;
    const status = $id('pinStatus');
    const meta = $id('pinMeta');
    const thumb = $id('pinThumb');
    const view = $id('viewPin');
    const unpin = $id('unpinResult');
    bar.classList.toggle('pinned', Boolean(pinned));
    if (pinned) {
      if (status) status.textContent = `${pinned.cameraName || '已固定视角'} · 风格锁定`;
      if (meta) meta.textContent = [pinned.name, pinned.meta, '新视角沿用此风格'].filter(Boolean).join(' · ');
      if (thumb) {
        thumb.src = pinned.imageUrl;
        thumb.hidden = false;
      }
      if (view) view.hidden = false;
      if (unpin) unpin.hidden = false;
    } else {
      if (status) status.textContent = '未固定';
      if (meta) meta.textContent = '生成效果图后可固定，切换视角仍保留';
      if (thumb) {
        thumb.hidden = true;
        thumb.removeAttribute('src');
      }
      if (view) view.hidden = true;
      if (unpin) unpin.hidden = true;
    }
    refreshPinButton();
  }

  function pinCurrentResult() {
    const item = currentGeneratedItem();
    if (!item) {
      notify('请先生成一张效果图，再固定');
      return;
    }
    const camera = state.cameras.find((entry) => entry.id === currentCamera);
    state.pinnedResult = {
      cameraId: currentCamera,
      cameraName: camera?.name || '当前视角',
      historyId: item.id,
      imageUrl: item.imageUrl,
      name: item.name || $id('resultName')?.textContent || 'Seedream 出图',
      meta: $id('resultMeta')?.textContent || '',
      prompt: item.prompt || '',
      createdAt: item.createdAt || new Date().toISOString(),
    };
    save();
    renderPinnedResultBar();
    notify('已固定当前效果图 · 切换视角仍会保留');
  }

  function installPinnedResult() {
    const pin = $id('pinResult');
    if (!pin) return;
    pin.onclick = pinCurrentResult;
    $id('unpinResult').onclick = () => {
      state.pinnedResult = null;
      save();
      renderPinnedResultBar();
      notify('已取消固定效果图');
    };
    $id('viewPin').onclick = () => {
      const pinned = state.pinnedResult;
      if (!pinned) return;
      const dialog = $id('imageDialog');
      const image = dialog?.querySelector('img');
      if (image) image.src = pinned.imageUrl;
      dialog?.showModal();
    };
    const originalHistory = historyUI;
    historyUI = function patchedPinnedHistory() {
      originalHistory();
      refreshPinButton();
      renderPinnedResultBar();
    };
    const originalSelect = selectHistory;
    selectHistory = function patchedPinnedSelect(index) {
      originalSelect(index);
      refreshPinButton();
    };
    const originalOpen = openRender;
    openRender = function patchedPinnedOpen(id) {
      originalOpen(id);
      refreshPinButton();
      renderPinnedResultBar();
    };
    refreshPinButton();
    renderPinnedResultBar();
  }

  function installProjectExport() {
    const button = $id('exportProject');
    if (!button) return;
    button.onclick = () => {
      const payload = {
        app: 'FORM 方构空间工作台',
        version: '0.4',
        exportedAt: new Date().toISOString(),
        notice:
          'FORM v1. Component Agent conversations are DSH sessions; renders are Seedream outputs stored under assets/generated. The bundled living-room.png remains a demo asset.',
        ...state,
        planImage: typeof planData === 'undefined' ? null : planData,
      };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'FORM-林间客厅.json');
    };
  }

  // ---------------------------------------------------------- project I/O ---

  function installProjectImport() {
    const topRight = document.querySelector('.top-right');
    if (!topRight) return;
    const button = document.createElement('button');
    button.className = 'button subtle';
    button.id = 'formImportProject';
    button.innerHTML = '<svg><use href="#upload"/></svg>导入项目';
    const exportButton = $id('exportProject');
    if (exportButton?.parentNode) exportButton.parentNode.insertBefore(button, exportButton);
    else topRight.append(button);
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    document.body.append(file);
    button.onclick = () => file.click();
    file.onchange = async () => {
      const selected = file.files?.[0];
      if (!selected) return;
      try {
        const data = JSON.parse(await selected.text());
        if (!Array.isArray(data.objects) || !Array.isArray(data.cameras)) throw new Error('不是 FORM 项目文件');
        state = { ...state, ...data, history: data.history || {} };
        if (data.cameras.length) currentCamera = data.cameras[0].id;
        if (typeof save === 'function') save();
        if (typeof refresh === 'function') refresh();
        if (typeof library === 'function') library('all');
        if (typeof presetsUI === 'function') presetsUI();
        renderPinnedResultBar();
        notify('项目已导入');
      } catch (error) {
        notify(`导入失败：${error.message}`);
      } finally {
        file.value = '';
      }
    };
  }

  // --------------------------------------------------------------- prompts ---

  const SCENE_TYPE_NAMES = {
    block: 'block',
    wall: 'wall',
    window: 'window',
    sofa: 'sofa',
    table: 'table',
    plant: 'plant',
    rug: 'rug',
    cabinet: 'cabinet',
    floor: 'floor',
  };

  const SCENE_COLORS = [
    ['#e9e8df', 'cream white'],
    ['#e8e5da', 'cream'],
    ['#d5c9b4', 'warm beige'],
    ['#d2d2ba', 'pale olive'],
    ['#bd9f78', 'light oak'],
    ['#86937b', 'sage green'],
    ['#7f9275', 'muted green'],
    ['#bdab8d', 'oak'],
    ['#d5dfd7', 'pale mint'],
    ['#e7e2d5', 'ivory'],
    ['#e7e5db', 'off white'],
    ['#5c6b60', 'forest green'],
    ['#b8ac97', 'sand'],
    ['#c2ac8e', 'light wood'],
    ['#d8bc93', 'light oak'],
    ['#2f4f3a', 'dark green'],
    ['#000000', 'black'],
  ];

  const FALLBACK_NEGATIVES = [
    'pixel art',
    'voxel art',
    'Minecraft-style blocks',
    'low-poly cubes',
    'visible grid',
    'wireframe',
    'blueprint',
    'schematic',
    'text',
    'watermark',
    'logo',
    'UI overlay',
    'duplicate furniture',
    'floating objects',
    'clipping objects',
    'wrong perspective',
    'fisheye',
    'cartoon',
    'illustration',
    'oversaturated colors',
    'noise',
    'flat lighting',
    'empty room',
    'blank walls',
    'sparse styling',
    'low detail',
    'CGI',
    'plastic',
    'waxy',
    'over-smoothed',
    'repetitive',
    'cluttered',
    'people',
    'crowds',
  ];

  function sceneColorName(hex) {
    const raw = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(raw)) return 'neutral';
    const rgb = raw.match(/../g).map((pair) => Number.parseInt(pair, 16));
    let best = SCENE_COLORS[0];
    let bestDistance = Infinity;
    for (const entry of SCENE_COLORS) {
      const candidate = entry[0].slice(1).match(/../g).map((pair) => Number.parseInt(pair, 16));
      const distance = candidate.reduce((sum, channel, index) => sum + (channel - rgb[index]) ** 2, 0);
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }
    return best[1].replace(/\s+/g, '-');
  }

  function buildSceneBrief(camera) {
    if (!camera || !Array.isArray(state.objects)) return '';
    const view = camera.view || state.view;
    const projectorInstance = projector(1200, 800, view);
    const target = add([SITE_W / 2, SITE_D / 2, 1.6], view.pan || [0, 0, 0]);
    const eye = projectorInstance.eye;
    const right = projectorInstance.right;
    const forward = projectorInstance.forward;
    const meters = (value) => {
      const number = Number((value * 0.5).toFixed(2));
      return String(number).replace(/^(-?)0\./, '$1.');
    };
    const point = (value) => value.map(meters).join(',');
    const perspective = view.projection === 'perspective';
    const lines = [];
    state.objects.forEach((object, index) => {
      let bounds;
      try {
        bounds = boundsOf(object);
      } catch {
        bounds = {
          min: [object.x, object.y, object.z],
          max: [object.x + object.sx, object.y + object.sy, object.z + object.sz],
        };
      }
      const center = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
      const size = [0, 1, 2].map((axis) => Math.max(0.01, bounds.max[axis] - bounds.min[axis]));
      const delta = sub(center, target);
      const lateral = dot(delta, right);
      const depth = perspective ? dot(sub(center, eye), forward) : dot(delta, forward);
      const side = lateral < -0.8 ? 'L' : lateral > 0.8 ? 'R' : 'C';
      const band = perspective
        ? depth < 0
          ? 'B'
          : depth < 3
            ? 'N'
            : depth < 7
              ? 'M'
              : 'F'
        : depth < -2
          ? 'B'
          : depth < 2.5
            ? 'N'
            : depth < 5
              ? 'M'
              : 'F';
      const type =
        object.type === 'custom'
          ? `custom:${String(object.name || 'unnamed').replace(/[|\n\r]/g, ' ').slice(0, 24)}${object.parts ? `:${object.parts.length}p` : ''}`
          : SCENE_TYPE_NAMES[object.type] || object.type;
      lines.push(
        `${String(index + 1).padStart(2, '0')}|${type}|${size.map(meters).join('x')}|${point(center)}|${sceneColorName(object.c)}|${side}|${band}`,
      );
    });
    const cameraLine = `Camera: eye ${point(eye)}; target ${point(target)}; ${perspective ? 'perspective' : 'orthographic'}; yaw ${(view.yaw * 180 / Math.PI).toFixed(0)}; pitch ${(view.pitch * 180 / Math.PI).toFixed(0)}.`;
    return [
      'Scene in meters (1 grid=0.5m). One line per object: id|type|size wxd xh|center x,y,z|color|screen L/C/R|depth N/M/F/B.',
      'L=left C=center R=right; N=near M=mid F=far B=behind camera.',
      `Room ${SITE_W * .5}x${SITE_D * .5}m, floor at Z=0.`,
      cameraLine,
      `Objects (${state.objects.length}):`,
      ...lines,
    ].join('\n');
  }

  function renderBuiltinPrompts(info) {
    const negative = $id('builtinNegative');
    const rules = $id('builtinRules');
    const negatives = Array.isArray(info?.negative) && info.negative.length ? info.negative : FALLBACK_NEGATIVES;
    if (negative) {
      negative.replaceChildren(
        ...negatives.map((text) => {
          const chip = document.createElement('span');
          chip.className = 'negative-chip';
          const conditional = /people|human|crowd/i.test(text);
          chip.textContent = conditional ? `${text} (unless allowed)` : text;
          if (conditional) chip.title = '勾选“允许人物”后从负面词中移除';
          return chip;
        }),
      );
    }
    if (rules) {
      rules.textContent = [
        info?.positive || 'Photorealistic high-end architectural interior photograph, magazine quality, fully resolved but uncluttered. The reference image is a massing/layout guide only; do not copy its block or pixel style. Enrich materials, lighting and restrained styling without changing the described layout.',
        '',
        'AVOID: ' + negatives.join(', ') + '.',
      ].join('\n');
    }
  }

  function promptControls() {
    return {
      prompt: $id('prompt'),
      negative: $id('negativePrompt'),
      allowPeople: $id('allowPeople'),
    };
  }

  function syncPromptFieldsToCamera() {
    const fields = promptControls();
    const camera = state.cameras.find((entry) => entry.id === currentCamera);
    if (!camera || !fields.negative || !fields.allowPeople) return;
    camera.negativePrompt = fields.negative.value;
    camera.allowPeople = Boolean(fields.allowPeople.checked);
    save();
  }

  async function previewFinalPrompt() {
    const fields = promptControls();
    const camera = state.cameras.find((entry) => entry.id === currentCamera);
    if (!fields.prompt) return;
    try {
      const { data } = await fetchJson(api('prompt/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fields.prompt.value,
          negativePrompt: fields.negative?.value || '',
          allowPeople: Boolean(fields.allowPeople?.checked),
          sceneBrief: buildSceneBrief(camera),
          hasReferenceImage: Boolean($id('keepLayout')?.checked),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!data.ok) throw new Error(data.message || '提示词预览失败');
      const preview = $id('finalPromptPreview');
      if (preview) preview.textContent = data.finalPrompt;
      const stats = $id('promptStats');
      if (stats) {
        const objectLines = (data.finalPrompt.match(/^\d{2}\|/gm) || []).length;
        stats.textContent = `${data.length.toLocaleString()} 字符 · ${objectLines} 个对象行 · 上限 4,000 字符`;
      }
      $id('promptDialog')?.showModal();
    } catch (error) {
      notify(`提示词预览失败：${error.message}`);
    }
  }

  function installPromptControls() {
    const fields = promptControls();
    if (!fields.prompt || !fields.negative || !fields.allowPeople) return;
    fields.negative.addEventListener('input', syncPromptFieldsToCamera);
    fields.allowPeople.addEventListener('change', syncPromptFieldsToCamera);

    const originalUpdate = updatePrompt;
    updatePrompt = function patchedUpdatePrompt() {
      originalUpdate();
      syncPromptFieldsToCamera();
    };

    const originalOpenRender = openRender;
    openRender = function patchedOpenRender(id) {
      originalOpenRender(id);
      const camera = state.cameras.find((entry) => entry.id === id);
      if (camera) {
        fields.negative.value = camera.negativePrompt || '';
        fields.allowPeople.checked = Boolean(camera.allowPeople);
      }
    };

    $id('previewPrompt').onclick = previewFinalPrompt;
    $id('closePrompt')?.addEventListener('click', () => $id('promptDialog')?.close());
    $id('promptDialog')?.addEventListener('click', (event) => {
      if (event.target === $id('promptDialog')) $id('promptDialog').close();
    });
    renderBuiltinPrompts(null);
  }

  // ----------------------------------------------------------- wall openings ---

  function openingIsActive(opening) {
    return state.objects.some((object) => object.id === opening.windowId && object.type === 'window');
  }

  function wallSegments(object) {
    const openings = (object.openings || []).filter(openingIsActive);
    if (!openings.length) return [object];
    const axis = openings[0].axis === 'y' ? 'y' : 'x';
    const length = axis === 'x' ? object.sx : object.sy;
    const applicable = openings
      .filter((opening) => opening.axis === axis)
      .map((opening) => ({
        a0: Math.max(0, Math.min(length, opening.a0)),
        a1: Math.max(0, Math.min(length, opening.a1)),
        z0: Math.max(0, Math.min(object.sz, opening.z0)),
        z1: Math.max(0, Math.min(object.sz, opening.z1)),
      }))
      .filter((opening) => opening.a1 - opening.a0 > 0.002 && opening.z1 - opening.z0 > 0.002);
    if (!applicable.length) return [object];
    const breaks = new Set([0, length]);
    for (const opening of applicable) {
      breaks.add(opening.a0);
      breaks.add(opening.a1);
    }
    const sorted = [...breaks].sort((a, b) => a - b);
    const parts = [];
    const push = (a0, a1, z0, z1) => {
      if (a1 - a0 <= 0.002 || z1 - z0 <= 0.002) return;
      parts.push({
        id: object.id,
        type: object.type,
        x: axis === 'x' ? object.x + a0 : object.x,
        y: axis === 'y' ? object.y + a0 : object.y,
        z: object.z + z0,
        sx: axis === 'x' ? a1 - a0 : object.sx,
        sy: axis === 'y' ? a1 - a0 : object.sy,
        sz: z1 - z0,
        c: object.c,
      });
    };
    for (let index = 0; index < sorted.length - 1; index++) {
      const a0 = sorted[index];
      const a1 = sorted[index + 1];
      if (a1 - a0 <= 0.002) continue;
      const covering = applicable.filter((opening) => opening.a0 < a1 - 0.002 && opening.a1 > a0 + 0.002);
      if (!covering.length) {
        push(a0, a1, 0, object.sz);
        continue;
      }
      const zRanges = covering
        .map((opening) => [opening.z0, opening.z1])
        .sort((a, b) => a[0] - b[0]);
      let cursor = 0;
      for (const [z0, z1] of zRanges) {
        if (z0 > cursor) push(a0, a1, cursor, z0);
        cursor = Math.max(cursor, z1);
      }
      if (cursor < object.sz) push(a0, a1, cursor, object.sz);
    }
    return parts;
  }

  function installWallOpenings() {
    const previousComponents = components;
    components = function patchedComponents(object) {
      if (
        (object.type === 'wall' || object.type === 'block') &&
        Array.isArray(object.openings) &&
        object.openings.some(openingIsActive)
      ) {
        return wallSegments(object).map((part) => ({ ...part, owner: object }));
      }
      return previousComponents(object);
    };
    refresh();
  }

  // ----------------------------------------------------------- window placement ---

  const WINDOW_WIDTH = 3;
  const WINDOW_DEPTH = 0.25;

  function windowSpec() {
    const sillInput = $id('windowSill');
    const heightInput = $id('windowHeight');
    let sillMm = Number(sillInput?.value);
    let heightMm = Number(heightInput?.value);
    if (!Number.isFinite(sillMm)) sillMm = 900;
    if (!Number.isFinite(heightMm)) heightMm = 1250;
    sillMm = Math.max(0, Math.min(6000, Math.round(sillMm / 10) * 10));
    heightMm = Math.max(500, Math.min(4000, Math.round(heightMm / 10) * 10));
    if (sillInput) sillInput.value = String(sillMm);
    if (heightInput) heightInput.value = String(heightMm);
    return { sillMm, heightMm, sill: sillMm / 500, height: heightMm / 500 };
  }

  function wallHitAt(pt) {
    const ray = rayAt(pt[0], pt[1]);
    if (!ray) return null;
    let best = null;
    let nearest = Infinity;
    for (const face of faces) {
      if (!face?.box || (face.box.type !== 'wall' && face.box.type !== 'block')) continue;
      if (Math.abs(face.normal[2]) > 0.2) continue;
      if (!inside(pt, face.pts)) continue;
      const denominator = dot(ray.dir, face.normal);
      if (Math.abs(denominator) < 1e-6) continue;
      const distance = dot(sub(face.world[0], ray.origin), face.normal) / denominator;
      if (distance < 0 || distance >= nearest) continue;
      const point = add(ray.origin, mul(ray.dir, distance));
      const object = state.objects.find((candidate) => candidate.id === face.id);
      if (!object) continue;
      nearest = distance;
      best = { face, object, point, normal: face.normal };
    }
    return best;
  }

  function wallGroupAt(normal, plane, direction) {
    const group = [];
    for (const object of state.objects) {
      if (object.type !== 'wall' && object.type !== 'block') continue;
      if (Math.abs(dot(pivotOf(object), normal) - plane) > 0.3) continue;
      const parts = colliderParts(object);
      if (!parts.length) continue;
      let minS = Infinity;
      let maxS = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const part of parts) {
        const center = dot(part.center, direction);
        const extent = [0, 1, 2].reduce(
          (sum, axis) => sum + Math.abs(dot(part.axes[axis], direction)) * part.half[axis],
          0,
        );
        minS = Math.min(minS, center - extent);
        maxS = Math.max(maxS, center + extent);
        minZ = Math.min(minZ, part.min[2]);
        maxZ = Math.max(maxZ, part.max[2]);
      }
      if (!Number.isFinite(minS) || !Number.isFinite(minZ)) continue;
      group.push({ object, minS, maxS, minZ, maxZ });
    }
    return group;
  }

  function wallGroupFor(hit, normal, direction) {
    return wallGroupAt(normal, dot(pivotOf(hit.object), normal), direction);
  }

  function hydrateWindowWallInfo(windowObject) {
    if (windowObject.wallInfo) return;
    const rotation = windowObject.rot?.[2] || 0;
    const normal = norm(rotateVector([0, 1, 0], [0, 0, rotation]));
    const direction = norm(rotateVector([1, 0, 0], [0, 0, rotation]));
    const group = wallGroupAt(normal, dot(pivotOf(windowObject), normal), direction);
    if (!group.length) return;
    const widest = group.reduce((best, entry) =>
      entry.maxS - entry.minS > best.maxS - best.minS ? entry : best,
    );
    windowObject.wallInfo = {
      normal,
      direction,
      plane: dot(pivotOf(widest.object), normal),
      ids: group.map((entry) => entry.object.id),
      minS: Math.min(...group.map((entry) => entry.minS)),
      maxS: Math.max(...group.map((entry) => entry.maxS)),
      maxZ: Math.max(...group.map((entry) => entry.maxZ)),
    };
  }

  function rebuildWindowOpenings(windowObject) {
    const info = windowObject.wallInfo;
    if (!info) return 0;
    for (const object of state.objects) {
      if (!Array.isArray(object.openings)) continue;
      object.openings = object.openings.filter((opening) => opening.windowId !== windowObject.id);
    }
    const center = pivotOf(windowObject);
    const sill = windowObject.z;
    const height = windowObject.sz;
    let count = 0;
    for (const id of info.ids) {
      const object = state.objects.find((candidate) => candidate.id === id);
      if (!object || (object.type !== 'wall' && object.type !== 'block')) continue;
      const rotation = object.rot?.[2] || 0;
      const localDirection = rotateVector(info.direction, [0, 0, -rotation]);
      const axis = Math.abs(localDirection[0]) >= Math.abs(localDirection[1]) ? 'x' : 'y';
      const localCenter = rotateVector(sub(center, pivotOf(object)), [0, 0, -rotation]);
      const length = axis === 'x' ? object.sx : object.sy;
      const centerA = length / 2 + localCenter[axis === 'x' ? 0 : 1];
      const a0 = Math.max(0, centerA - windowObject.sx / 2);
      const a1 = Math.min(length, centerA + windowObject.sx / 2);
      const z0 = Math.max(0, sill - object.z);
      const z1 = Math.min(object.sz, sill + height - object.z);
      if (a1 - a0 <= 0.002 || z1 - z0 <= 0.002) continue;
      object.openings = object.openings || [];
      object.openings.push({
        id: `op-${uid()}`,
        windowId: windowObject.id,
        axis,
        a0,
        a1,
        z0,
        z1,
      });
      count += 1;
    }
    return count;
  }

  function clampWindowToWall(windowObject) {
    const info = windowObject.wallInfo;
    if (!info) return null;
    const center = pivotOf(windowObject);
    const along = dot(center, info.direction);
    const minAlong = info.minS + windowObject.sx / 2;
    const maxAlong = info.maxS - windowObject.sx / 2;
    if (maxAlong < minAlong) return null;
    const maxSill = info.maxZ - windowObject.sz;
    if (maxSill < 0) return null;
    const nextAlong = Math.max(minAlong, Math.min(maxAlong, along));
    const nextSill = Math.max(0, Math.min(maxSill, windowObject.z));
    const clamped = add(
      center,
      add(
        mul(info.direction, nextAlong - along),
        mul(info.normal, info.plane - dot(center, info.normal)),
      ),
    );
    clamped[2] = nextSill + windowObject.sz / 2;
    windowObject.x = clamped[0] - windowObject.sx / 2;
    windowObject.y = clamped[1] - windowObject.sy / 2;
    windowObject.z = nextSill;
    return windowObject;
  }

  function placeWindowAt(hit) {
    const normal = norm([hit.normal[0], hit.normal[1], 0]);
    const direction = norm([-normal[1], normal[0], 0]);
    const group = wallGroupFor(hit, normal, direction);
    if (!group.length) {
      notify('窗户必须放在垂直墙面上');
      return;
    }
    const minS = Math.min(...group.map((entry) => entry.minS));
    const maxS = Math.max(...group.map((entry) => entry.maxS));
    const maxZ = Math.max(...group.map((entry) => entry.maxZ));
    if (maxS - minS < WINDOW_WIDTH) {
      notify('这面墙太短，无法放置 1.5m 宽的窗户');
      return;
    }
    const spec = windowSpec();
    if (maxZ < spec.height + 0.001) {
      notify('这面墙高度不足，无法放置当前窗高');
      return;
    }
    let sill = spec.sill;
    if (sill + spec.height > maxZ) {
      sill = Math.max(0, maxZ - spec.height);
      const sillInput = $id('windowSill');
      if (sillInput) sillInput.value = String(Math.round(sill * 500 / 10) * 10);
      notify('窗台高度已自动吸附到墙内');
    }
    const plane = dot(pivotOf(hit.object), normal);
    const along = dot(hit.point, direction);
    const centerAlong = Math.max(minS + WINDOW_WIDTH / 2, Math.min(maxS - WINDOW_WIDTH / 2, along));
    const center = add(
      hit.point,
      add(
        mul(normal, plane - dot(hit.point, normal)),
        mul(direction, centerAlong - along),
      ),
    );
    center[2] = sill + spec.height / 2;
    const angle = Math.atan2(direction[1], direction[0]) * 180 / Math.PI;
    const windowObject = makeObj(
      'window',
      center[0] - WINDOW_WIDTH / 2,
      center[1] - WINDOW_DEPTH / 2,
      sill,
      color,
      WINDOW_WIDTH,
      WINDOW_DEPTH,
      spec.height,
    );
    windowObject.rot = [0, 0, angle];
    windowObject.wallInfo = {
      normal,
      direction,
      plane,
      ids: group.map((entry) => entry.object.id),
      minS,
      maxS,
      maxZ,
    };
    checkpoint();
    state.objects.push(windowObject);
    const openingCount = rebuildWindowOpenings(windowObject);
    selectedId = windowObject.id;
    changed();
    setMode('orbit');
    notify(
      `窗户已放置 · 窗台 ${Math.round(sill * 500)}mm · 窗高 ${Math.round(spec.height * 500)}mm` +
        (openingCount ? ` · 墙上挖洞 ${openingCount} 处` : ' · 墙体此处原本就是洞口') +
        ' · 拖动轴线可沿墙移动',
    );
  }

  function installWindowPlacement() {
    const options = $id('windowOptions');
    const sync = () => {
      if (options) options.hidden = !(mode === 'build' && type === 'window');
    };
    const previousSetMode = setMode;
    setMode = function patchedWindowSetMode(nextMode) {
      previousSetMode(nextMode);
      sync();
      if (nextMode === 'build' && type === 'window') {
        const hint = $id('canvasHint');
        if (hint) hint.textContent = '点击垂直墙面放置窗户 · 窗台/窗高可设置';
        hover = null;
      }
    };
    const previousResolveMotion = resolveMotion;
    resolveMotion = function patchedWindowMotion(previousState, nextState, operation) {
      if (previousState?.type === 'window' && nextState?.type === 'window') {
        if (operation !== 'move') {
          return { blocked: true, reason: '窗户只能沿墙面移动，不能旋转或缩放', object: previousState };
        }
        if (!previousState.wallInfo) {
          return { blocked: true, reason: '请删除后重新放置窗户', object: previousState };
        }
        const availableWalls = previousState.wallInfo.ids.filter((id) =>
          state.objects.some((object) => object.id === id && (object.type === 'wall' || object.type === 'block')),
        );
        if (!availableWalls.length) {
          return { blocked: true, reason: '所在墙体不可用，请删除后重新放置', object: previousState };
        }
        nextState.wallInfo = previousState.wallInfo;
        const clamped = clampWindowToWall(nextState);
        if (!clamped) {
          return { blocked: true, reason: '窗户必须保持在墙面上', object: previousState };
        }
        rebuildWindowOpenings(clamped);
        return { blocked: false, reason: '', object: clamped };
      }
      return previousResolveMotion(previousState, nextState, operation);
    };
    const down = (event) => {
      if (event.button !== 0 || mode !== 'build' || type !== 'window' || capture || busy) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const hit = wallHitAt(canvasPoint(event));
      if (!hit) {
        notify('窗户必须放在垂直墙面上');
        return;
      }
      placeWindowAt(hit);
    };
    const move = (event) => {
      if (type !== 'window' || mode !== 'build' || wallDrag || event.buttons !== 0) return;
      event.stopImmediatePropagation();
      if (hover) {
        hover = null;
        draw();
      }
    };
    canvas.addEventListener('pointerdown', down, true);
    canvas.addEventListener('pointermove', move, true);
    state.objects.filter((object) => object.type === 'window').forEach(hydrateWindowWallInfo);
    sync();
  }

  // ----------------------------------------------------------- overlap state ---

  function overlappingObjectIds() {
    const entries = [];
    for (const object of state.objects) {
      if (object.type === 'floor' || object.type === 'rug' || object.type === 'window') continue;
      try {
        const parts = colliderParts(object);
        if (!parts.length) continue;
        entries.push({
          id: object.id,
          parts,
          bounds: boundsOf(object, parts),
          structural: Boolean(object.structural),
          initialStructural: Boolean(object.initialStructural),
        });
      } catch {
        // Ignore malformed custom geometry.
      }
    }
    const ids = new Set();
    for (let first = 0; first < entries.length; first++) {
      for (let second = first + 1; second < entries.length; second++) {
        const a = entries[first];
        const b = entries[second];
        if (a.structural && b.structural && a.initialStructural && b.initialStructural) continue;
        if (!aabbOverlap(a.bounds, b.bounds)) continue;
        let hit = false;
        for (const left of a.parts) {
          for (const right of b.parts) {
            if (boxesOverlap(left, right)) {
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
        if (hit) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }

  function installOverlapHighlight() {
    state.objects.forEach((object) => {
      if (object.type === 'wall') object.structural = true;
      if (object.type === 'block' && (object.sx <= 0.4 || object.sy <= 0.4)) {
        object.structural = true;
        object.initialStructural = true;
      }
    });
    const previous = drawOverlapHighlight;
    drawOverlapHighlight = function patchedOverlapHighlight(g) {
      if (typeof previous === 'function') previous(g);
      const ids = overlappingObjectIds();
      if (!ids.size) return;
      g.save();
      for (const face of faces) {
        if (!ids.has(face.id)) continue;
        poly(g, face.pts, 'rgba(190, 60, 45, 0.16)', '#c0392b');
      }
      g.restore();
    };
    refresh();
  }

  // ------------------------------------------------------------- wall drag ---

  let wallDrag = null;

  function floorPointAt(pt) {
    const ray = rayAt(pt[0], pt[1]);
    if (!ray || Math.abs(ray.dir[2]) < 1e-6) return null;
    const t = -ray.origin[2] / ray.dir[2];
    if (!Number.isFinite(t) || t <= 0) return null;
    const point = add(ray.origin, mul(ray.dir, t));
    return [
      Math.max(0, Math.min(SITE_W, point[0])),
      Math.max(0, Math.min(SITE_D, point[1])),
    ];
  }

  function makeWallFromDrag(start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const raw = Math.hypot(dx, dy);
    const units = Math.max(1, Math.ceil(raw));
    const rawAngle = Math.atan2(dy, dx);
    // Polar tracking: wall direction snaps to 30 degree increments; the drag
    // distance still determines the length, rounded up to a whole wall unit.
    const angle = Math.round(rawAngle / (Math.PI / 6)) * (Math.PI / 6);
    const centerX = start[0] + Math.cos(angle) * units / 2;
    const centerY = start[1] + Math.sin(angle) * units / 2;
    const wall = makeObj('wall', centerX - units / 2, centerY - 0.175, 0, color, units, 0.35, 5.6);
    wall.rot = [0, 0, angle * 180 / Math.PI];
    wall.structural = true;
    return { wall, units, raw };
  }

  function drawWallPreview() {
    if (!wallDrag) return;
    const made = makeWallFromDrag(wallDrag.start, wallDrag.end);
    if (!made) return;
    const P = projector(canvas.clientWidth, canvas.clientHeight, state.view);
    const blocked = Boolean(collisionReason(made.wall, undefined, false));
    const stroke = blocked ? '#b07363' : '#6f8960';
    const fill = blocked ? '#c77b6755' : '#7e967044';
    const faces = components(made.wall).flatMap((part) => boxFaces(part, P)).sort((a, b) => b.depth - a.depth);
    const g = canvas.getContext('2d');
    g.save();
    for (const face of faces) poly(g, face.pts, fill, stroke);
    const angle = made.wall.rot[2] * Math.PI / 180;
    const a = P.project([wallDrag.start[0], wallDrag.start[1], 0.02]);
    const b = P.project([wallDrag.start[0] + Math.cos(angle) * made.units, wallDrag.start[1] + Math.sin(angle) * made.units, 0.02]);
    g.setLineDash([6, 5]);
    g.strokeStyle = stroke;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = stroke;
    g.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
    const label = `${(made.raw * 0.5).toFixed(1)}m → ${(made.units * 0.5).toFixed(1)}m（${made.units} 格）`;
    g.fillText(label, (a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2 - 8);
    g.restore();
  }

  function finishWallDrag() {
    if (!wallDrag) return;
    const { start, end } = wallDrag;
    wallDrag = null;
    const made = makeWallFromDrag(start, end);
    if (!made) {
      draw();
      return;
    }
    const reason = collisionReason(made.wall, undefined, false);
    if (reason) {
      notify(`${reason}，未添加墙体`);
      draw();
      return;
    }
    checkpoint();
    state.objects.push(made.wall);
    selectedId = null;
    pendingCustom = null;
    changed();
    setMode('build');
    notify(`已添加墙体 · ${made.raw.toFixed(1)} 格 → ${made.units} 格（${(made.units * 0.5).toFixed(1)}m）`);
    draw();
  }

  function installWallDrag() {
    const down = (event) => {
      if (event.button !== 0 || mode !== 'build' || type !== 'wall' || capture || busy) return;
      const point = floorPointAt(canvasPoint(event));
      if (!point) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic events and some input devices cannot capture.
      }
      wallDrag = { start: point, end: point, pointerId: event.pointerId };
      hover = null;
      draw();
    };
    const move = (event) => {
      if (!wallDrag) return;
      const point = floorPointAt(canvasPoint(event));
      if (!point) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      wallDrag.end = point;
      draw();
    };
    const up = (event) => {
      if (!wallDrag) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      finishWallDrag();
    };
    const cancel = (event) => {
      if (!wallDrag) return;
      if (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      wallDrag = null;
      draw();
    };
    canvas.addEventListener('pointerdown', down, true);
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerup', up, true);
    canvas.addEventListener('pointercancel', cancel, true);
    canvas.addEventListener('contextmenu', (event) => {
      if (!wallDrag) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      wallDrag = null;
      draw();
    }, true);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && wallDrag) {
        wallDrag = null;
        draw();
      }
    }, true);
    const originalDraw = draw;
    draw = function patchedDraw() {
      originalDraw();
      if (wallDrag && !$id('editor').hidden) drawWallPreview();
    };
    const originalSetMode = setMode;
    setMode = function patchedSetMode(nextMode) {
      originalSetMode(nextMode);
      if (nextMode === 'build' && type === 'wall') {
        const hint = $id('canvasHint');
        if (hint) hint.textContent = '拖动添加墙体 · 30° 极轴 · 长度按整格向上取整 · 右键取消';
      }
    };
  }

  // ------------------------------------------------------------- site size ---

  function syncSiteInputs() {
    const width = $id('siteWidth');
    const depth = $id('siteDepth');
    if (width && document.activeElement !== width) width.value = (SITE_W / 2).toFixed(1);
    if (depth && document.activeElement !== depth) depth.value = (SITE_D / 2).toFixed(1);
  }

  function cameraAnchorFor(view) {
    const yaw = Number(view?.yaw) || 0;
    return [
      Math.max(1, Math.min(SITE_W - 1, SITE_W / 2 + SITE_W * 0.42 * Math.cos(yaw))),
      Math.max(1, Math.min(SITE_D - 1, SITE_D / 2 + SITE_D * 0.42 * Math.sin(yaw))),
      1,
    ];
  }

  function applySiteSize(widthMeters, depthMeters) {
    if (busy || capture || wallDrag) {
      notify(busy ? '出图进行中，暂不能改场地' : wallDrag ? '请先完成墙体拖动' : '请先保存或取消取景');
      syncSiteInputs();
      return;
    }
    const width = Math.max(2, Math.min(30, Math.round(Number(widthMeters) * 2) / 2));
    const depth = Math.max(2, Math.min(30, Math.round(Number(depthMeters) * 2) / 2));
    if (!Number.isFinite(width) || !Number.isFinite(depth)) {
      syncSiteInputs();
      return;
    }
    const oldWidth = SITE_W;
    const oldDepth = SITE_D;
    const newWidth = Math.round(width * 2);
    const newDepth = Math.round(depth * 2);
    if (oldWidth === newWidth && oldDepth === newDepth) {
      syncSiteInputs();
      return;
    }
    const oldDiagonal = Math.hypot(oldWidth, oldDepth);
    const newDiagonal = Math.hypot(newWidth, newDepth);
    const zoomFactor = oldDiagonal / newDiagonal;
    checkpoint();
    SITE_W = newWidth;
    SITE_D = newDepth;
    state.site = { width, depth };
    syncFloorToSite();
    state.cameras.forEach((camera) => {
      camera.view.zoom = Math.max(0.3, Math.min(3, (camera.view.zoom || 1) * zoomFactor));
      camera.anchor = cameraAnchorFor(camera.view);
    });
    state.view.zoom = Math.max(0.3, Math.min(3, (state.view.zoom || 1) * zoomFactor));
    state.revision = (state.revision || 1) + 1;
    const outside = state.objects.filter((object) => {
      if (object.type === 'floor' || object.type === 'rug') return false;
      try {
        const bounds = boundsOf(object);
        return (
          bounds.min[0] < -0.001 ||
          bounds.min[1] < -0.001 ||
          bounds.max[0] > SITE_W + 0.001 ||
          bounds.max[1] > SITE_D + 0.001
        );
      } catch {
        return false;
      }
    }).length;
    save();
    refresh();
    syncSiteInputs();
    notify(
      `场地已调整为 ${width.toFixed(1)} × ${depth.toFixed(1)} m` +
        (outside ? `；${outside} 个组件超出新边界，请手动移动` : ''),
    );
  }

  function resetProject() {
    if (busy) {
      notify('出图进行中，暂不能清空');
      return;
    }
    if (capture || wallDrag) {
      notify('请先保存或取消取景/墙体拖动');
      return;
    }
    if (!globalThis.confirm('清空所有内容？\n将恢复 7.0 × 6.0 m 空场地，并清空机位、预设、出图历史、组件库和底图。')) return;
    checkpoint();
    SITE_W = 14;
    SITE_D = 12;
    state.site = { width: 7, depth: 6 };
    state.objects = [makeObj('floor', 0, 0, -0.28, '#d5c9b4', SITE_W, SITE_D, 0.28)];
    const camera = {
      id: `cam-${uid()}`,
      name: '空场地主视角',
      view: { ...DEFAULT_VIEW, projection: 'perspective', zoom: 1.2 },
      anchor: [7, 6, 1],
      prompt: PRESETS[0].text,
      keepLayout: true,
      negativePrompt: '',
      allowPeople: false,
    };
    state.cameras = [camera];
    currentCamera = camera.id;
    state.view = { ...DEFAULT_VIEW };
    state.customComponents = [];
    state.history = {};
    state.presets = [];
    state.pinnedResult = null;
    state.revision = (state.revision || 1) + 1;
    selectedId = null;
    pendingCustom = null;
    type = 'block';
    planImage = null;
    planData = null;
    planAlpha = 0.45;
    try {
      localStorage.removeItem('form-plan-v1');
    } catch {
      // localStorage may be unavailable
    }
    const planControls = $id('planControls');
    if (planControls) planControls.hidden = true;
    const planFile = $id('planFile');
    if (planFile) planFile.value = '';
    const opacity = $id('planOpacity');
    if (opacity) opacity.value = 45;
    const agent = $id('agent') || document.querySelector('.agent-window');
    if (agent) agent.hidden = true;
    setMode('orbit');
    showScene();
    save();
    refresh();
    library('all');
    presetsUI();
    syncSiteInputs();
    renderPinnedResultBar();
    notify('已清空所有内容，场地恢复 7.0 × 6.0 m');
  }

  function installSiteControls() {
    const width = $id('siteWidth');
    const depth = $id('siteDepth');
    const reset = $id('resetProject');
    const originalRefresh = refresh;
    refresh = function patchedRefresh() {
      originalRefresh();
      syncSiteInputs();
    };
    if (width) {
      width.addEventListener('change', () => applySiteSize(width.value, depth?.value));
      width.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') width.blur();
      });
    }
    if (depth) {
      depth.addEventListener('change', () => applySiteSize(width?.value, depth.value));
      depth.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') depth.blur();
      });
    }
    if (reset) reset.onclick = resetProject;
    syncSiteInputs();
  }

  // -------------------------------------------------------- component library ---

  function deleteCustomComponent(id) {
    const list = state.customComponents || [];
    const index = list.findIndex((component) => component.id === id);
    if (index < 0) return;
    const component = list[index];
    if (!globalThis.confirm(`从组件库删除「${component.name}」？\n已放置到场景的组件不会被删除。`)) return;
    if (pendingCustom && pendingCustom.id === id) {
      pendingCustom = null;
      if (mode === 'build') setMode('orbit');
    }
    list.splice(index, 1);
    state.customComponents = list;
    save();
    library(typeof activeLibrary === 'string' ? activeLibrary : 'all');
    notify('已从组件库删除');
  }

  function installLibraryDelete() {
    if (ui.libraryPatched) return;
    ui.libraryPatched = true;
    const originalLibrary = library;
    library = function patchedLibrary(filter = 'all') {
      originalLibrary(filter);
      document.querySelectorAll('#libraryGrid .block-card').forEach((card) => {
        const id = card.dataset.type;
        if (id === 'wall') card.title = '选中后在地面拖动添加墙体（30° 极轴吸附）';
        if (!(state.customComponents || []).some((component) => component.id === id)) return;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'library-delete';
        remove.title = '从组件库删除';
        remove.setAttribute('aria-label', '从组件库删除该组件');
        remove.textContent = '×';
        remove.onclick = (event) => {
          event.stopPropagation();
          deleteCustomComponent(id);
        };
        card.append(remove);
      });
    };
    library(typeof activeLibrary === 'string' ? activeLibrary : 'all');
  }

  // ---------------------------------------------------------- floor settings ---

  const FLOOR_PRESETS = [
    { name: '浅橡木', material: '浅橡木地板', color: '#c9b69a', thicknessMm: 140 },
    { name: '深色木', material: '深色胡桃木地板', color: '#6e5845', thicknessMm: 140 },
    { name: '暖灰瓷砖', material: '暖灰哑光瓷砖', color: '#b8b4a8', thicknessMm: 120 },
    { name: '水磨石', material: '暖灰水磨石', color: '#cfc9ba', thicknessMm: 160 },
    { name: '微水泥', material: '浅灰微水泥', color: '#9a978d', thicknessMm: 80 },
    { name: '米白石材', material: '米白石材', color: '#ded7c8', thicknessMm: 150 },
  ];

  let floorConversationId = null;

  function floorObject() {
    return state.objects.find((object) => object.type === 'floor') || null;
  }

  function localFloorFromText(text) {
    const source = String(text || '');
    if (/深色|胡桃|黑木|深木/.test(source)) return FLOOR_PRESETS[1];
    if (/水磨石/.test(source)) return FLOOR_PRESETS[3];
    if (/水泥|混凝土|微水泥/.test(source)) return FLOOR_PRESETS[4];
    if (/瓷砖|石材|大理石|米白/.test(source)) return FLOOR_PRESETS[2];
    if (/木|橡木|原木|木纹|浅木/.test(source)) return FLOOR_PRESETS[0];
    return FLOOR_PRESETS[5];
  }

  function setFloorFields(floor) {
    const width = $id('floorWidth');
    const depth = $id('floorDepth');
    const thickness = $id('floorThickness');
    const color = $id('floorColor');
    const material = $id('floorMaterial');
    if (width) width.value = (SITE_W / 2).toFixed(1);
    if (depth) depth.value = (SITE_D / 2).toFixed(1);
    if (thickness) thickness.value = String(Math.round((floor?.sz || 0.28) * 500));
    if (color) color.value = floor?.c || '#d5c9b4';
    if (material) material.value = floor?.material || '暖米石材';
  }

  function openFloorDialog() {
    const floor = floorObject();
    setFloorFields(floor);
    const prompt = $id('floorPrompt');
    if (prompt) prompt.value = '';
    const status = $id('floorAgentStatus');
    if (status) status.textContent = '';
    const presets = $id('floorPresets');
    if (presets) {
      presets.replaceChildren(
        ...FLOOR_PRESETS.map((preset) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'floor-preset';
          button.textContent = preset.name;
          button.onclick = () => {
            const color = $id('floorColor');
            const material = $id('floorMaterial');
            const thickness = $id('floorThickness');
            if (color) color.value = preset.color;
            if (material) material.value = preset.material;
            if (thickness) thickness.value = String(preset.thicknessMm);
          };
          return button;
        }),
      );
    }
    $id('floorDialog')?.showModal();
  }

  function applyFloorSettings() {
    const floor = floorObject();
    if (!floor) {
      notify('当前场景没有地面对象');
      return;
    }
    if (busy || capture) {
      notify(busy ? '出图进行中，暂不能改地面' : '请先保存或取消取景');
      return;
    }
    const width = Number($id('floorWidth')?.value);
    const depth = Number($id('floorDepth')?.value);
    if (Number.isFinite(width) && Number.isFinite(depth) && (width !== SITE_W / 2 || depth !== SITE_D / 2)) {
      applySiteSize(width, depth);
    }
    const current = floorObject();
    if (!current) return;
    const thicknessMm = Math.max(20, Math.min(1000, Math.round(Number($id('floorThickness')?.value) || 140)));
    const color = $id('floorColor')?.value || current.c;
    const material = ($id('floorMaterial')?.value || '自定义地面').trim().slice(0, 40);
    checkpoint();
    current.c = color;
    current.sz = thicknessMm / 500;
    current.z = -current.sz;
    current.material = material;
    state.revision = (state.revision || 1) + 1;
    save();
    refresh();
    $id('floorDialog')?.close();
    notify(`地面已更新 · ${material} · ${thicknessMm}mm`);
  }

  async function generateFloorFromAgent() {
    const promptField = $id('floorPrompt');
    const status = $id('floorAgentStatus');
    const button = $id('floorGenerate');
    const prompt = String(promptField?.value || '').trim();
    if (!prompt) {
      notify('请先描述你想要的地面');
      return;
    }
    if (button) button.disabled = true;
    if (status) {
      status.classList.remove('form-agent-error');
      status.textContent = '地面 Agent 生成中…';
    }
    try {
      const { data } = await fetchJson(api('floor/agent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, conversationId: floorConversationId }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!data.ok) throw new Error(data.message || '地面 Agent 生成失败');
      if (data.conversationId) floorConversationId = data.conversationId;
      const floor = data.floor;
      if (!floor) throw new Error('Agent 没有返回地面参数');
      const color = $id('floorColor');
      const material = $id('floorMaterial');
      const thickness = $id('floorThickness');
      if (color) color.value = floor.color || color.value;
      if (material) material.value = floor.material || material.value;
      if (thickness) thickness.value = String(floor.thicknessMm || thickness.value);
      if (status) status.textContent = data.reply || `已生成：${floor.material}`;
    } catch (error) {
      const fallback = localFloorFromText(prompt);
      const color = $id('floorColor');
      const material = $id('floorMaterial');
      const thickness = $id('floorThickness');
      if (color) color.value = fallback.color;
      if (material) material.value = fallback.material;
      if (thickness) thickness.value = String(fallback.thicknessMm);
      if (status) {
        status.classList.add('form-agent-error');
        status.textContent = `Agent 暂不可用，已用本地近似：${fallback.material}`;
      }
      notify(`地面 Agent 不可用，已用本地近似：${error.message}`);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function installFloorSettings() {
    const originalLibrary = library;
    library = function patchedFloorLibrary(filter = 'all') {
      originalLibrary(filter);
      if (filter !== 'all' && filter !== 'structure') return;
      const grid = $id('libraryGrid');
      if (!grid || $id('floorSettingsCard')) return;
      const card = document.createElement('button');
      card.type = 'button';
      card.id = 'floorSettingsCard';
      card.className = 'block-card floor-card';
      card.dataset.type = '__floor';
      card.title = '地面尺寸、厚度、材质、颜色；可用 Agent 文字生成';
      const preview = document.createElement('canvas');
      const label = document.createElement('span');
      label.textContent = '地面设置';
      card.append(preview, label);
      card.onclick = openFloorDialog;
      grid.append(card);
      const floor = floorObject();
      if (floor) {
        requestAnimationFrame(() => {
          render(preview, { yaw: -0.8, pitch: 0.55, zoom: 3, projection: 'ortho' }, true, [floor]);
        });
      }
    };
    $id('floorApply').onclick = applyFloorSettings;
    $id('floorCancel').onclick = () => $id('floorDialog')?.close();
    $id('closeFloor').onclick = () => $id('floorDialog')?.close();
    $id('floorGenerate').onclick = generateFloorFromAgent;
    library(typeof activeLibrary === 'string' ? activeLibrary : 'all');
  }

  // ----------------------------------------------------------- camera list ---

  function deleteCamera(id) {
    if (capture) {
      notify('请先保存或取消取景，再删除机位');
      return;
    }
    if (busy) {
      notify('出图进行中，暂不能删除机位');
      return;
    }
    if (state.cameras.length <= 1) {
      notify('至少保留一个机位');
      return;
    }
    const index = state.cameras.findIndex((camera) => camera.id === id);
    if (index < 0) return;
    const camera = state.cameras[index];
    if (!globalThis.confirm(`删除机位「${camera.name}」？`)) return;
    const wasCurrent = currentCamera === id;
    checkpoint();
    state.cameras.splice(index, 1);
    if (state.history) delete state.history[id];
    if (wasCurrent) currentCamera = state.cameras[0].id;
    save();
    refresh();
    if (wasCurrent && !$id('renderPage').hidden) openRender(currentCamera);
    notify('机位已删除 · Ctrl+Z 撤销');
  }

  function installCameraDelete() {
    const originalCameraUI = cameraUI;
    cameraUI = function patchedCameraUI() {
      originalCameraUI();
      document.querySelectorAll('#cameraList .camera-card').forEach((card, index) => {
        const camera = state.cameras[index];
        if (!camera) return;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'camera-delete';
        remove.title = '删除机位';
        remove.setAttribute('aria-label', `删除机位 ${camera.name}`);
        remove.textContent = '×';
        remove.onclick = (event) => {
          event.stopPropagation();
          deleteCamera(camera.id);
        };
        card.append(remove);
      });
      const settings = document.querySelector('.render-settings');
      if (settings && !$id('formDeleteCamera')) {
        const remove = document.createElement('button');
        remove.id = 'formDeleteCamera';
        remove.type = 'button';
        remove.className = 'text-button';
        remove.textContent = '删除当前机位';
        remove.onclick = () => deleteCamera(currentCamera);
        settings.insertBefore(remove, settings.querySelector('select') || null);
      }
    };
    refresh();
  }

  // ----------------------------------------------------------------- init ---

  async function init() {
    addStatusPill();
    installProjectExport();
    installPromptControls();
    installWallOpenings();
    installOverlapHighlight();
    installWallDrag();
    installWindowPlacement();
    installSiteControls();
    installLibraryDelete();
    installFloorSettings();
    installCameraDelete();
    const info = await health();
    if (!info) {
      markOffline();
      return;
    }
    markOnline(info);
    installApiSettings(info);
    installAgentBridge();
    installRenderBridge();
    patchHistory();
    installProjectImport();
  }

  init();
})();
