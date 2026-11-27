/* Page 03 — SHARP 3D Gaussian Splatting viewer and Ark denoise handoff. */
(() => {
  const $ = (id) => document.getElementById(id);
  const notify = (message) => { if (typeof toast === 'function') toast(message); };
  const saveState = () => { if (typeof save === 'function') save(); };

  let source = null;
  let sourceIndex = -1;
  let engine = null;
  let viewer = null;
  let generationPoll = null;
  let gsAvailable = false;
  let busy = false;
  let roamPath = 'dolly';
  let roamFrame = 0;
  let roamBasePose = null;
  let roamRecorder = null;

  function getState() { try { return state; } catch { return null; } }

  function gsHistory() {
    const s = getState();
    if (!s) return [];
    if (!Array.isArray(s.gsHistory)) s.gsHistory = [];
    return s.gsHistory;
  }

  function setSource(item, index = -1) {
    source = item || null;
    sourceIndex = index;
    const image = $('gsSourceImage');
    if (image) {
      image.src = item?.imageUrl || '';
      image.alt = item?.name || '当前渲染效果图';
    }
    $('gsSourceName').textContent = item?.name || item?.resultName || '渲染效果图';
    $('gsSourceDetail').textContent = [item?.time, item?.model, item?.provider].filter(Boolean).join(' · ') || '来自出图历史';
    $('gsSourceMeta').textContent = item?.time || '';
  }

  function showPage() {
    document.getElementById('editor').hidden = true;
    document.getElementById('renderPage').hidden = true;
    $('gsPage').hidden = false;
    document.querySelectorAll('.workflow .step').forEach((step) => step.classList.remove('active'));
    $('gsTab')?.classList.add('active');
    window.scrollTo(0, 0);
  }

  function hidePage(showRender = true) {
    stopRoam(false);
    $('gsPage').hidden = true;
    document.getElementById('renderPage').hidden = !showRender;
    $('renderTab')?.classList.add('active');
    $('gsTab')?.classList.remove('active');
  }

  function clearViewer() {
    stopRoam(false);
    setRoamReady(false);
    if (viewer?.dispose) viewer.dispose();
    viewer = null;
    const stage = $('gsStage');
    if (stage) stage.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
    $('gsEmpty').hidden = false;
    $('gsSpinner').hidden = true;
    $('gsReset').disabled = true;
    $('gsDenoise').disabled = true;
    $('gsDenoiseFine').disabled = true;
  }

  async function checkAvailability() {
    try {
      const response = await fetch('/form/api/health', { cache: 'no-store' });
      const data = await response.json();
      gsAvailable = Boolean(data?.gs?.available);
      $('gsBadge').textContent = gsAvailable ? 'SHARP · 本机推理' : 'SHARP · 未配置';
    } catch {
      gsAvailable = false;
      $('gsBadge').textContent = 'SHARP · 未连接';
    }
    $('gsGenerate').disabled = !gsAvailable || busy;
    if (!gsAvailable) {
      $('gsViewerStatus').textContent = '本机未配置 SHARP 3DGS 推理环境；仍可查看已有 3DGS 结果。';
    }
  }

  function setProgress(text) {
    $('gsSpinner').hidden = false;
    $('gsEmpty').hidden = true;
    $('gsProgress').textContent = text || '准备 SHARP 推理';
  }

  function sceneUrls(renderId) {
    return {
      scene: `/form/assets/3dgs/${encodeURIComponent(renderId)}/scene.sog`,
      camera: `/form/assets/3dgs/${encodeURIComponent(renderId)}/camera.json`,
    };
  }

  async function ensureEngine() {
    if (engine) return engine;
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2')) {
      throw new Error('当前浏览器未启用 WebGL2。请用 Microsoft Edge 或 Chrome 打开 FORM；Firefox 需开启硬件加速/WebGL。');
    }
    const THREE = await import('three');
    const spark = await import('./assets/3dgs-vendor/spark.module.js');
    engine = { THREE, SparkRenderer: spark.SparkRenderer, SplatMesh: spark.SplatMesh };
    return engine;
  }

  function setCompareView(dataUrl) {
    const image = $('gsCompareView');
    const frame = image?.parentElement;
    if (!image || !frame) return;
    image.src = dataUrl;
    frame.classList.add('has-image');
    $('gsCompareViewMeta').textContent = '当前视角';
  }

  function setCompareRender(item) {
    const image = $('gsCompareRender');
    const frame = image?.parentElement;
    if (!image || !frame) return;
    if (!item?.imageUrl) {
      image.removeAttribute('src');
      frame.classList.remove('has-image');
      return;
    }
    image.src = item.imageUrl;
    frame.classList.add('has-image');
    $('gsCompareRenderMeta').textContent = item.tier === 'fine' || /pro/i.test(item.model || '') ? 'Pro 2K' : 'Flash 1K';
    $('gsCompareRenderEmpty').textContent = '点击「降噪渲染」后显示结果';
  }

  function captureCompareView() {
    if (!viewer) return;
    try { setCompareView(viewer.capture()); } catch { /* not ready */ }
  }

  function clearCompare() {
    for (const id of ['gsCompareView', 'gsCompareRender']) {
      const image = $(id);
      image?.removeAttribute('src');
      image?.parentElement?.classList.remove('has-image');
    }
    $('gsCompareViewMeta').textContent = '等待 3DGS 加载';
  }

  function showRoam() {
    if (!viewer) {
      notify('请先在 03 页面生成 3DGS');
      return;
    }
    $('gsPage').hidden = true;
    $('roamPage').hidden = false;
    document.getElementById('editor').hidden = true;
    document.getElementById('renderPage').hidden = true;
    document.querySelectorAll('.workflow .step').forEach((step) => step.classList.remove('active'));
    $('roamTab')?.classList.add('active');
    $('roamSourceMeta').textContent = source?.name || source?.time || '当前 3DGS';
    if ($('roamPoster')) $('roamPoster').src = source?.imageUrl || '';
    if ($('roamEmpty')) $('roamEmpty').hidden = true;
    if ($('roamProcessing')) $('roamProcessing').hidden = true;
    setRoamReady(true);
    requestAnimationFrame(() => {
      viewer?.attach($('roamStage'));
      setRoamReady(true);
    });
    window.scrollTo(0, 0);
  }

  function hideRoam(showGs = true) {
    stopRoam(false);
    $('roamProcessing').hidden = true;
    $('roamPage').hidden = true;
    if (showGs) {
      $('gsPage').hidden = false;
      document.getElementById('renderPage').hidden = true;
      $('gsTab')?.classList.add('active');
      $('roamTab')?.classList.remove('active');
      requestAnimationFrame(() => {
        viewer?.attach($('gsStage'));
        setRoamReady(true);
      });
    } else {
      $('gsPage').hidden = true;
    }
  }

  function setRoamStatus(text) {
    const status = $('roamStatus');
    if (status) status.textContent = text;
  }

  function setRoamReady(ready) {
    $('roamRecord').disabled = !ready;
    $('gsEnterRoam').disabled = !ready;
    setRoamStatus(ready ? '就绪 · 选择一条路径' : '等待 3DGS 加载');
  }

  function stopRoam(restore = true) {
    if (roamFrame) cancelAnimationFrame(roamFrame);
    roamFrame = 0;
    if (roamRecorder && roamRecorder.state !== 'inactive') {
      try { roamRecorder.stop(); } catch { /* noop */ }
    }
    roamRecorder = null;
    $('roamBar').style.width = '0%';
    if (restore && viewer && roamBasePose) viewer.setPose(roamBasePose);
    roamBasePose = null;
    if (viewer) setRoamReady(true);
  }

  function presetPose(name, base, t) {
    const e = t * t * (3 - 2 * t);
    const pose = { ...base };
    if (name === 'dolly') {
      pose.radius = base.radius * (1.18 - 0.55 * e);
    } else if (name === 'orbit') {
      pose.yaw = base.yaw - 0.5 + e;
      pose.pitch = base.pitch + 0.04 * Math.sin(e * Math.PI);
    } else if (name === 'rise') {
      pose.pitch = base.pitch - 0.3 + 0.6 * e;
      pose.radius = base.radius * 1.05;
    } else if (name === 'pan') {
      pose.yaw = base.yaw - 0.4 + 0.8 * e;
    }
    return pose;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取视频失败'));
      reader.readAsDataURL(blob);
    });
  }

  function recordRoamBlob() {
    return new Promise((resolve, reject) => {
      if (!viewer) { reject(new Error('3DGS 未加载')); return; }
      setRoamReady(false);
      setRoamStatus('正在后台录制 3DGS 路径…');
      roamBasePose = viewer.getPose();
      const chunks = [];
      let recorder;
      try {
        const stream = viewer.canvas.captureStream(30);
        const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        const mimeType = candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || 'video/webm';
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
      } catch (error) {
        reject(new Error(`无法录制 3DGS 画布：${error.message}`));
        return;
      }
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = (event) => reject(event.error || new Error('录制失败'));
      recorder.onstop = () => {
        roamRecorder = null;
        if (!chunks.length) { reject(new Error('录制没有产生视频数据')); return; }
        resolve(new Blob(chunks, { type: 'video/webm' }));
      };
      roamRecorder = recorder;
      recorder.start(100);
      const duration = Math.max(3000, Number($('roamDuration')?.value) || 8000);
      const started = performance.now();
      const tick = (now) => {
        if (!viewer) return;
        const t = Math.min(1, (now - started) / duration);
        viewer.setPose(presetPose(roamPath, roamBasePose, t));
        $('roamBar').style.width = `${Math.round(t * 100)}%`;
        if (t < 1) {
          roamFrame = requestAnimationFrame(tick);
        } else {
          roamFrame = 0;
          if (viewer && roamBasePose) viewer.setPose(roamBasePose);
          roamBasePose = null;
          setTimeout(() => {
            try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* noop */ }
          }, 250);
        }
      };
      roamFrame = requestAnimationFrame(tick);
    });
  }

  async function exportAI() {
    if (!viewer || !source || busy) return;
    busy = true;
    setRoamReady(false);
    const cover = $('roamProcessing');
    const title = $('roamProcessingTitle');
    const stage = $('roamProcessingStage');
    const bar = $('roamProcessingBar');
    cover.hidden = false;
    title.textContent = '正在导出 AI 漫游视频';
    stage.textContent = '准备录制 3DGS 路径';
    bar.style.width = '2%';
    try {
      const blob = await recordRoamBlob();
      stage.textContent = '上传原始视频 / 拆解帧';
      bar.style.width = '6%';
      const videoDataUrl = await blobToDataURL(blob);
      const startResponse = await fetch('/form/api/3dgs/roam-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renderId: source.id, videoDataUrl, path: roamPath, duration: Number($('roamDuration')?.value) || 8000 }),
        signal: AbortSignal.timeout(120_000),
      });
      const started = await startResponse.json();
      if (!startResponse.ok || !started.ok) throw new Error(started.message || 'AI 漫游任务启动失败');
      let final = null;
      for (let i = 0; i < 900; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const statusResponse = await fetch(`/form/api/3dgs/roam-ai/status?jobId=${encodeURIComponent(started.jobId)}`, { cache: 'no-store' });
        const status = await statusResponse.json();
        if (status.status === 'running') {
          title.textContent = 'AI 正在处理漫游视频';
          stage.textContent = status.stage || '处理中…';
          bar.style.width = `${Math.max(6, Number(status.progress) || 6)}%`;
          continue;
        }
        if (!statusResponse.ok || !status.ok) throw new Error(status.message || 'AI 漫游视频处理失败');
        final = status;
        break;
      }
      if (!final) throw new Error('AI 漫游视频处理超时');
      stage.textContent = 'AI 处理完成，正在下载 MP4';
      bar.style.width = '100%';
      const videoResponse = await fetch(final.url, { cache: 'no-store' });
      if (!videoResponse.ok) throw new Error('最终 MP4 下载失败');
      const videoBlob = await videoResponse.blob();
      downloadBlob(videoBlob, `FORM-AI-ROAM-${roamPath}-${Date.now()}.mp4`);
      title.textContent = 'AI 漫游视频已导出';
      stage.textContent = `1080p 30fps MP4 · ${final.keys || 0} 个 AI 关键帧`;
      setRoamStatus('AI 漫游视频已下载');
      notify('AI 漫游视频已导出');
      setTimeout(() => { cover.hidden = true; }, 1200);
    } catch (error) {
      title.textContent = 'AI 漫游视频导出失败';
      stage.textContent = error.message;
      setRoamStatus(`导出失败：${error.message}`);
      notify(`导出失败：${error.message}`);
    } finally {
      busy = false;
      $('roamRecord').disabled = !viewer;
      $('gsEnterRoam').disabled = !viewer;
    }
  }

  function installRoam() {
    $('roamPaths')?.querySelectorAll('.gs-roam-path').forEach((button) => {
      button.onclick = () => {
        roamPath = button.dataset.path || 'dolly';
        $('roamPaths').querySelectorAll('.gs-roam-path').forEach((item) => item.classList.toggle('active', item === button));
      };
    });
    $('roamRecord').onclick = () => exportAI();
    $('roamHelpBtn').onclick = () => $('roamHelpDialog')?.showModal();
    $('closeRoamHelp').onclick = () => $('roamHelpDialog')?.close();
    $('roamHelpClose').onclick = () => $('roamHelpDialog')?.close();
    setRoamReady(false);
  }

  async function loadScene(renderId) {
    clearViewer();
    setProgress('加载 3DGS 场景…');
    try {
      const { THREE, SparkRenderer, SplatMesh } = await ensureEngine();
      const urls = sceneUrls(renderId);
      const [cameraResponse, sceneResponse] = await Promise.all([
        fetch(urls.camera, { cache: 'no-store' }),
        fetch(urls.scene, { cache: 'no-store' }),
      ]);
      if (!cameraResponse.ok || !sceneResponse.ok) throw new Error('3DGS 文件不存在');
      const meta = await cameraResponse.json();
      const bytes = new Uint8Array(await sceneResponse.arrayBuffer());
      const stage = $('gsStage');
      const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label', '3DGS 可旋转场景');
      stage.prepend(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#dfe4dc');
      const camera = new THREE.PerspectiveCamera(meta.fov || 40, 1, 0.01, 1000);
      const spark = new SparkRenderer({ renderer });
      scene.add(spark);
      const splat = new SplatMesh({ fileBytes: bytes, fileType: 'pcsogszip' });
      splat.rotation.x = Math.PI;
      scene.add(splat);
      await splat.initialized;
      const target = new THREE.Vector3(0, 0, -meta.depth);
      let radius = meta.depth;
      let yaw = 0;
      let pitch = 0;
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let frame = 0;
      const render = () => {
        if (!viewer) return;
        frame = 0;
        const cos = Math.cos(pitch);
        camera.position.set(
          target.x + radius * Math.sin(yaw) * cos,
          target.y + radius * Math.sin(pitch),
          target.z + radius * Math.cos(yaw) * cos,
        );
        camera.lookAt(target);
        renderer.render(scene, camera);
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
      const canvas = renderer.domElement;
      let host = stage;
      const resize = () => {
        if (!viewer) return;
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        render();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      let dragMode = 'rotate';
      canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        dragMode = event.shiftKey ? 'pan' : 'rotate';
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        if (dragMode === 'pan') {
          // Shift + left drag: move the orbit target in the camera plane.
          const scale = (2 * Math.tan((camera.fov * Math.PI) / 360) * radius) / Math.max(1, host.clientHeight);
          const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
          const up = new THREE.Vector3(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch));
          target.addScaledVector(right, -dx * scale);
          target.addScaledVector(up, dy * scale);
          target.x = Math.max(-meta.depth * 1.6, Math.min(meta.depth * 1.6, target.x));
          target.y = Math.max(-meta.depth * 1.2, Math.min(meta.depth * 1.2, target.y));
          target.z = Math.max(-meta.depth * 2.2, Math.min(0, target.z));
        } else {
          yaw -= dx / Math.max(1, host.clientWidth) * 1.8;
          pitch += dy / Math.max(1, host.clientHeight) * 1.35;
          pitch = Math.max(-0.55, Math.min(0.55, pitch));
        }
        lastX = event.clientX;
        lastY = event.clientY;
        schedule();
      });
      const end = (event) => {
        dragging = false;
        try { canvas.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        setTimeout(captureCompareView, 60);
      };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
      canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        radius = Math.max(meta.depth * 0.55, Math.min(meta.depth * 1.65, radius * Math.exp(event.deltaY * 0.0012)));
        schedule();
        setTimeout(captureCompareView, 120);
      }, { passive: false });
      const reset = () => { yaw = 0; pitch = 0; radius = meta.depth; target.set(0, 0, -meta.depth); schedule(); setTimeout(captureCompareView, 80); };
      $('gsReset').onclick = reset;
      viewer = {
        dispose: () => {
          observer.disconnect();
          scene.remove(splat);
          splat.dispose?.();
          spark.dispose?.();
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
        },
        capture: () => {
          renderer.render(scene, camera);
          const data = renderer.domElement.toDataURL('image/png');
          if (!data || data.length < 800) throw new Error('3DGS 画面尚未渲染完成，请稍后重试');
          return data;
        },
      };
      viewer.canvas = renderer.domElement;
      viewer.meta = meta;
      viewer.getPose = () => ({ yaw, pitch, radius });
      viewer.setPose = (pose) => {
        yaw = pose.yaw;
        pitch = Math.max(-0.62, Math.min(0.62, pose.pitch));
        radius = Math.max(meta.depth * 0.5, Math.min(meta.depth * 1.8, pose.radius));
        render();
      };
      viewer.attach = (container) => {
        if (!container) return;
        host = container;
        container.prepend(canvas);
        observer.disconnect();
        observer.observe(container);
        resize();
      };
      viewer.currentHost = () => host;
      resize();
      requestAnimationFrame(() => { resize(); requestAnimationFrame(resize); });
      setTimeout(captureCompareView, 180);
      $('gsEmpty').hidden = true;
      $('gsSpinner').hidden = true;
      $('gsReset').disabled = false;
      $('gsDenoise').disabled = false;
      $('gsDenoiseFine').disabled = false;
      setRoamReady(true);
      $('gsViewerStatus').textContent = '拖动旋转 · 滚轮缩放 · 调整后点击降噪渲染';
    } catch (error) {
      clearViewer();
      $('gsEmpty').hidden = false;
      $('gsEmpty').innerHTML = `<strong>3DGS 加载失败</strong><span>${String(error.message || error)}</span>`;
      $('gsViewerStatus').textContent = '加载失败，可重新点击生成 3DGS 或重试。';
    }
  }

  async function pollGeneration(renderId) {
    clearInterval(generationPoll);
    generationPoll = setInterval(async () => {
      try {
        const response = await fetch(`/form/api/3dgs/status?renderId=${encodeURIComponent(renderId)}`, { cache: 'no-store' });
        const data = await response.json();
        if (data.status === 'running') {
          setProgress('SHARP 正在推理 / 转码，请稍候…');
          return;
        }
        clearInterval(generationPoll);
        generationPoll = null;
        if (!response.ok || !data.ok) throw new Error(data.message || '3DGS 生成失败');
        busy = false;
        $('gsGenerate').disabled = !gsAvailable;
        setProgress('加载 3DGS 场景…');
        await loadScene(renderId);
        notify('3DGS 已生成');
      } catch (error) {
        clearInterval(generationPoll);
        generationPoll = null;
        busy = false;
        $('gsGenerate').disabled = !gsAvailable;
        $('gsSpinner').hidden = true;
        $('gsEmpty').hidden = false;
        $('gsEmpty').innerHTML = `<strong>3DGS 生成失败</strong><span>${String(error.message || error)}</span>`;
        $('gsViewerStatus').textContent = '生成失败，可重试。';
      }
    }, 2000);
  }

  async function generate() {
    if (busy || !source?.imageUrl) return;
    if (!gsAvailable) { notify('本机未配置 SHARP 3DGS 推理环境'); return; }
    busy = true;
    $('gsGenerate').disabled = true;
    clearViewer();
    setProgress('提交 SHARP 3DGS 任务…');
    try {
      const response = await fetch('/form/api/3dgs/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renderId: source.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || '3DGS 生成失败');
      if (data.status === 'complete') {
        busy = false;
        $('gsGenerate').disabled = !gsAvailable;
        await loadScene(source.id);
        return;
      }
      pollGeneration(source.id);
    } catch (error) {
      busy = false;
      $('gsGenerate').disabled = !gsAvailable;
      $('gsSpinner').hidden = true;
      $('gsEmpty').hidden = false;
      $('gsEmpty').innerHTML = `<strong>3DGS 生成失败</strong><span>${String(error.message || error)}</span>`;
      $('gsViewerStatus').textContent = '生成失败，可重试。';
    }
  }

  async function denoise(tier = 'fast') {
    if (!viewer || !source || busy) return;
    busy = true;
    $('gsDenoise').disabled = true;
    $('gsDenoiseFine').disabled = true;
    $('gsViewerStatus').textContent = tier === 'fine' ? '正在请求 Pro 2K 精细降噪…' : '正在请求 Flash 1K 快速降噪…';
    try {
      const viewDataUrl = viewer.capture();
      setCompareView(viewDataUrl);
      const response = await fetch('/form/api/3dgs/denoise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renderId: source.id, viewDataUrl, tier }),
        signal: AbortSignal.timeout(320_000),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || '降噪渲染失败');
      const item = {
        id: data.id,
        imageUrl: data.url,
        sourceId: source.id,
        model: data.model,
        tier: data.tier || tier,
        createdAt: data.createdAt || new Date().toISOString(),
        title: tier === 'fine' ? '3DGS 精细降噪' : '3DGS 快速降噪',
      };
      gsHistory().unshift(item);
      saveState();
      renderHistory();
      showResult(item);
      $('gsViewerStatus').textContent = tier === 'fine' ? '精细降噪完成。' : '快速降噪完成。';
      notify(tier === 'fine' ? '精细降噪完成' : '快速降噪完成');
    } catch (error) {
      $('gsViewerStatus').textContent = `降噪失败：${error.message}`;
      notify(`降噪失败：${error.message}`);
    } finally {
      busy = false;
      $('gsDenoise').disabled = !viewer;
      $('gsDenoiseFine').disabled = !viewer;
    }
  }

  function showResult(item) {
    setCompareRender(item);
  }

  async function deleteResult(item) {
    if (!item) return;
    if (!confirm('删除这张 3DGS 降噪结果？')) return;
    const list = gsHistory();
    const index = list.indexOf(item);
    if (index >= 0) list.splice(index, 1);
    saveState();
    renderHistory();
    showResult(list[0] || null);
    try { await fetch(`/form/api/render/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); } catch { /* noop */ }
  }

  function renderHistory() {
    const container = $('gsHistory');
    if (!container) return;
    const list = gsHistory();
    container.replaceChildren();
    $('gsHistoryCount').textContent = String(list.length).padStart(2, '0');
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'gs-history-empty';
      empty.textContent = '暂无 3DGS 降噪结果。';
      container.append(empty);
      return;
    }
    list.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'gs-history-item';
      const image = document.createElement('img');
      image.src = item.imageUrl;
      image.alt = '3DGS 降噪结果';
      const label = document.createElement('span');
      label.textContent = `${item.model || 'Seedream'} · ${new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gs-history-delete';
      remove.textContent = '×';
      remove.title = '删除这张结果';
      remove.onclick = (event) => { event.stopPropagation(); deleteResult(item); };
      card.onclick = () => showResult(item);
      card.append(image, label, remove);
      container.append(card);
    });
  }

  function openForItem(item, index = -1) {
    if (!item?.imageUrl) { notify('这张记录没有可用的效果图'); return; }
    if (!$('roamPage').hidden) hideRoam(false);
    if (typeof selectHistory === 'function' && index >= 0) selectHistory(index);
    setSource(item, index);
    showPage();
    clearViewer();
    clearCompare();
    renderHistory();
    $('gsViewerStatus').textContent = '点击「生成 3DGS」开始本机推理。';
    checkAvailability().then(async () => {
      if (!item?.id) return;
      try {
        const response = await fetch(`/form/api/3dgs/status?renderId=${encodeURIComponent(item.id)}`, { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'complete') await loadScene(item.id);
          else if (data.status === 'running') { busy = true; setProgress('已有 3DGS 任务在运行…'); pollGeneration(item.id); }
        }
      } catch { /* no cached scene */ }
    });
  }

  function currentItem() {
    try {
      const list = typeof getHistory === 'function' ? getHistory() : [];
      return list[typeof activeHistory === 'number' ? activeHistory : list.length - 1];
    } catch { return null; }
  }

  function installEntryPoints() {
    $('gsBack').onclick = hidePage;
    $('gsGenerate').onclick = generate;
    $('gsEnterRoam').onclick = showRoam;
    $('roamTab').onclick = showRoam;
    $('roamBack').onclick = () => hideRoam(true);
    installRoam();
    $('gsDenoise').onclick = () => denoise('fast');
    $('gsDenoiseFine').onclick = () => denoise('fine');
    $('gsTab').onclick = () => {
      if (!$('roamPage').hidden) { hideRoam(true); return; }
      if (source && !$('gsPage').hidden) return;
      const item = currentItem();
      if (!item) { notify('先生成一张效果图'); return; }
      openForItem(item, typeof activeHistory === 'number' ? activeHistory : -1);
    };
    $('resultImage')?.addEventListener('dblclick', () => {
      const item = currentItem();
      if (item) openForItem(item, typeof activeHistory === 'number' ? activeHistory : -1);
    });
    $('history')?.addEventListener('dblclick', (event) => {
      const item = event.target.closest('.history-item');
      if (!item) return;
      const items = [...document.querySelectorAll('#history .history-item')];
      const index = items.indexOf(item);
      const record = (typeof getHistory === 'function' ? getHistory() : [])[index];
      if (record) openForItem(record, index);
    });
    $('sceneTab')?.addEventListener('click', () => {
      if (!$('roamPage').hidden) hideRoam(false);
      hidePage(false);
    });
    $('renderTab')?.addEventListener('click', () => {
      if (!$('roamPage').hidden) hideRoam(false);
      hidePage(true);
    });
    renderHistory();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installEntryPoints);
  else installEntryPoints();
})();
