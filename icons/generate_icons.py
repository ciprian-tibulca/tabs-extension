"""Generate simple PNG icons for the Tab Groups extension."""
import struct
import zlib

def create_png(size):
    """Create a simple PNG icon with colored squares representing tab groups."""
    pixels = []
    pad = max(1, size // 8)
    gap = max(1, size // 16)
    half = size // 2

    colors = {
        "blue": (26, 115, 232),
        "red": (217, 48, 37),
        "green": (24, 128, 56),
        "yellow": (249, 171, 0),
    }

    regions = [
        ("blue", pad, pad, half - gap, half - gap),
        ("red", half + gap, pad, size - pad, half - gap),
        ("green", pad, half + gap, half - gap, size - pad),
        ("yellow", half + gap, half + gap, size - pad, size - pad),
    ]

    for y in range(size):
        row = []
        for x in range(size):
            placed = False
            for color_name, x1, y1, x2, y2 in regions:
                if x1 <= x < x2 and y1 <= y < y2:
                    r, g, b = colors[color_name]
                    # Round corners
                    corner_r = max(1, size // 10)
                    dx = min(x - x1, x2 - 1 - x)
                    dy = min(y - y1, y2 - 1 - y)
                    if dx < corner_r and dy < corner_r:
                        dist_sq = (corner_r - dx - 1) ** 2 + (corner_r - dy - 1) ** 2
                        if dist_sq > corner_r ** 2:
                            row.extend([255, 255, 255, 0])
                            placed = True
                            break
                    row.extend([r, g, b, 255])
                    placed = True
                    break
            if not placed:
                row.extend([255, 255, 255, 0])
        pixels.append(bytes([0] + row))  # filter byte + RGBA

    raw = b"".join(pixels)
    compressed = zlib.compress(raw)

    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")
    return png

for s in [16, 32, 48, 128]:
    with open(f"icons/icon{s}.png", "wb") as f:
        f.write(create_png(s))
    print(f"Created icon{s}.png")
