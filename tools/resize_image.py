import sys
from PIL import Image

source, target, max_size = sys.argv[1], sys.argv[2], int(sys.argv[3])
with Image.open(source) as image:
    image = image.convert('RGB')
    image.thumbnail((max_size, max_size), Image.LANCZOS)
    image.save(target, quality=94)
    print(f'{image.width}x{image.height}')
