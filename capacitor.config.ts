import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.codeblackwx.ops',
  appName: 'Code Black OPS',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#070707',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#070707',
    },
    SystemBars: {
      hidden: true,
      style: 'DARK',
      insetsHandling: 'disable',
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
};

export default config;
