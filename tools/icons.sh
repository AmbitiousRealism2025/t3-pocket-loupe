#!/usr/bin/env bash
# Renders the app icons from the authored SVGs in public/icons/ (rsvg-convert + ImageMagick).
#   icon-192.png, icon-512.png      purpose "any" (rounded square, transparent corners)
#   icon-maskable-512.png           purpose "maskable" (full bleed, art in the safe zone)
#   apple-touch-icon.png            180x180, opaque: iOS paints transparency black (NW-INS-005)
set -euo pipefail
cd "$(dirname "$0")/../public/icons"
bg="#16161e"
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 512 -h 512 icon-maskable.svg -o icon-maskable-512.png
rsvg-convert -w 180 -h 180 icon.svg -o apple-touch-icon.tmp.png
magick apple-touch-icon.tmp.png -background "$bg" -alpha remove -alpha off PNG24:apple-touch-icon.png
rm -f apple-touch-icon.tmp.png
magick identify icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png
