// The payment QR modal counts down a 119-second window and must render it in
// m:ss — "1:59", "1:00", "0:09" — never bare seconds ("119s"). Regression
// guard for the countdown formatter the modal renders.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { durationLabel } from '../../src/lib/format.ts'

test('payment countdown renders the 119s window as m:ss, never bare seconds', () => {
  assert.equal(durationLabel(119), '1:59')
  assert.equal(durationLabel(65), '1:05')
  assert.equal(durationLabel(60), '1:00')
  assert.equal(durationLabel(9), '0:09')
})
