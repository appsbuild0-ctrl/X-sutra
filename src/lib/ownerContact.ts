/** Owner contact links shown in the premium download panel.
 *  NOTE: replace these with the real Discord invite / Telegram handle. */
export const OWNER_CONTACT = {
  discord: 'https://discord.gg/xsutra',
  telegram: 'https://t.me/xsutra',
} as const

export type OwnerContactChannel = keyof typeof OWNER_CONTACT
