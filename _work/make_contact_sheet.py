from pathlib import Path
from PIL import Image, ImageDraw

source = Path(r"C:\Users\Bewo\Desktop\rastwebapp_operasyon\_work\renders")
files = sorted(source.glob("*.png"))
thumb_w, thumb_h, label_h = 420, 260, 24
cols = 4
rows = (len(files) + cols - 1) // cols
canvas = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "white")
draw = ImageDraw.Draw(canvas)
for index, file in enumerate(files):
    image = Image.open(file).convert("RGB")
    image.thumbnail((thumb_w - 12, thumb_h - 12))
    x = (index % cols) * thumb_w + (thumb_w - image.width) // 2
    y0 = (index // cols) * (thumb_h + label_h)
    y = y0 + (thumb_h - image.height) // 2
    canvas.paste(image, (x, y))
    draw.text((index % cols * thumb_w + 8, y0 + thumb_h + 3), file.stem, fill="black")
canvas.save(source / "contact-sheet.jpg", quality=88)
