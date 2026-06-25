import os
import shutil
from PIL import Image

# Define paths
WORKSPACE_DIR = "/home/sim/www/Extensions/TabManager/extension-2.0"
ASSETS_DIR = os.path.join(WORKSPACE_DIR, "store-assets")

# AI-generated image source paths with built-in text
SRC_PROMO_SMALL = "/home/sim/.gemini/antigravity-cli/brain/4664ae68-1d27-4e85-9ce0-019d70f0fb93/small_promo_full_1782388307810.jpg"
SRC_PROMO_LARGE = "/home/sim/.gemini/antigravity-cli/brain/4664ae68-1d27-4e85-9ce0-019d70f0fb93/large_promo_full_1782388325759.jpg"
SRC_PROMO_MARQUEE = "/home/sim/.gemini/antigravity-cli/brain/4664ae68-1d27-4e85-9ce0-019d70f0fb93/marquee_promo_full_1782388344633.jpg"

SRC_SCREENSHOT_DASHBOARD = "/home/sim/.gemini/antigravity-cli/brain/4664ae68-1d27-4e85-9ce0-019d70f0fb93/screenshot_dashboard_1782387969665.jpg"
SRC_SCREENSHOT_TASKS = "/home/sim/.gemini/antigravity-cli/brain/4664ae68-1d27-4e85-9ce0-019d70f0fb93/screenshot_tasks_1782387994694.jpg"
SRC_SCREENSHOT_SYNC = "/home/sim/.gemini/antigravity-cli/brain/4664ae68-1d27-4e85-9ce0-019d70f0fb93/screenshot_sync_1782388015673.jpg"

ICON_PATH = os.path.join(WORKSPACE_DIR, "public/icons/icon128.png")

def ensure_dirs():
    if not os.path.exists(ASSETS_DIR):
        os.makedirs(ASSETS_DIR)
        print(f"Created directory: {ASSETS_DIR}")

def resize_and_crop(img_path, target_width, target_height):
    """Resizes and crops an image to the exact target dimensions with center crop."""
    img = Image.open(img_path)
    target_aspect = target_width / target_height
    current_width, current_height = img.size
    current_aspect = current_width / current_height

    if current_aspect > target_aspect:
        # Image is wider than target aspect, scale by height
        new_height = target_height
        new_width = int(new_height * current_aspect)
        resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        # Crop horizontally (center crop)
        left = (new_width - target_width) // 2
        right = left + target_width
        top = 0
        bottom = target_height
        cropped = resized.crop((left, top, right, bottom))
    else:
        # Image is taller than target aspect, scale by width
        new_width = target_width
        new_height = int(new_width / current_aspect)
        resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        # Crop vertically (center crop)
        left = 0
        right = target_width
        top = (new_height - target_height) // 2
        bottom = top + target_height
        cropped = resized.crop((left, top, right, bottom))
    return cropped

def build_promo_tiles():
    """Processes, resizes, and crops promotional tiles to correct dimensions."""
    # Small Promo: 440x280
    small_promo = resize_and_crop(SRC_PROMO_SMALL, 440, 280)
    out_small = os.path.join(ASSETS_DIR, "small_promo.png")
    small_promo.save(out_small, "PNG")
    print(f"Resized small promo tile (440x280) at: {out_small}")

    # Large Promo: 920x680
    large_promo = resize_and_crop(SRC_PROMO_LARGE, 920, 680)
    out_large = os.path.join(ASSETS_DIR, "large_promo.png")
    large_promo.save(out_large, "PNG")
    print(f"Resized large promo tile (920x680) at: {out_large}")

    # Marquee Promo: 1400x560
    marquee_promo = resize_and_crop(SRC_PROMO_MARQUEE, 1400, 560)
    out_marquee = os.path.join(ASSETS_DIR, "marquee_promo.png")
    marquee_promo.save(out_marquee, "PNG")
    print(f"Resized marquee promo image (1400x560) at: {out_marquee}")

def build_screenshots():
    """Processes, resizes, and crops all mock screenshots to exactly 1280x800."""
    screenshots = [
        (SRC_SCREENSHOT_DASHBOARD, "screenshot1.png"),
        (SRC_SCREENSHOT_TASKS, "screenshot2.png"),
        (SRC_SCREENSHOT_SYNC, "screenshot3.png"),
    ]
    
    for src_path, name in screenshots:
        cropped = resize_and_crop(src_path, 1280, 800)
        out_path = os.path.join(ASSETS_DIR, name)
        cropped.save(out_path, "PNG")
        print(f"Generated screenshot {name} (1280x800) at: {out_path}")

def copy_store_icon():
    """Copies the 128x128 store icon to the store-assets folder."""
    dest = os.path.join(ASSETS_DIR, "icon128.png")
    shutil.copy(ICON_PATH, dest)
    print(f"Copied icon128.png to: {dest}")

if __name__ == "__main__":
    ensure_dirs()
    copy_store_icon()
    build_promo_tiles()
    build_screenshots()
    print("\nAll Chrome Web Store listing assets generated successfully inside 'store-assets/'!")
