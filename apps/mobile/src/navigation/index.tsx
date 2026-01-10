import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TamaguiProvider, Theme, useThemeName, XStack, YStack } from 'tamagui';
import { Bell, Settings, House, Search, Plus, Mail } from '@tamagui/lucide-icons';
import { apiClient } from '../api/client';
import AuthWelcome from '../screens/auth/Welcome';
import AuthLogin from '../screens/auth/Login';
import AuthRegister from '../screens/auth/Register';
import AuthTour from '../screens/auth/Tour';
import AuthOTP from '../screens/auth/OTP';
import AuthForgot from '../screens/auth/Forgot';
import AuthReset from '../screens/auth/Reset';
import AuthTwoFA from '../screens/auth/TwoFA';
import AuthSessions from '../screens/auth/Sessions';
import OnbGeneration from '../screens/onboarding/Generation';
import OnbVerifyGen from '../screens/onboarding/VerifyGeneration';
import TrybeConfirm from '../screens/onboarding/TrybeConfirm';
import OnbTour from '../screens/onboarding/Tour';
import OnbNotifications from '../screens/onboarding/Notifications';
import HomeFeed from '../screens/home/HomeFeed';
import ComposeEntry from '../screens/home/ComposeEntry';
import ThreadView from '../screens/home/ThreadView';
import ContentDetail from '../screens/content/ContentDetail';
import Profile from '../screens/profile/Profile';
import ProfileOther from '../screens/profile/ProfileOther';
import EditProfile from '../screens/profile/EditProfile';
import BlockUserScreen from '../screens/profile/BlockUser';
import BlockedUserScreen from '../screens/profile/BlockedUser';
import DraftList from '../screens/drafts/DraftList';
import StatusScreen from '../screens/status/Status';
import { sessionStore } from '../storage/session';
import AuthLogout from '../screens/auth/Logout';
import VerifyIntro from '../screens/auth/VerifyIntro';
import VerifyMethod from '../screens/auth/VerifyMethod';
import VerifySuccess from '../screens/auth/VerifySuccess';
import FeatureFlags from '../screens/dev/FeatureFlags';
import DevToolsScreen from '../screens/dev/DevTools';
import SplashScreen from '../screens/entry/Splash';
import SettingsHome from '../screens/settings/SettingsHome';
import AccountSettings from '../screens/settings/AccountSettings';
import PreferencesScreen from '../screens/settings/Preferences';
import AccessibilityScreen from '../screens/settings/Accessibility';
import PrivacySafetyScreen from '../screens/settings/PrivacySafety';
import BlockedUsersScreen from '../screens/settings/BlockedUsers';
import AboutScreen from '../screens/settings/About';
import TrustTransparency from '../screens/settings/TrustTransparency';
import LegalAccept from '../screens/legal/LegalAccept';
import TermsScreen from '../screens/legal/Terms';
import PrivacyScreen from '../screens/legal/Privacy';
import LicensesScreen from '../screens/legal/Licenses';
import ReportEntryScreen from '../screens/safety/ReportEntry';
import ReportDetailsScreen from '../screens/safety/ReportDetails';
import ReportConfirmScreen from '../screens/safety/ReportConfirm';
import RestrictionNoticeScreen from '../screens/safety/RestrictionNotice';
import ModerationOutcomeScreen from '../screens/safety/ModerationOutcome';
import NotificationList from '../screens/notifications/NotificationList';
import NotificationDetail from '../screens/notifications/NotificationDetail';
import SearchScreen from '../screens/search/Search';
import InboxScreen from '../screens/inbox/Inbox';
import InboxThreadScreen from '../screens/inbox/Thread';
import ListsHomeScreen from '../screens/lists/ListsHome';
import ListTimelineScreen from '../screens/lists/ListTimeline';
import TopicTimelineScreen from '../screens/topics/TopicTimeline';
import ListAddItemsScreen from '../screens/lists/ListAddItems';
import ListEditScreen from '../screens/lists/ListEdit';
import SafetyHome from '../screens/safety/SafetyHome';
import CredLedger from '../screens/cred/CredLedger';
import config from '../../tamagui.config';
import { IconButton, AppText } from '../ui';
import { BrandWordmark } from '../ui';
import { Pressable as RNPressable } from 'react-native';
import { appearanceStore, type AppearanceMode } from '../storage/appearance';
import { useColorScheme } from 'react-native';
import { Avatar } from '../ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GatheringCollapseOverlay } from '../screens/gathering/CollapseOverlay';
import { GatheringEnterOverlay } from '../screens/gathering/EnterOverlay';
import { GatheringOfframpOverlay } from '../screens/gathering/OfframpOverlay';
import { WorldProvider } from '../providers/world';
import { startWorldStream } from '../realtime/worldStream';

const AuthStack = createNativeStackNavigator();
const OnbStack = createNativeStackNavigator();
const MainTabs = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

const headerStyles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  headerAction: { paddingHorizontal: 8, paddingVertical: 6 },
  headerActionText: { fontSize: 12, fontWeight: '600' },
});

const HeaderActions = ({ onNotifications, onSettings }: { onNotifications: () => void; onSettings: () => void }) => {
  return (
    <View style={headerStyles.headerActions}>
      <IconButton icon={Bell} label="Notifications" onPress={onNotifications} />
      <IconButton icon={Settings} label="Settings" onPress={onSettings} />
    </View>
  );
};

const fmtWorldCountdown = (ms?: number | null) => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};

function WorldChip({ label, subtle }: { label: string; subtle?: boolean }) {
  return (
    <XStack
      paddingHorizontal={10}
      paddingVertical={6}
      borderRadius={999}
      backgroundColor={subtle ? 'rgba(229,231,235,0.10)' : 'rgba(239,68,68,0.18)'}
      borderWidth={1}
      borderColor={subtle ? 'rgba(229,231,235,0.14)' : 'rgba(239,68,68,0.30)'}
      alignItems="center"
      justifyContent="center"
    >
      <AppText variant="caption" fontWeight="800" color={subtle ? '#E5E7EB' : '#FCA5A5'}>
        {label}
      </AppText>
    </XStack>
  );
}

const tabBarStyles = StyleSheet.create({
  composeButton: {
    position: 'absolute',
    // Bottom-right, above the tab bar.
    right: 12,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0B0B0F',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
});

function TabBarWithFab(props: any) {
  const [tabBarHeight, setTabBarHeight] = React.useState(56);
  const insets = useSafeAreaInsets();
  const themeName = useThemeName();
  const isDark = String(themeName).includes('dark');
  const isGathering = Boolean(props?.worldActive);
  // Put the FAB ABOVE the tab bar, never overlapping it.
  const bottom = tabBarHeight + 10 + Math.max(0, insets.bottom - 6);

  return (
    <View
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h && h !== tabBarHeight) setTabBarHeight(h);
      }}
    >
      <BottomTabBar {...props} />
      <RNPressable
        accessibilityRole="button"
        accessibilityLabel="Compose"
        style={[
          tabBarStyles.composeButton,
          { bottom, backgroundColor: isGathering ? '#EF4444' : isDark ? '#E5E7EB' : '#0B0B0F' },
        ]}
        onPress={() => props.navigation.navigate('Compose' as never)}
      >
        <Plus color={isGathering ? '#fff' : isDark ? '#0B0B0F' : '#fff'} size={22} />
      </RNPressable>
    </View>
  );
}

const OnboardingFlow = ({
  onComplete,
  token,
  headerBg,
  headerTint,
  contentBg,
}: {
  onComplete: () => void;
  token: string;
  headerBg: string;
  headerTint: string;
  contentBg: string;
}) => (
  <OnbStack.Navigator
    screenOptions={{
      headerShown: true,
      // headerBackTitleVisible is not supported by native-stack types; keep defaults.
      title: '',
      headerStyle: { backgroundColor: headerBg },
      headerTintColor: headerTint,
      contentStyle: { backgroundColor: contentBg },
      headerShadowVisible: false,
    }}
  >
    <OnbStack.Screen name="GenSelect">
      {(props) => <OnbGeneration {...props} token={token} />}
    </OnbStack.Screen>
    <OnbStack.Screen name="GenVerify">
      {(props) => <OnbVerifyGen {...props} token={token} />}
    </OnbStack.Screen>
    <OnbStack.Screen name="TrybeConfirm">
      {(props) => <TrybeConfirm {...props} token={token} />}
    </OnbStack.Screen>
    <OnbStack.Screen name="Tour" component={OnbTour} options={{ headerShown: false }} />
    <OnbStack.Screen name="Notif">
      {(props) => <OnbNotifications {...props} token={token} onDone={onComplete} />}
    </OnbStack.Screen>
  </OnbStack.Navigator>
);

export default function AppNavigator() {
  const [token, setToken] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [legalOk, setLegalOk] = useState(true);
  const [userGen, setUserGen] = useState<string | null>(null);
  const [meHandle, setMeHandle] = useState<string | null>(null);
  const [meName, setMeName] = useState<string | null>(null);
  const [meAvatarUrl, setMeAvatarUrl] = useState<any>(null);
  const [purgeActive, setPurgeActive] = useState(false);
  const [purgeStartsAt, setPurgeStartsAt] = useState<string | null>(null);
  const [purgeEndsAt, setPurgeEndsAt] = useState<string | null>(null);
  const [gatheringEligible, setGatheringEligible] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const splashStartMs = useRef<number>(Date.now());
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>('light');
  const colorScheme = useColorScheme();
  const navRef = useRef<any>(null);
  const prevWorldActive = useRef<boolean>(false);
  const [collapseVisible, setCollapseVisible] = useState(false);
  const [enterVisible, setEnterVisible] = useState(false);
  const [worldActive, setWorldActive] = useState(false);
  const [worldRemainingMs, setWorldRemainingMs] = useState<number | null>(null);
  const [worldEndsAtMs, setWorldEndsAtMs] = useState<number | null>(null);
  const [worldStartsInMs, setWorldStartsInMs] = useState<number | null>(null);
  const expiredForEndAt = useRef<string | null>(null);

  const hydrate = async (tkn: string) => {
    try {
      const me = await apiClient.me(tkn);
      setUserGen(me?.user?.generation ?? null);
      setMeHandle(me?.user?.handle ?? null);
      setMeName(me?.user?.display_name ?? null);
      // Default avatar for dev + missing-avatar cases.
      const defaultAvatar = require('../../../public/profile_avatar.png');
      setMeAvatarUrl((me?.user as any)?.avatar_url ?? defaultAvatar);
      await sessionStore.saveGeneration(me?.user?.generation ?? null);
      const ps = await apiClient.purgeStatus();
      setPurgeActive(ps.active);
      setPurgeStartsAt(ps.starts_at ?? null);
      setPurgeEndsAt(ps.ends_at ?? null);
      const elig = await apiClient.gatheringEligibility(tkn);
      setGatheringEligible(!!elig?.eligible);

      // Gate by policy acceptance (Terms + Privacy). Dev-session skips.
      if (tkn !== 'dev-session') {
        try {
          const st: any = await apiClient.policyStatus(tkn);
          const ok = Boolean(st?.accepted?.terms) && Boolean(st?.accepted?.privacy);
          setLegalOk(ok);
        } catch {
          // If identity doesn't support policy endpoints yet, fail closed to be safe.
          setLegalOk(false);
        }
      } else {
        setLegalOk(true);
      }
    } catch (err) {
      // ignore hydrate errors for now
    }
  };

  useEffect(() => {
    const boot = async () => {
      const storedToken = await sessionStore.getToken();
      const storedOnboard = await sessionStore.getOnboarded();
      const storedAppearance = await appearanceStore.getMode();
      if (storedToken) {
        setToken(storedToken);
        await hydrate(storedToken);
      }
      setOnboarded(storedOnboard);
      setAppearanceMode(storedAppearance);
      // Ensure splash is visible long enough to feel intentional.
      const MIN_SPLASH_MS = 1400;
      const elapsed = Date.now() - splashStartMs.current;
      const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setLoading(false);
    };
    boot();
  }, []);

  // Live updates when the user changes Appearance in Settings.
  useEffect(() => {
    const unsub = appearanceStore.subscribe((m) => setAppearanceMode(m));
    return () => unsub();
  }, []);

  useEffect(() => {
    const ms = purgeEndsAt ? new Date(purgeEndsAt).getTime() : null;
    setWorldEndsAtMs(Number.isFinite(ms as any) ? (ms as number) : null);
  }, [purgeEndsAt]);

  // Countdown until the Gathering begins (when scheduled in the future).
  useEffect(() => {
    if (!purgeStartsAt) {
      setWorldStartsInMs(null);
      return;
    }
    const startsAtMs = new Date(purgeStartsAt).getTime();
    if (!Number.isFinite(startsAtMs)) {
      setWorldStartsInMs(null);
      return;
    }
    const tick = () => {
      const rem = startsAtMs - Date.now();
      setWorldStartsInMs(rem > 0 ? rem : 0);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [purgeStartsAt]);

  const expireGatheringNow = useCallback(async () => {
    // Immediately revert the "parallel universe" UI and close any modals (compose, sheets, etc).
    setWorldActive(false);
    setWorldRemainingMs(0);
    try {
      navRef.current?.reset?.({ index: 0, routes: [{ name: 'Main' }] });
    } catch {
      // ignore
    }
    // Trigger the one-time collapse messaging (itself is gated by seen flag).
    if (purgeEndsAt) {
      const seen = await sessionStore.getGatheringSeen(purgeEndsAt);
      if (!seen) setCollapseVisible(true);
    }
  }, [purgeEndsAt]);

  // Drive the Gathering end in real time off ends_at (do not wait for the 60s poll).
  useEffect(() => {
    if (!purgeActive || !worldEndsAtMs) {
      setWorldRemainingMs(null);
      setWorldActive(false);
      return;
    }
    const tick = () => {
      const rem = worldEndsAtMs - Date.now();
      setWorldRemainingMs(rem);
      const activeNow = rem > 0;
      setWorldActive(activeNow);
      if (!activeNow && purgeEndsAt && expiredForEndAt.current !== purgeEndsAt) {
        expiredForEndAt.current = purgeEndsAt;
        expireGatheringNow();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [purgeActive, worldEndsAtMs, purgeEndsAt, expireGatheringNow]);

  // Realtime world clock (SSE over TCP): keeps starts/ends + active in sync without drift.
  // Fallback: if stream fails, we still have the on-device ends_at countdown + the occasional refresh from hydrate.
  useEffect(() => {
    const stop = startWorldStream({
      onEvent: (evt) => {
        const d: any = evt.data ?? {};
        if (typeof d.active === 'boolean') setPurgeActive(Boolean(d.active));
        if (typeof d.starts_at === 'string' || d.starts_at === null) setPurgeStartsAt(d.starts_at ?? null);
        if (typeof d.ends_at === 'string' || d.ends_at === null) setPurgeEndsAt(d.ends_at ?? null);
      },
    });
    return () => stop();
  }, []);

  // One-time “collapse” animation when the Gathering ends (no replay), driven by worldActive (real time).
  useEffect(() => {
    const prev = prevWorldActive.current;
    prevWorldActive.current = worldActive;
    if (!prev || worldActive) return;
    // Hard off-ramp: collapse the parallel universe and discard any in-progress modal work.
    try {
      navRef.current?.reset?.({ index: 0, routes: [{ name: 'Main' }] });
    } catch {
      // ignore
    }
    const endAt = purgeEndsAt;
    if (!endAt) return;
    let alive = true;
    sessionStore
      .getGatheringSeen(endAt)
      .then((seen) => {
        if (!alive) return;
        if (!seen) setCollapseVisible(true);
      })
      .catch(() => {
        if (alive) setCollapseVisible(true);
      });
    return () => {
      alive = false;
    };
  }, [worldActive, purgeEndsAt]);

  // One-time “enter” animation when the Gathering begins (no replay), driven by worldActive.
  useEffect(() => {
    if (!worldActive) return;
    const startAt = purgeStartsAt;
    if (!startAt) return;
    let alive = true;
    sessionStore
      .getGatheringEntered(startAt)
      .then((seen) => {
        if (!alive) return;
        if (!seen) setEnterVisible(true);
      })
      .catch(() => {
        if (alive) setEnterVisible(true);
      });
    return () => {
      alive = false;
    };
  }, [worldActive, purgeStartsAt]);

  const isDarkNow = worldActive || appearanceMode === 'dark' || (appearanceMode === 'system' && colorScheme === 'dark');
  const headerBg = worldActive ? '#070A12' : isDarkNow ? '#0B0B0F' : '#fff';
  const headerTint = isDarkNow ? '#E5E7EB' : '#0B0B0F';
  const contentBg = worldActive ? '#070A12' : isDarkNow ? '#0B0B0F' : '#F6F7F9';

  return (
    <TamaguiProvider config={config}>
      <Theme
        name={
          worldActive
            ? // Gathering is its own dedicated (third) mode regardless of device appearance.
              'purge_dark'
            : appearanceMode === 'dark'
            ? 'default_dark'
            : appearanceMode === 'system' && colorScheme === 'dark'
            ? 'default_dark'
            : 'default'
        }
      >
        {loading ? (
          <SplashScreen />
        ) : (
          <>
            <WorldProvider world={worldActive ? 'gathering' : 'tribal'}>
              <NavigationContainer ref={navRef}>
                <RootStack.Navigator
                  screenOptions={{
                    headerShown: true,
                    // headerBackTitleVisible is not supported by native-stack types; keep defaults.
                    headerStyle: { backgroundColor: headerBg },
                    headerTintColor: headerTint,
                    contentStyle: { backgroundColor: contentBg },
                    headerShadowVisible: false,
                    // iOS: show chevron-only back (no text) + disable menu to keep it predictable.
                    headerBackButtonDisplayMode: 'minimal' as any,
                    headerBackTitleVisible: false as any,
                    headerBackButtonMenuEnabled: false as any,
                  }}
                >
              {!token ? (
                <RootStack.Screen name="Auth" options={{ headerShown: false }}>
                  {() => (
                    <AuthStack.Navigator
                      screenOptions={{
                        headerShown: true,
                        // headerBackTitleVisible is not supported by native-stack types; keep defaults.
                        headerStyle: { backgroundColor: headerBg },
                        headerTintColor: headerTint,
                        contentStyle: { backgroundColor: contentBg },
                        headerShadowVisible: false,
                      }}
                    >
                      <AuthStack.Screen
                        name="Welcome"
                        options={{
                          title: 'Welcome',
                          headerBackVisible: false,
                        }}
                      >
                        {(props) => (
                          <AuthWelcome
                            {...props}
                            onLogin={async () => {
                              const tkn = 'dev-session';
                              setToken(tkn);
                              await sessionStore.saveToken(tkn);
                              await sessionStore.saveOnboarded(true);
                              setOnboarded(true);
                              await hydrate(tkn);
                            }}
                          />
                        )}
                      </AuthStack.Screen>
                      <AuthStack.Screen name="AuthTour" component={AuthTour} options={{ headerShown: false }} />
                      <AuthStack.Screen name="Login" options={{ title: 'Login' }}>
                        {(props) => (
                          <AuthLogin
                            {...props}
                            onAuth={async (tkn) => {
                              setToken(tkn);
                              await sessionStore.saveToken(tkn);
                              await hydrate(tkn);
                            }}
                          />
                        )}
                      </AuthStack.Screen>
                      <AuthStack.Screen name="Register" options={{ title: 'Create Account' }}>
                        {(props) => (
                          <AuthRegister
                            {...props}
                            onRegistered={() => props.navigation.navigate('VerifyIntro')}
                          />
                        )}
                      </AuthStack.Screen>
                      <AuthStack.Screen name="VerifyIntro" component={VerifyIntro} options={{ title: 'Verify' }} />
                      <AuthStack.Screen name="VerifyMethod" component={VerifyMethod} options={{ title: 'Verify' }} />
                      <AuthStack.Screen name="OTP" component={AuthOTP} options={{ title: 'Code' }} />
                      <AuthStack.Screen name="VerifySuccess" component={VerifySuccess} options={{ title: 'Verified' }} />
                      <AuthStack.Screen name="Forgot" component={AuthForgot} options={{ title: 'Forgot' }} />
                      <AuthStack.Screen name="Reset" component={AuthReset} options={{ title: 'Reset' }} />
                      <AuthStack.Screen name="TwoFA" component={AuthTwoFA} options={{ title: '2FA' }} />
                      <AuthStack.Screen name="Sessions" options={{ title: 'Sessions' }}>
                        {(props) => (
                          <AuthSessions
                            {...props}
                            token={token ?? ''}
                            onLogout={async () => {
                              try {
                                if (token && token !== 'dev-session') {
                                  await apiClient.logoutAll?.(token);
                                }
                              } catch {
                                // ignore
                              } finally {
                                setToken(null);
                                await sessionStore.clearAll();
                              }
                            }}
                          />
                        )}
                      </AuthStack.Screen>
                      <AuthStack.Screen name="Logout" options={{ title: 'Logout' }}>
                        {(props) => <AuthLogout {...props} onLogout={() => sessionStore.clearAll()} />}
                      </AuthStack.Screen>
                    </AuthStack.Navigator>
                  )}
                </RootStack.Screen>
              ) : !legalOk ? (
                <>
                  <RootStack.Screen name="LegalAccept" options={{ title: '' }}>
                    {(p) => (
                      <LegalAccept
                        {...p}
                        token={token!}
                        onAccepted={async () => {
                          setLegalOk(true);
                        }}
                      />
                    )}
                  </RootStack.Screen>
                  <RootStack.Screen name="Terms" component={TermsScreen} options={{ title: 'Terms' }} />
                  <RootStack.Screen name="Privacy" component={PrivacyScreen} options={{ title: 'Privacy' }} />
                  <RootStack.Screen name="Licenses" component={LicensesScreen} options={{ title: 'Licenses' }} />
                </>
              ) : !onboarded ? (
                <RootStack.Screen name="Onboarding" options={{ headerShown: false }}>
                  {(props) => (
                    <OnboardingFlow
                      {...props}
                      token={token!}
                      headerBg={headerBg}
                      headerTint={headerTint}
                      contentBg={contentBg}
                      onComplete={async () => {
                        await sessionStore.saveOnboarded(true);
                        setOnboarded(true);
                        props.navigation.reset({
                          index: 0,
                          routes: [{ name: 'Main' as never }],
                        });
                      }}
                    />
                  )}
                </RootStack.Screen>
              ) : (
                <>
                  <RootStack.Screen name="Main" options={{ headerShown: false }}>
                    {() => (
                      <MainTabs.Navigator
                        tabBar={(props) => <TabBarWithFab {...props} worldActive={worldActive} />}
                        screenOptions={({ navigation, route }) => ({
                          headerShown: true,
                          headerTitle: () => {
                            const isGathering = worldActive;
                            const isDarkNow =
                              worldActive || appearanceMode === 'dark' || (appearanceMode === 'system' && colorScheme === 'dark');
                            if (!isGathering) {
                              const scheduled =
                                typeof worldStartsInMs === 'number' &&
                                worldStartsInMs > 0 &&
                                typeof purgeStartsAt === 'string' &&
                                !purgeActive;
                              if (!scheduled) {
                                return <BrandWordmark width={110} height={16} color={isDarkNow ? '#E5E7EB' : '#0B0B0F'} />;
                              }
                              return (
                                <YStack gap="$2">
                                  <XStack alignItems="center" gap="$2">
                                    <AppText variant="title" fontWeight="900" letterSpacing={1} color={isDarkNow ? '#E5E7EB' : '#0B0B0F'}>
                                      GATHERING
                                    </AppText>
                                    <WorldChip label={fmtWorldCountdown(worldStartsInMs)} subtle />
                                  </XStack>
                                  <XStack>
                                    <WorldChip label="Starting soon" subtle />
                                  </XStack>
                                </YStack>
                              );
                            }
                            return (
                              <YStack gap="$2">
                                <XStack alignItems="center" gap="$2">
                                  <AppText variant="title" fontWeight="900" letterSpacing={1} color="#E5E7EB">
                                    GATHERING
                                  </AppText>
                                  <WorldChip label={fmtWorldCountdown(worldRemainingMs)} />
                                </XStack>
                                <XStack>
                                  <WorldChip label="No drafts • No replay" subtle />
                                </XStack>
                              </YStack>
                            );
                          },
                          headerTitleAlign: 'left',
                          // headerBackTitleVisible is not supported by native-stack types; keep defaults.
                          headerTitleContainerStyle: { paddingLeft: 12 },
                          headerRightContainerStyle: { paddingRight: 8 },
                          headerStyle: {
                            backgroundColor:
                              worldActive
                                ? '#070A12'
                                : appearanceMode === 'dark' || (appearanceMode === 'system' && colorScheme === 'dark')
                                  ? '#0B0B0F'
                                  : '#fff',
                          },
                          headerTintColor:
                            worldActive || appearanceMode === 'dark' || (appearanceMode === 'system' && colorScheme === 'dark')
                              ? '#E5E7EB'
                              : '#0B0B0F',
                          tabBarShowLabel: false,
                          tabBarActiveTintColor: '#fff',
                          tabBarInactiveTintColor:
                            worldActive || appearanceMode === 'dark' || (appearanceMode === 'system' && colorScheme === 'dark')
                              ? '#9CA3AF'
                              : '#6B7280',
                          tabBarStyle: {
                            backgroundColor: worldActive ? '#070A12' : '#000',
                            borderTopColor: worldActive ? 'rgba(229,231,235,0.12)' : '#111',
                            paddingTop: 8,
                            paddingBottom: 12,
                            height: 76,
                          },
                          tabBarItemStyle: { justifyContent: 'center', alignItems: 'center' },
                          headerRight: () => (
                            <HeaderActions
                              onNotifications={() => navigation.getParent()?.navigate('Notifications' as never)}
                              onSettings={() => navigation.getParent()?.navigate('SettingsHome' as never)}
                            />
                          ),
                          tabBarIcon: ({ focused, color, size }) => {
                            const iconColor = color;
                            const iconSize: any = 24;
                            if (route.name === 'Home') return <House color={iconColor} size={iconSize} />;
                            if (route.name === 'Search') return <Search color={iconColor} size={iconSize} />;
                            if (route.name === 'Inbox') return <Mail color={iconColor} size={iconSize} />;
                            if (route.name === 'Profile')
                              return (
                                <Avatar
                                  name={meName ?? meHandle ?? 'Me'}
                                  uri={meAvatarUrl}
                                  size={24}
                                  borderWidth={focused ? 2 : 0}
                                  borderColor={focused ? '#E5E7EB' : 'transparent'}
                                />
                              );
                            return <House color={iconColor} size={iconSize} />;
                          },
                        })}
                      >
                        <MainTabs.Screen name="Home" options={{ title: 'Home' }}>
                          {() => (
                            <HomeFeed
                              token={token!}
                              world={worldActive ? 'gathering' : 'tribal'}
                              gatheringStartsAt={purgeStartsAt}
                              gatheringEligible={gatheringEligible}
                            />
                          )}
                        </MainTabs.Screen>
                        <MainTabs.Screen name="Search" options={{ title: 'Search' }}>
                          {() => <SearchScreen token={token!} world={worldActive ? 'gathering' : 'tribal'} />}
                        </MainTabs.Screen>
                        <MainTabs.Screen name="Inbox" options={{ title: 'Inbox' }}>
                          {() => <InboxScreen token={token!} />}
                        </MainTabs.Screen>
                        <MainTabs.Screen name="Profile" options={{ title: 'Profile' }}>
                          {() => <Profile token={token!} />}
                        </MainTabs.Screen>
                      </MainTabs.Navigator>
                    )}
                  </RootStack.Screen>
                  <RootStack.Screen
                    name="Compose"
                    options={{
                      // Use a full-bleed modal; Compose provides its own bottom actions.
                      // This avoids the large white native header band in dark mode.
                      headerShown: false,
                      presentation: 'fullScreenModal',
                    }}
                  >
                    {(p) => <ComposeEntry {...p} token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="InboxThread" options={{ title: '' }}>
                    {(p) => <InboxThreadScreen {...p} token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="ListsHome" options={{ title: 'Lists' }}>
                    {(p) => <ListsHomeScreen {...p} token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="ListTimeline" options={{ title: '' }}>
                    {(p) => <ListTimelineScreen {...p} token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="ListEdit" options={{ title: 'Edit list' }}>
                    {(p) => <ListEditScreen {...p} token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="ListAddItems" options={{ title: 'Add items' }}>
                    {(p) => <ListAddItemsScreen {...p} token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="TopicTimeline" options={{ title: '' }}>
                    {(p) => <TopicTimelineScreen {...p} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="ThreadDetail" options={{ title: 'Thread' }}>
                    {(p) => (
                      <ThreadView
                        {...p}
                        token={token!}
                        userGen={userGen}
                        purgeActive={worldActive}
                      />
                    )}
                  </RootStack.Screen>
                  <RootStack.Screen name="ContentDetail" options={{ title: 'Content' }}>
                    {(p) => <ContentDetail {...p} token={token!} />}
                  </RootStack.Screen>
                  {/* Gathering routes intentionally not exposed in normal mode (Gathering is an app takeover mode). */}
                  <RootStack.Screen name="EditProfile" options={{ title: 'Edit Profile' }}>
                    {(p) => <EditProfile {...p} token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="Drafts" options={{ title: 'Drafts' }}>
                    {(p) => <DraftList {...p} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="ProfileOther" options={{ title: 'Profile' }}>
                    {(p) => <ProfileOther {...p} token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="BlockUser" options={{ title: 'Block User' }}>
                    {(p) => <BlockUserScreen {...p} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="BlockedUser" options={{ title: 'Blocked' }}>
                    {(p) => <BlockedUserScreen {...p} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="SettingsHome" options={{ title: 'Settings' }}>
                    {(p) => <SettingsHome {...p} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="SettingsAccount" options={{ title: 'Account' }}>
                    {(p) => (
                      <AccountSettings
                        {...p}
                        token={token!}
                        onLogout={() => {
                          setToken(null);
                          sessionStore.clearAll();
                        }}
                      />
                    )}
                  </RootStack.Screen>
                  <RootStack.Screen name="SettingsPreferences" options={{ title: 'Preferences' }}>
                    {(p) => <PreferencesScreen {...p} token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="SettingsAccessibility" component={AccessibilityScreen} options={{ title: 'Accessibility' }} />
                  <RootStack.Screen name="SettingsPrivacy" component={PrivacySafetyScreen} options={{ title: 'Privacy & Safety' }} />
                  <RootStack.Screen name="SettingsTrust" component={TrustTransparency} options={{ title: 'Trust & Transparency' }} />
                  <RootStack.Screen name="BlockedUsers" component={BlockedUsersScreen} options={{ title: 'Blocked Users' }} />
                  <RootStack.Screen name="SettingsAbout" component={AboutScreen} options={{ title: 'About' }} />
                  <RootStack.Screen name="Notifications" options={{ title: 'Notifications' }}>
                    {(p) => <NotificationList {...p} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="NotificationDetail" options={{ title: 'Notification' }}>
                    {(p) => <NotificationDetail {...p} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="Report" options={{ title: 'Report' }}>
                    {(p) => <ReportEntryScreen {...p} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="ReportDetails" options={{ title: 'Report Details' }}>
                    {(p) => <ReportDetailsScreen {...p} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="ReportConfirm" component={ReportConfirmScreen} options={{ title: 'Report Submitted' }} />
                  <RootStack.Screen name="RestrictionNotice" component={RestrictionNoticeScreen} options={{ title: 'Restricted' }} />
                  <RootStack.Screen name="ModerationOutcome" component={ModerationOutcomeScreen} options={{ title: 'Outcome' }} />
                  <RootStack.Screen name="Safety" options={{ title: 'Safety' }}>
                    {() => <SafetyHome token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="Cred" options={{ title: 'Cred' }}>
                    {() => <CredLedger token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="FeatureFlags" options={{ title: 'Feature flags' }} component={FeatureFlags} />
                  <RootStack.Screen name="DevTools" options={{ title: 'Dev Tools' }}>
                    {() => <DevToolsScreen token={token!} />}
                  </RootStack.Screen>
                  <RootStack.Screen name="Status" options={{ title: 'Status' }}>
                    {() => (
                      <StatusScreen
                        purgeActive={purgeActive}
                        purgeStartsAt={purgeStartsAt}
                        purgeEndsAt={purgeEndsAt}
                      />
                    )}
                  </RootStack.Screen>
                </>
              )}
                </RootStack.Navigator>
              </NavigationContainer>
            </WorldProvider>
            <GatheringOfframpOverlay gatheringActive={worldActive} remainingMs={worldRemainingMs} />
            <GatheringEnterOverlay
              visible={enterVisible}
              onDone={async () => {
                if (purgeStartsAt) await sessionStore.setGatheringEntered(purgeStartsAt);
                setEnterVisible(false);
              }}
            />
            <GatheringCollapseOverlay
              visible={collapseVisible}
              onDone={async () => {
                if (purgeEndsAt) await sessionStore.setGatheringSeen(purgeEndsAt);
                setCollapseVisible(false);
              }}
            />
          </>
        )}
      </Theme>
    </TamaguiProvider>
  );
}

