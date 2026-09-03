#!/usr/bin/env node
/**
 * Regenerates the Android launcher icons from public/redgrab-logo.svg.
 *
 * - Legacy ic_launcher / ic_launcher_round PNGs: full logo tile (dark rounded
 *   square + flame) at every mipmap density.
 * - Adaptive ic_launcher_foreground PNGs: flame artwork only, centred inside
 *   the ~66% safe zone of a transparent canvas, so the system mask (circle /
 *   squircle) never clips the flame. The adaptive background is the same dark
 *   colour baked into the SVG (#0a0a0a), see res/values/ic_launcher_background.xml.
 *
 * Run: node scripts/generate-launcher-icons.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = path.join(root, 'public', 'redgrab-logo.svg')
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res')

const svg = await readFile(svgPath, 'utf8')
// Flame-only variant: drop the rounded-square background rect.
const flameSvg = svg.replace(/<rect[^>]*\/>/g, '')

/** density bucket -> legacy icon edge (px) and adaptive foreground edge (px) */
const DENSITIES = [
  ['mipmap-mdpi', 48, 108],
  ['mipmap-hdpi', 72, 162],
  ['mipmap-xhdpi', 96, 216],
  ['mipmap-xxhdpi', 144, 324],
  ['mipmap-xxxhdpi', 192, 432]
]

for (const [folder, legacy, foreground] of DENSITIES) {
  const dir = path.join(resDir, folder)

  const tile = await sharp(Buffer.from(svg), { density: 300 })
    .resize(legacy, legacy)
    .png()
    .toBuffer()
  await sharp(tile).toFile(path.join(dir, 'ic_launcher.png'))
  await sharp(tile).toFile(path.join(dir, 'ic_launcher_round.png'))

  // Flame occupies ~60% of the adaptive canvas (safe zone is inner 66%).
  const flameEdge = Math.round(foreground * 0.6)
  const flame = await sharp(Buffer.from(flameSvg), { density: 300 })
    .resize(flameEdge, flameEdge, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const offset = Math.round((foreground - flameEdge) / 2)
  await sharp({
    create: {
      width: foreground,
      height: foreground,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: flame, left: offset, top: offset }])
    .png()
    .toFile(path.join(dir, 'ic_launcher_foreground.png'))

  console.log(`ok ${folder}: launcher ${legacy}px, foreground ${foreground}px`)
}

// Splash screens: dark flame tile so launch matches the brand.
const SPLASH = [
  ['drawable-land-mdpi', 320, 240],
  ['drawable-land-hdpi', 480, 320],
  ['drawable-land-xhdpi', 640, 480],
  ['drawable-land-xxhdpi', 960, 720],
  ['drawable-land-xxxhdpi', 1280, 960],
  ['drawable-port-mdpi', 240, 320],
  ['drawable-port-hdpi', 320, 480],
  ['drawable-port-xhdpi', 480, 640],
  ['drawable-port-xxhdpi', 720, 960],
  ['drawable-port-xxxhdpi', 960, 1280]
]
for (const [folder, width, height] of SPLASH) {
  const edge = Math.round(Math.min(width, height) * 0.42)
  const flame = await sharp(Buffer.from(flameSvg), { density: 300 })
    .resize(edge, edge, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  await sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } }
  })
    .composite([{ input: flame, left: Math.round((width - edge) / 2), top: Math.round((height - edge) / 2) }])
    .png()
    .toFile(path.join(resDir, folder, 'splash.png'))
}
const splashSquare = await sharp(Buffer.from(flameSvg), { density: 300 })
  .resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()
await sharp({ create: { width: 480, height: 480, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } })
  .composite([{ input: splashSquare, left: 144, top: 144 }])
  .png()
  .toFile(path.join(resDir, 'drawable', 'splash.png'))
console.log('ok splash screens regenerated')
