import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vinegar.assistant',
  appName: 'Vinegar',
  webDir: 'out',
  server: {
    // Point to your desktop server IP on your local network
    // Set VINEGAR_SERVER_URL in .env.local or change the default below
    url: process.env.VINEGAR_SERVER_URL || 'http://192.168.1.15:3000',
    cleartext: true,
    androidScheme: 'http',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      splashFullScreen: true,
      splashImmersive: true,
      backgroundColor: '#050508',
    },
  },
};

export default config;
