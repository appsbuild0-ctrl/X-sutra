// In-memory stand-in for `teleproto` (the MTProto client) so the real Telegram
// login code can be driven without a Telegram account or any network access.
//
// Loaded by scripts/verify-telegram-login.mjs through module.registerHooks;
// every scenario knob lives on globalThis.__telegramSim and is set by that
// script. Only the surface used by netlify/functions/_server/telegram.mjs
// exists here: StringSession, TelegramClient, Api.auth.SignIn,
// Api.auth.CheckPassword, Api.account.GetPassword.

const sim = () => (globalThis.__telegramSim ??= {})

export function rpcError(errorMessage) {
  return Object.assign(new Error(errorMessage), { errorMessage })
}

class StringSession {
  constructor(initial = '') { this.initial = initial }
  save() { return sim().sessionString ?? 'fake-session-string' }
}

class TelegramClient {
  constructor(session) {
    this.session = session
    sim().connects = (sim().connects ?? 0) + 1
  }

  async connect() {
    if (sim().connectError) throw Object.assign(new Error(sim().connectError), { statusCode: 502 })
  }

  async isUserAuthorized() { return Boolean(sim().authorized) }

  async sendCode(_credentials, phone) {
    if (sim().sendCodeError) throw rpcError(sim().sendCodeError)
    sim().sentPhones = [...(sim().sentPhones ?? []), phone]
    return { phoneCodeHash: sim().phoneCodeHash ?? 'fake-hash', isCodeViaApp: Boolean(sim().codeViaApp) }
  }

  async invoke(request) {
    if (request?.__kind === 'SignIn') {
      sim().signInPhones = [...(sim().signInPhones ?? []), String(request.phoneNumber)]
      if (String(request.phoneCode) !== String(sim().code ?? '12345')) throw rpcError(sim().wrongCodeError ?? 'PHONE_CODE_INVALID')
      if (sim().require2fa) throw rpcError('SESSION_PASSWORD_NEEDED')
      sim().authorized = true
      return { user: { id: sim().userId ?? '4242' } }
    }
    if (request?.__kind === 'GetPassword') return { newAlgo: 'fake-algo' }
    if (request?.__kind === 'CheckPassword') {
      if (String(request.password) !== String(sim().twoFactorPassword ?? 'cloud-password')) throw rpcError('PASSWORD_HASH_INVALID')
      sim().authorized = true
      return { user: { id: sim().userId ?? '4242' } }
    }
    throw new Error(`Unexpected Telegram request: ${request?.__kind}`)
  }

  async getDialogs() { return sim().dialogs ?? [] }

  async disconnect() { sim().disconnects = (sim().disconnects ?? 0) + 1 }
}

const requestClass = (kind) => class {
  constructor(fields = {}) {
    Object.assign(this, fields)
    this.__kind = kind
  }
}

const Api = {
  auth: { SignIn: requestClass('SignIn'), CheckPassword: requestClass('CheckPassword') },
  account: { GetPassword: requestClass('GetPassword') }
}

export default { TelegramClient, Api, sessions: { StringSession } }
