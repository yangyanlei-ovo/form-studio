"""Prepare web assets from an official SHARP PLY without resizing the source image."""
import argparse
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image
from plyfile import PlyData

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ply', required=True, type=Path)
    parser.add_argument('--image', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    p = PlyData.read(args.ply)
    required = {'x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'}
    if not required.issubset(p['vertex'].data.dtype.names):
        raise ValueError('Not a supported Gaussian PLY: missing splat attributes.')
    w,h = (int(row[0]) for row in p['image_size'].data)
    focal = float(p['intrinsic'].data[4][0])
    if not math.isfinite(focal) or focal <= 0:
        raise ValueError('Invalid SHARP focal length.')
    z = p['vertex'].data['z']
    z = z[np.isfinite(z) & (z > 0)]
    if not len(z):
        raise ValueError('Expected positive SHARP depth.')
    with Image.open(args.image) as image:
        if image.size != (w,h):
            raise ValueError('Image dimensions differ from SHARP metadata; use its original input.')
        args.out.mkdir(parents=True, exist_ok=True)
        targets = [args.out/name for name in ('scene.ply','camera.json','original.jpg')]
        if any(path.exists() for path in targets):
            raise FileExistsError('Output assets already exist; choose a new asset folder.')
        PlyData([p['vertex']], text=False).write(targets[0])
        targets[1].write_text(json.dumps(dict(width=w,height=h,fov=math.degrees(2*math.atan(h/(2*focal))),depth=float(np.median(z))),indent=2),encoding='utf-8')
        image.convert('RGB').save(targets[2],quality=96)
    print(str(args.out))

if __name__ == '__main__':
    main()
