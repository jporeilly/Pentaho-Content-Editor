# The editor's app icon, drawn by the Content Manager's icon generator.
#
# The suite's 2026 branding is one composition - a black tile with a white
# capital P - plus a per-app BADGE, which is the only thing that tells the
# taskbar pins apart at 24 px: the Glossary a term tag, Insights a bar
# chart, Policy a shield, the Content Manager a mortarboard cap. The
# editor takes the PENCIL, which its generator already knew how to draw.
#
# That generator lives over there (`<PCM>/scripts/make-icons.py`) and is
# called as a SUBPROCESS rather than imported: it is a script, not a
# module, and importing it would run its top-level code and overwrite the
# Content Manager's own icons. `--installer-ico` writes one file and exits,
# which is exactly the seam we want.
#
# Not copied here for the same reason the renderer is not copied: two
# drawings of one brand diverge, and the brand has already moved once
# (the swirl and the red are retired). One source, reached into.
#
#   python desktop/scripts/make-icons.py
#
# Then rebuild - cargo does NOT track icon.ico as a build input, so an
# icon-only change needs `cargo clean --release -p pentaho-content-editor-desktop`
# first or the cached exe keeps the old icon embedded. That one bit the
# Policy build and was only caught by extracting the installed exe's icon.

import os
import subprocess
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)
REPO = os.path.dirname(DESKTOP)
ICONS = os.path.join(DESKTOP, "src-tauri", "icons")

# The same resolution rule as every other hook into the Content Manager:
# PCM_REPO, else the sibling directory. See api/core.py and vite.config.ts.
PCM = os.environ.get("PCM_REPO") or os.path.join(os.path.dirname(REPO), "Pentaho-Content-Manager")
GENERATOR = os.path.join(PCM, "scripts", "make-icons.py")

# Teal, deliberately far from the Content Manager's course amber: the two
# sit next to each other on an author's taskbar, and at tray size only the
# badge COLOUR separates them.
BADGE = "pencil"
BADGE_COLOR = "#0E7490"

# The installer wizard's art, from the same composition. Without these
# the editor gets Tauri's stock grey wizard while every sibling app shows
# the black Pentaho header and sidebar - the install is the first thing
# an author sees, and looking borrowed is a poor opening. The sidebar's
# second line is ours because the generator's default is course wording,
# which this is not.
SIDEBAR_TITLE = "Content Editor"
SIDEBAR_SUBTITLE = "Course authoring"


def main():
    if not os.path.isfile(GENERATOR):
        sys.exit(
            "Cannot find the Content Manager's icon generator at {}.\n"
            "Set PCM_REPO to the app's repository root.".format(GENERATOR)
        )

    os.makedirs(ICONS, exist_ok=True)
    ico_path = os.path.join(ICONS, "icon.ico")

    # The app icon. --installer-ico writes one file and exits, which is
    # the seam that leaves the Content Manager's own icons alone.
    subprocess.run(
        [sys.executable, GENERATOR,
         "--installer-ico", ico_path,
         "--badge", BADGE,
         "--badge-color", BADGE_COLOR],
        check=True,
        cwd=PCM,
    )

    # The wizard art. --nsis-only skips the app icons entirely, and
    # --out-dir keeps the bitmaps here rather than in that repo.
    subprocess.run(
        [sys.executable, GENERATOR,
         "--nsis-only",
         "--out-dir", ICONS,
         "--title", SIDEBAR_TITLE,
         "--subtitle", SIDEBAR_SUBTITLE,
         # The same badge as the app icon. Without these the sidebar
         # draws the generator's DEFAULT badge - the Content Manager's
         # amber mortarboard - so the wizard would announce one app while
         # installing another, which is the single thing the per-app
         # badge exists to prevent.
         "--badge", BADGE,
         "--badge-color", BADGE_COLOR],
        check=True,
        cwd=PCM,
    )

    # The PNGs Tauri's bundle.icon list names. Taken from the .ico's
    # LARGEST frame and only ever scaled DOWN - an upscale of a 32 px
    # frame is what a blurry taskbar icon is made of.
    with Image.open(ico_path) as ico:
        ico.size = max(ico.ico.sizes())
        master = ico.convert("RGBA")

    for name, size in (("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)):
        master.resize((size, size), Image.LANCZOS).save(os.path.join(ICONS, name))

    print("icons + wizard art written to {} (badge {} {})".format(ICONS, BADGE, BADGE_COLOR))


if __name__ == "__main__":
    main()
