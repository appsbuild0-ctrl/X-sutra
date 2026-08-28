import type { PremiumCatalog } from './premium'

/**
 * Upload targeting.
 *
 * The admin picks one channel (and optionally one album) in the upload form and
 * every file in the selection goes there. Nothing here guesses: an explicit pick
 * always wins, and "auto" only falls back to the first usable channel/album so a
 * brand-new install can still upload.
 */

export type UploadKind = 'hero' | 'image' | 'video' | 'album'

export interface UploadSelection {
  channelId: string
  albumId: string
  kind: UploadKind
}

export interface UploadTargets {
  channelId: string
  albumId: string
  channelName: string
  albumName: string
  /** No usable channel exists yet — the caller must create one first. */
  needsChannel: boolean
  /** An album was requested but the channel has none yet. */
  needsAlbum: boolean
  /** Hero posts are not channel content. */
  detached: boolean
}

const NO_TARGETS: UploadTargets = {
  channelId: '',
  albumId: '',
  channelName: '',
  albumName: '',
  needsChannel: false,
  needsAlbum: false,
  detached: true
}

export function isUsableChannel(channel: PremiumCatalog['channels'][number]): boolean {
  return Boolean(channel?.id) && channel.status !== 'off'
}

export function resolveUploadTargets(catalog: PremiumCatalog, selection: UploadSelection): UploadTargets {
  if (!catalog || selection.kind === 'hero') return { ...NO_TARGETS }

  const channels = Array.isArray(catalog.channels) ? catalog.channels : []
  const albums = Array.isArray(catalog.albums) ? catalog.albums : []

  const picked = channels.find((channel) => channel.id === selection.channelId)
  const channel = picked && isUsableChannel(picked) ? picked : channels.find(isUsableChannel)
  const channelId = channel?.id ?? ''

  const wantedAlbum = albums.find((album) => album.id === selection.albumId && album.published !== false)
  const albumMatchesChannel = wantedAlbum && (!wantedAlbum.channelId || !channelId || wantedAlbum.channelId === channelId)
  const album = albumMatchesChannel
    ? wantedAlbum
    : albums.find((entry) => entry.published !== false && (!channelId || entry.channelId === channelId || !entry.channelId))

  return {
    channelId,
    albumId: album?.id ?? '',
    channelName: channel?.name ?? '',
    albumName: album?.name ?? '',
    needsChannel: !channelId,
    needsAlbum: selection.kind === 'album' && !album?.id,
    detached: false
  }
}

/**
 * Map every selected file onto the resolved target. Returned as an explicit list
 * so the upload loop cannot silently drop the channel id for some files — that
 * is what used to scatter a multi-file upload across auto-created channels.
 */
export function assignFiles<T extends { file: File }>(
  queue: T[],
  targets: UploadTargets
): Array<{ item: T; channelId: string; albumId: string; channelName: string }> {
  return (Array.isArray(queue) ? queue : []).map((item) => ({
    item,
    channelId: targets.detached ? '' : targets.channelId,
    albumId: targets.detached ? '' : targets.albumId,
    channelName: targets.detached ? '' : targets.channelName
  }))
}
