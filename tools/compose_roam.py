"""Blend AI keyframes into the raw 3DGS path and encode a smooth MP4."""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np


def cover(image, width, height):
    h, w = image.shape[:2]
    scale = max(width / w, height / h)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    resized = cv2.resize(image, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    x = (nw - width) // 2
    y = (nh - height) // 2
    return resized[y:y + height, x:x + width]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--width', type=int, default=1920)
    parser.add_argument('--height', type=int, default=1080)
    parser.add_argument('--fps', type=float, default=30.0)
    args = parser.parse_args()

    work = Path(args.work)
    meta = json.loads((work / 'meta.json').read_text(encoding='utf-8'))
    frames = sorted((work / 'frames').glob('frame_*.jpg'))
    if not frames:
        raise SystemExit('no frames')
    ai_dir = work / 'ai'
    keys = []
    interval = 1.0
    for key in meta.get('keys', []):
        ai_path = ai_dir / f"ai_{len(keys):03d}.jpg"
        if ai_path.exists():
            image = cv2.imread(str(ai_path))
            if image is not None:
                keys.append({'time': float(key['time']), 'image': cover(image, args.width, args.height)})
        interval = max(0.5, min(3.0, float(meta.get('keys', [{}])[1]['time'] - meta.get('keys', [{}])[0]['time']))) if len(meta.get('keys', [])) > 1 else 1.0

    writer = cv2.VideoWriter(args.out, cv2.VideoWriter_fourcc(*'mp4v'), args.fps, (args.width, args.height))
    if not writer.isOpened():
        raise SystemExit('cannot open writer')
    src_fps = float(meta.get('fps') or args.fps)
    duration = float(meta.get('duration') or (len(frames) / src_fps))
    total = max(1, int(round(duration * args.fps)))
    prev = None
    for out_index in range(total):
        t = out_index / args.fps
        src_index = min(len(frames) - 1, max(0, int(round(t * src_fps))))
        raw = cv2.imread(str(frames[src_index]))
        if raw is None:
            continue
        out = cover(raw, args.width, args.height).astype(np.float32)
        if keys:
            nearest = min(keys, key=lambda item: abs(item['time'] - t))
            distance = abs(nearest['time'] - t)
            weight = max(0.0, 0.58 * (1.0 - distance / max(0.55, interval * 0.70)))
            if weight > 0:
                out = out * (1.0 - weight) + nearest['image'].astype(np.float32) * weight
        out = np.clip(out, 0, 255).astype(np.uint8)
        if prev is not None:
            out = cv2.addWeighted(out, 0.88, prev, 0.12, 0)
        out = cv2.fastNlMeansDenoisingColored(out, None, 3, 3, 7, 21)
        writer.write(out)
        prev = out
        if out_index % 30 == 0:
            print(f'frame {out_index}/{total}', flush=True)
    writer.release()
    print('done', args.out)


if __name__ == '__main__':
    main()
