import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

function run(command, args, { timeout = 15 * 60_000, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`3DGS 命令超时：${path.basename(command)}`));
    }, timeout);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} 失败（${code}）：${(stderr || stdout).slice(-1600)}`));
    });
  });
}

async function findFile(dir, extension) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(full, extension);
      if (nested) return nested;
    } else if (entry.name.toLowerCase().endsWith(extension)) return full;
  }
  return null;
}

export function createSharpService({ config = {}, webRoot }) {
  const options = config.sharp || {};
  const paths = {
    cli: options.cli || '',
    python: options.python || '',
    model: options.model || '',
    prepare: options.prepare || '',
    resize: options.resize || '',
    splatTransform: options.splatTransform || '',
    node: options.node || '',
    splatCli: options.splatCli || '',
  };
  const device = options.device === 'cuda' ? 'cuda' : 'cpu';
  const maxSize = Number(options.maxSize) || 2048;
  const decimate = String(options.decimate || '60%');
  const outputRoot = path.join(webRoot, 'assets', '3dgs');
  const workRoot = path.join(outputRoot, '.work');

  function available() {
    return Boolean(paths.cli && paths.python && paths.model && paths.prepare && paths.resize && paths.splatTransform
      && existsSync(paths.cli) && existsSync(paths.python) && existsSync(paths.model)
      && existsSync(paths.prepare) && existsSync(paths.resize)
      && ((paths.node && paths.splatCli && existsSync(paths.node) && existsSync(paths.splatCli)) || (paths.splatTransform && existsSync(paths.splatTransform))));
  }

  function status() {
    return {
      configured: Boolean(options.cli || options.model),
      available: available(),
      device,
      maxSize,
      decimate,
      modelFile: paths.model,
      modelDir: paths.model ? path.dirname(paths.model) : '',
      modelInstalled: Boolean(paths.model && existsSync(paths.model)),
      runtimeReady: Boolean(paths.cli && paths.python && existsSync(paths.cli) && existsSync(paths.python)),
    };
  }

  function cached(renderId) {
    const dir = path.join(outputRoot, renderId);
    const scene = path.join(dir, 'scene.sog');
    const camera = path.join(dir, 'camera.json');
    const quality = path.join(dir, 'quality.json');
    if (!existsSync(scene) || !existsSync(camera)) return null;
    try {
      const saved = JSON.parse(readFileSync(quality, 'utf8'));
      if (saved.maxSize !== maxSize || saved.decimate !== decimate) return null;
    } catch { return null; }
    return {
      renderId,
      sceneUrl: `/form/assets/3dgs/${encodeURIComponent(renderId)}/scene.sog`,
      cameraUrl: `/form/assets/3dgs/${encodeURIComponent(renderId)}/camera.json`,
    };
  }

  let queue = Promise.resolve();
  function enqueue(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  async function generate(renderId) {
    if (!/^form-[a-z0-9-]+$/.test(renderId)) throw new Error('效果图 ID 无效');
    if (!available()) throw new Error('本机未配置 SHARP 3DGS 推理环境');
    const hit = cached(renderId);
    if (hit) return hit;
    const recordPath = path.join(webRoot, 'assets', 'generated', `${renderId}.json`);
    let record;
    try {
      record = JSON.parse(await readFile(recordPath, 'utf8'));
    } catch {
      throw new Error('找不到这张效果图的原始文件');
    }
    if (!record.file) throw new Error('效果图没有可用的图片文件');
    const source = path.join(webRoot, 'assets', 'generated', path.basename(record.file));
    if (!existsSync(source)) throw new Error('效果图图片文件不存在');

    return enqueue(async () => {
      const again = cached(renderId);
      if (again) return again;
      const work = path.join(workRoot, renderId);
      const raw = path.join(work, 'raw');
      const web = path.join(work, 'web');
      const input = path.join(work, 'input.jpg');
      await rm(work, { recursive: true, force: true });
      await mkdir(raw, { recursive: true });
      await mkdir(web, { recursive: true });
      try {
        await run(paths.python, [paths.resize, source, input, String(maxSize)], { timeout: 2 * 60_000 });
        await run(paths.cli, [
          'predict', '-i', input, '-o', raw, '-c', paths.model,
          '--device', device, '--no-render',
        ], { timeout: 20 * 60_000 });
        const ply = await findFile(raw, '.ply');
        if (!ply) throw new Error('SHARP 没有输出 PLY');
        await run(paths.python, [paths.prepare, '--ply', ply, '--image', input, '--out', web], { timeout: 3 * 60_000 });
        const scenePly = path.join(web, 'scene.ply');
        const smallPly = path.join(web, 'scene-small.ply');
        const sog = path.join(web, 'scene.sog');
        const converter = paths.node && paths.splatCli
          ? { command: paths.node, base: [paths.splatCli], shell: false }
          : { command: paths.splatTransform, base: [], shell: true };
        await run(converter.command, [...converter.base, scenePly, '-d', decimate, '-q', '-w', smallPly], { timeout: 5 * 60_000, shell: converter.shell });
        await run(converter.command, [...converter.base, smallPly, '-q', '-w', sog], { timeout: 5 * 60_000, shell: converter.shell });
        const dest = path.join(outputRoot, renderId);
        await rm(dest, { recursive: true, force: true });
        await mkdir(dest, { recursive: true });
        await copyFile(path.join(web, 'camera.json'), path.join(dest, 'camera.json'));
        await copyFile(sog, path.join(dest, 'scene.sog'));
        await copyFile(path.join(web, 'original.jpg'), path.join(dest, 'original.jpg'));
        await writeFile(path.join(dest, 'quality.json'), JSON.stringify({ maxSize, decimate, device }), 'utf8');
        return cached(renderId);
      } finally {
        await rm(work, { recursive: true, force: true }).catch(() => {});
      }
    });
  }

  return { status, available, generate, cached, outputRoot };
}
