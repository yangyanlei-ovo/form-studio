"""Extract a raw roam recording into JPEG frames and 1-second AI keyframes."""
import argparse
import json
from pathlib import Path
import cv2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--video', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--key-interval', type=float, default=1.0)
    args = parser.parse_args()

    out = Path(args.out)
    frames_dir = out / 'frames'
    keys_dir = out / 'keys'
    frames_dir.mkdir(parents=True, exist_ok=True)
    keys_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise SystemExit('cannot open video')
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 0 or fps > 240:
        fps = 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    frames = []
    keys = []
    next_key = 0.0
    index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = index / fps
        frame_path = frames_dir / f'frame_{index:05d}.jpg'
        cv2.imwrite(str(frame_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        frames.append(str(frame_path))
        if t + 1e-6 >= next_key:
            key_path = keys_dir / f'ai_{len(keys):03d}.jpg'
            cv2.imwrite(str(key_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 94])
            keys.append({'index': index, 'time': round(t, 4), 'source': str(key_path)})
            next_key += args.key_interval
        index += 1
    cap.release()
    if not frames:
        raise SystemExit('no frames extracted')
    meta = {
        'fps': fps,
        'width': width,
        'height': height,
        'count': len(frames),
        'duration': len(frames) / fps,
        'keys': keys,
    }
    (out / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'frames': len(frames), 'keys': len(keys), 'fps': fps, 'width': width, 'height': height}))


if __name__ == '__main__':
    main()
