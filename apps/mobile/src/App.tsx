import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppNavigator from './navigation';
import { DevSettings, SafeAreaView, ScrollView, Text, Pressable, StyleSheet, View, LogBox } from 'react-native';
import { captureException, setTag } from './observability';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const queryClient = new QueryClient();

// Reduce intrusive RN warnings that surface as on-screen banners during QA.
LogBox.ignoreLogs(['Sending `error` with no listeners registered.']);

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message?: string; stack?: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: undefined, stack: undefined };
  }

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    return { hasError: true, message, stack };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('AppErrorBoundary', error, info?.componentStack);
    captureException(error, { where: 'AppErrorBoundary', componentStack: info?.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.fallbackRoot}>
          <ScrollView contentContainerStyle={styles.fallbackContent}>
            <Text style={styles.fallbackTitle}>App crashed</Text>
            <Text style={styles.fallbackBody}>{this.state.message}</Text>
            {this.state.stack ? <Text style={styles.fallbackMono}>{this.state.stack}</Text> : null}
            <View style={{ height: 16 }} />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                try {
                  DevSettings.reload();
                } catch {
                  // ignore
                }
              }}
              style={styles.fallbackButton}
            >
              <Text style={styles.fallbackButtonText}>Reload</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // Basic session-scoped tags for crash/error correlation (device install + app runtime).
  React.useEffect(() => {
    try {
      setTag('platform', 'mobile');
      setTag('runtime', 'react-native');
    } catch {
      // ignore
    }
  }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppErrorBoundary>
          <AppNavigator />
        </AppErrorBoundary>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fallbackRoot: { flex: 1, backgroundColor: '#fff' },
  fallbackContent: { padding: 16, paddingBottom: 40 },
  fallbackTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, color: '#111' },
  fallbackBody: { fontSize: 14, color: '#111' },
  fallbackMono: { marginTop: 12, fontSize: 12, color: '#444' },
  fallbackButton: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
  },
  fallbackButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

