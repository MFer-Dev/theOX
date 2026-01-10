import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './src/App';

// Capture uncaught JS errors to surface stack traces in Metro
if (typeof ErrorUtils !== 'undefined' && typeof ErrorUtils.setGlobalHandler === 'function') {
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    // eslint-disable-next-line no-console
    console.error('GlobalError', isFatal, error?.message, error?.stack);
    throw error;
  });
}

AppRegistry.registerComponent('GenMobile', () => App);

