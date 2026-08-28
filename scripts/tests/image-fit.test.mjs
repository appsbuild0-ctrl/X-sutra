import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { UNCROPPED_IMAGE_STYLE, aspectOf, isUncroppedImage, naturalFrameStyle } from '../../src/lib/imageFit.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => readFile(join(root, relative), 'utf8')

describe('uncropped image sizing', () => {
  it('computes the real aspect ratio', () => {
    assert.equal(aspectOf(1080, 1920), 0.5625)
    assert.equal(aspectOf(1920, 1080), 1920 / 1080)
    assert.equal(aspectOf(0, 0), null)
    assert.equal(aspectOf(undefined, 400), null)
    assert.equal(aspectOf(-10, 10), null)
  })

  it('sizes the frame from the media itself, and forces nothing when unknown', () => {
    assert.deepEqual(naturalFrameStyle(1080, 1920), { aspectRatio: '1080 / 1920' })
    assert.deepEqual(naturalFrameStyle(0, 0), {})
    assert.deepEqual(naturalFrameStyle(), {})
  })

  it('never crops an image, whatever the orientation', () => {
    assert.equal(UNCROPPED_IMAGE_STYLE.objectFit, 'contain')
    assert.equal(UNCROPPED_IMAGE_STYLE.height, 'auto')
    assert.equal(UNCROPPED_IMAGE_STYLE.width, '100%')
  })

  it('only treats images as uncropped', () => {
    assert.equal(isUncroppedImage({ type: 'image' }), true)
    assert.equal(isUncroppedImage({ type: 'video' }), false)
    assert.equal(isUncroppedImage({ videoUrl: 'https://x/clip.mp4' }), false)
    assert.equal(isUncroppedImage({ previewUrl: 'https://x/clip.webm?t=1' }), false)
    assert.equal(isUncroppedImage({ videoUrl: '' }), true)
  })
})

describe('premium image display is not cropped in CSS', () => {
  const ruleFor = (css, selector) => {
    const start = css.indexOf(selector)
    assert.ok(start >= 0, `selector not found: ${selector}`)
    const open = css.indexOf('{', start)
    const close = css.indexOf('}', open)
    return css.slice(open, close)
  }

  it('fits premium images inside their own frame', async () => {
    const css = await read('src/styles.css')
    const image = ruleFor(css, '.premium-image img')
    assert.match(image, /object-fit: contain/)
    assert.match(image, /height: auto/)
    assert.doesNotMatch(image, /cover/)
  })

  it('no longer puts .premium-image in the fixed-ratio cover group', async () => {
    const css = await read('src/styles.css')
    assert.ok(!css.includes('.premium-album__cover, .premium-image'))
    assert.doesNotMatch(ruleFor(css, '.premium-image {'), /aspect-ratio/)
    assert.doesNotMatch(ruleFor(css, '.premium-image {'), /cover/)
  })

  it('keeps message thumbnails and premium cards uncropped', async () => {
    const css = await read('src/styles.css')
    assert.match(ruleFor(css, '.msg-image-btn img'), /object-fit: contain/)
    assert.match(ruleFor(css, '.media-card__visual--natural img'), /object-fit: contain/)
    assert.match(ruleFor(css, '.premium-scan-item__thumb'), /object-fit: contain/)
    assert.match(ruleFor(css, '.discord-imported__item img'), /object-fit: contain/)
  })

  it('renders <img> elements instead of a cropped background image', async () => {
    for (const screen of ['src/screens/PremiumChannelScreen.tsx', 'src/screens/PremiumAlbumScreen.tsx', 'src/screens/PremiumHotpicAlbumScreen.tsx']) {
      const source = await read(screen)
      const premiumImageBlock = source.slice(source.indexOf('className="premium-image"'))
      assert.match(premiumImageBlock.slice(0, 400), /<img /, `${screen} should render an <img>`)
      assert.doesNotMatch(premiumImageBlock.slice(0, 400), /backgroundImage/, `${screen} should not crop via background-image`)
    }
  })
})
