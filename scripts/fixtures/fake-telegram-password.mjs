// Stub for `teleproto/Password.js`: the real computeCheck derives an SRP proof
// from Telegram's password parameters. The login flow only forwards its result
// back to auth.CheckPassword, so echoing the password keeps the 2FA path
// testable (the fake client compares it against the scenario password).

export const computeCheck = async (_passwordInfo, password) => String(password)
