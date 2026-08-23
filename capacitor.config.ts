import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.xsutra.mobile',
  appName: 'X-sutra',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#100d0e'
  }
}

export default config
