/** Owner contact links shown in the premium download panel.
 *  Each channel carries the owner's public handle (shown to the user) and the
 *  real invite / DM URL that opens when the button is tapped. */
export const OWNER_CONTACT = {
  discord: {
    label: 'Discord',
    handle: 'GodxEye0',
    url: 'https://discord.gg/PsMq5j3Xjv'
  },
  telegram: {
    label: 'Telegram',
    handle: 'GodxEye0',
    url: 'https://t.me/GodxEye0'
  }
} as const

export type OwnerContactChannel = keyof typeof OWNER_CONTACT
