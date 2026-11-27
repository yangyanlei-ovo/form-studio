import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function run(command, args, timeout = 20 * 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('漫游视频处理超时')); }, timeout);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} 失败：${(stderr || stdout).slice(-1400)}`));
    });
  });
}

export function createRoamService({ config = {}, webRoot, renderService }) {
  const options = config.roam || {};
  const python = options.python || '';
  const extract = options.extract || '';
  const compose = options.compose || '';
  const outputRoot = path.join(webRoot, 'assets', 'roam');
  const workRoot = path.join(outputRoot, '.work');
  const prompt = [
    'Photoreal interior still extracted from a 3D Gaussian Splatting camera path.',
    'Image 1 is the current 3DGS camera; Image 2 is the original approved render.',
    'Preserve Image 1 camera position, framing, object placement and adjusted viewpoint exactly.',
    'PERSPECTIVE CORRECTION: correct optical perspective distortion without moving the camera. Architectural verticals must be truly vertical, horizontals parallel to the horizon, and rectangular furniture rectangular; remove keystone, barrel distortion, wide-angle stretch, bowed walls, leaning columns and stretched objects. Use a natural rectilinear interior lens, never fisheye or ultra-wide.',
    'Use Image 2 only for materials, colors, lighting and fine detail. Remove splat noise, holes, blur and ghosting; restore crisp edges and coherent light.',
    'Do not copy Image 2 camera. Do not move, add or remove major furniture.',
  ].join(' ');

  function available() {
    return Boolean(python && extract && compose && existsSync(python) && existsSync(extract) && existsSync(compose) && renderService);
  }

  let queue = Promise.resolve();
  function enqueue(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  async function generate({ renderId, videoDataUrl, path: route = 'dolly', duration = 8000, onProgress = () => {} }) {
    if (!available()) throw new Error('本机未配置 AI 漫游视频处理环境');
    if (!/^form-[a-z0-9-]+$/.test(renderId)) throw new Error('效果图 ID 无效');
    if (!/^data:video\/webm;base64,/i.test(videoDataUrl)) throw new Error('漫游原始视频无效');
    const jobId = `roam-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
    const work = path.join(workRoot, jobId);
    const outFile = path.join(work, 'out.mp4');
    const finalDir = path.join(outputRoot, jobId);
    await mkdir(work, { recursive: true });
    await mkdir(finalDir, { recursive: true });
    return enqueue(async () => {
      try {
        onProgress('写入原始漫游视频', 5);
        const raw = Buffer.from(videoDataUrl.replace(/^data:video\/webm;base64,/i, ''), 'base64');
        await writeFile(path.join(work, 'raw.webm'), raw);
        onProgress('拆解原始帧', 12);
        await run(python, [extract, '--video', path.join(work, 'raw.webm'), '--out', work], 5 * 60_000);
        const meta = JSON.parse(await readFile(path.join(work, 'meta.json'), 'utf8'));
        const keys = meta.keys || [];
        const sourcePath = path.join(webRoot, 'assets', 'generated', `${renderId}.json`);
        const record = JSON.parse(await readFile(sourcePath, 'utf8'));
        const sourceFile = path.join(webRoot, 'assets', 'generated', path.basename(record.file));
        const sourceData = `data:${record.mediaType || 'image/jpeg'};base64,${(await readFile(sourceFile)).toString('base64')}`;
        const aiDir = path.join(work, 'ai');
        await mkdir(aiDir, { recursive: true });
        for (let i = 0; i < keys.length; i++) {
          onProgress(`AI 处理关键帧 ${i + 1}/${keys.length}`, 15 + Math.round((i / Math.max(1, keys.length)) * 58));
          const keyFile = path.join(work, 'keys', `ai_${String(i).padStart(3, '0')}.jpg`);
          const frameData = `data:image/jpeg;base64,${(await readFile(keyFile)).toString('base64')}`;
          const result = await renderService.generate({
            prompt,
            resolution: '1K',
            model: renderService.flashModel,
            referenceDataUrls: [frameData, sourceData],
            keepLayout: true,
            meta: { userPrompt: 'AI 漫游关键帧', negativePrompt: '', sceneBrief: '', allowPeople: false, cameraId: record.cameraId || '', roamJob: jobId },
          });
          const aiFile = path.join(webRoot, 'assets', 'generated', path.basename(result.url));
          await copyFile(aiFile, path.join(aiDir, `ai_${String(i).padStart(3, '0')}.jpg`));
          await renderService.deleteRender(result.id).catch(() => {});
        }
        onProgress('平滑与编码 1080p MP4', 78);
        await run(python, [compose, '--work', work, '--out', outFile, '--width', '1920', '--height', '1080', '--fps', '30'], 15 * 60_000);
        onProgress('完成', 98);
        await copyFile(outFile, path.join(finalDir, 'roam.mp4'));
        await rm(work, { recursive: true, force: true }).catch(() => {});
        return {
          jobId,
          url: `/form/assets/roam/${jobId}/roam.mp4`,
          keys: keys.length,
          frames: meta.count,
          duration: meta.duration,
        };
      } catch (error) {
        await rm(work, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    });
  }

  return { available, generate, outputRoot };
}
