"""Generate fancystats icons: football on rising bar chart, accent green."""
import math
from PIL import Image, ImageDraw

S = 720  # render 4x, downscale for anti-aliasing
GREEN = (31, 122, 77, 255)
INK = (23, 34, 43, 255)

def draw_mark(d):
    bw, gap, base = 150, 55, S - 70
    heights = [200, 320, 440]
    for i, h in enumerate(heights):
        x = 65 + i * (bw + gap)
        d.rounded_rectangle([x, base - h, x + bw, base], radius=42, fill=GREEN)
    # football perched on the tallest bar
    cx = 65 + 2 * (bw + gap) + bw // 2
    cy, r = base - heights[2] - 105, 88
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255), outline=INK, width=12)
    pts = [(cx + 0.45 * r * math.sin(i * 2 * math.pi / 5),
            cy - 0.45 * r * math.cos(i * 2 * math.pi / 5)) for i in range(5)]
    d.polygon(pts, fill=INK)
    for px, py in pts:
        d.line([px, py, cx + (px - cx) * 2.1, cy + (py - cy) * 2.1], fill=INK, width=10)

# transparent favicon
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw_mark(ImageDraw.Draw(img))
img.resize((180, 180), Image.LANCZOS).save("public/icon-180.png")

# iOS home-screen tile (solid light background; iOS renders transparency as black)
tile = Image.new("RGBA", (S, S), (244, 246, 247, 255))
draw_mark(ImageDraw.Draw(tile))
tile.resize((180, 180), Image.LANCZOS).save("public/icon-touch-180.png")
print("wrote public/icon-180.png, public/icon-touch-180.png")
