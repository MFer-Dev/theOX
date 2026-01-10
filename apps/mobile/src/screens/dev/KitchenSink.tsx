import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Screen, Section, AppText, AppButton, FormField, OtpField, Toggle, AppCheckbox, Select, Card, Divider, Skeleton, Sheet, List } from '../../ui';
import { EmptyState, ErrorState, LoadingState } from '../../ui/recipes/states';
import { FeedRow } from '../../ui/recipes/lists';
import { View } from 'tamagui';
import SplashScreen from '../entry/Splash';
import SystemCheck from '../entry/SystemCheck';
import MaintenanceScreen from '../entry/Maintenance';
import LoggedOutEntry from '../entry/LoggedOut';
import BlockedAccess from '../entry/Blocked';
import OfflineDegraded from '../entry/Offline';
import CreateAccountScreen from '../auth/CreateAccount';
import VerifyScreen from '../auth/Verify';
import AccountCreatedScreen from '../auth/AccountCreated';
import MFAScreen from '../auth/MFA';
import SessionExpiredScreen from '../auth/SessionExpired';
import ReauthScreen from '../auth/Reauth';
import DeviceTrustScreen from '../auth/DeviceTrust';
import LoginSuccessScreen from '../auth/LoginSuccess';
import NotificationList from '../notifications/NotificationList';
import NotificationDetail from '../notifications/NotificationDetail';

export default function KitchenSink() {
  const [toggle, setToggle] = useState(false);
  const [checked, setChecked] = useState(true);
  const [select, setSelect] = useState<string>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [otp, setOtp] = useState('');
  const [blocked, setBlocked] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [delayedLoading, setDelayedLoading] = useState(false);
  const [delayedData, setDelayedData] = useState<string[] | null>(null);
  const [delayedError, setDelayedError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  const bigList = useMemo(
    () =>
      Array.from({ length: 200 }).map((_, i) => ({
        id: `${i}`,
        body: `Row ${i}`,
        generation: 'genz',
        topic: 'stress',
        assumption: 'meta',
      })),
    [],
  );
  const sampleFeed = useMemo(
    () => [{ id: '1', body: 'Sample entry body truncated...', generation: 'genz', topic: 'safety', assumption: 'lived_experience' }],
    [],
  );

  const simulateDelayed = () => {
    setDelayedLoading(true);
    setDelayedError(null);
    setDelayedData(null);
    setTimeout(() => {
      if (retryCount === 0) {
        setDelayedLoading(false);
        setDelayedError('Network timeout');
      } else {
        setDelayedLoading(false);
        setDelayedData(['Loaded after retry']);
      }
    }, 1500);
  };

  return (
    <Screen scroll={false}>
      <List
        data={bigList}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <FeedRow body={item.body} generation={item.generation} topic={item.topic} assumption={item.assumption} />}
        ListHeaderComponent={
          <>
            <Section title="Typography">
        <AppText variant="display">Display / Heading</AppText>
        <AppText variant="title">Title</AppText>
        <AppText variant="body">Body text for paragraphs and content.</AppText>
        <AppText variant="meta">Meta / label</AppText>
        <AppText variant="caption">Caption / helper</AppText>
            </Section>

            <Section title="Buttons">
        <AppButton tone="primary">Primary</AppButton>
        <AppButton tone="secondary">Secondary</AppButton>
        <AppButton tone="ghost">Ghost</AppButton>
        <AppButton tone="destructive">Destructive</AppButton>
        <AppButton tone="primary" loading>
          Loading
        </AppButton>
        <AppButton tone="primary" disabled>
          Disabled
        </AppButton>
            </Section>

            <Section title="Inputs">
        <FormField label="Email" placeholder="name@example.com" helper="We never share your email." />
        <FormField label="Password" placeholder="••••••" secureTextEntry error="Required" />
        <OtpField onChange={setOtp} />
        <AppText variant="caption">OTP value: {otp}</AppText>
            </Section>

            <Section title="Selectors">
        <Toggle label="Notifications" value={toggle} onValueChange={setToggle} />
        <AppCheckbox checked={checked} onCheckedChange={(v) => setChecked(Boolean(v))} label="Agree to terms" />
        <Select
          label="Generation"
          value={select}
          onChange={setSelect}
          options={[
            { label: 'Gen Z', value: 'genz' },
            { label: 'Millennial', value: 'millennial' },
            { label: 'Gen X', value: 'genx' },
          ]}
        />
            </Section>

            <Section title="Cards & Rows">
        <Card padding="$3" bordered>
          <AppText variant="title">Card Title</AppText>
          <AppText variant="body">Body content inside a card.</AppText>
        </Card>
        <Divider />
        <AppText variant="body">List row (dense):</AppText>
        <View padding="$3" backgroundColor="$backgroundStrong" borderRadius="$4">
          <AppText variant="body">Row title</AppText>
          <AppText variant="caption">Meta details</AppText>
        </View>
            </Section>

            <Section title="System States">
        <AppText variant="body">Skeletons:</AppText>
        <Skeleton height={14} width="60%" />
        <Skeleton height={14} width="90%" />
        <Skeleton height={14} width="40%" />
        <LoadingState lines={3} />
        <EmptyState body="Nothing to show yet." actionLabel="Refresh" onAction={() => {}} />
        <ErrorState body="Network failed" onAction={() => {}} />
        <AppText variant="body">Blocked example:</AppText>
        <AppButton tone="primary" disabled={blocked} onPress={() => setBlocked(!blocked)}>
          {blocked ? 'Blocked (toggle to unblock)' : 'Unblocked'}
        </AppButton>
            </Section>

            <Section title="Lists & Density">
              {sampleFeed.map((item) => (
                <FeedRow key={item.id} body={item.body} generation={item.generation} topic={item.topic} assumption={item.assumption} onPress={() => {}} />
              ))}
            </Section>

            <Section title="Entry & System (A11y/Stress)">
        <AppText variant="caption">Splash:</AppText>
        <SplashScreen />
        <AppText variant="caption">System Check:</AppText>
        <SystemCheck onReady={() => {}} onMaintenance={() => {}} onFatal={() => {}} />
        <AppText variant="caption">Maintenance:</AppText>
        <MaintenanceScreen message="Planned maintenance" eta="Today 5pm" />
        <AppText variant="caption">Logged-out:</AppText>
        <LoggedOutEntry onGetStarted={() => {}} onLogin={() => {}} disabled={false} />
        <AppText variant="caption">Blocked:</AppText>
        <BlockedAccess reason="Policy violation" onLogout={() => {}} />
        <AppText variant="caption">Offline:</AppText>
        <OfflineDegraded onRetry={() => {}} />
            </Section>

            <Section title="Auth & Identity">
        <AppText variant="caption">Create Account:</AppText>
        <CreateAccountScreen onLogin={() => {}} onCreated={() => {}} />
        <AppText variant="caption">Verify:</AppText>
        <VerifyScreen email="user@example.com" onVerified={() => {}} onResend={async () => {}} />
        <AppText variant="caption">Account Created:</AppText>
        <AccountCreatedScreen onContinue={() => {}} />
        <AppText variant="caption">Login MFA:</AppText>
        <MFAScreen onVerified={() => {}} onResend={async () => {}} />
        <AppText variant="caption">Login success:</AppText>
        <LoginSuccessScreen onDone={() => {}} />
        <AppText variant="caption">Session expired:</AppText>
        <SessionExpiredScreen onLogin={() => {}} />
        <AppText variant="caption">Re-auth:</AppText>
        <ReauthScreen onConfirm={() => {}} onCancel={() => {}} />
        <AppText variant="caption">Device trust:</AppText>
        <DeviceTrustScreen deviceLabel="iPhone · San Francisco" onTrust={() => {}} onDeny={() => {}} />
            </Section>

            <Section title="Notifications">
        <AppText variant="caption">List:</AppText>
        <NotificationList
          navigation={{ navigate: () => {} }}
          fetchNotifications={async () => [
            { id: '1', title: 'Welcome', body: 'Thanks for joining', ts: 'now', unread: true, target: { route: 'Home' } },
          ]}
        />
        <AppText variant="caption">Detail:</AppText>
        <NotificationDetail navigation={{ goBack: () => {} }} route={{ params: { title: 'Sample', body: 'Body', target: { route: 'Home' } } }} />
            </Section>

            <Section title="Reduced Motion & A11y">
        <AppText variant="body">Reduce motion (OS): {reduceMotion ? 'enabled' : 'disabled'}</AppText>
        <AppText variant="caption">Toggle OS reduce-motion to see animations collapse.</AppText>
        <AppText variant="caption">Controls include roles/labels; sheet is marked modal.</AppText>
            </Section>

            <Section title="Stress: Large List">
              <AppText variant="caption">Below is a single FlatList (no nesting) for stress testing.</AppText>
            </Section>
          </>
        }
        ListFooterComponent={
          <>
            <Section title="Stress: Delayed Load & Retry">
        <AppButton
          tone="secondary"
          onPress={() => {
            setRetryCount(0);
            simulateDelayed();
          }}
        >
          Start delayed load
        </AppButton>
        {delayedLoading ? <LoadingState lines={2} /> : null}
        {delayedError ? (
          <ErrorState
            body={delayedError}
            actionLabel="Retry"
            onAction={() => {
              setRetryCount((c) => c + 1);
              simulateDelayed();
            }}
          />
        ) : null}
        {delayedData ? delayedData.map((d) => <AppText key={d}>{d}</AppText>) : null}
            </Section>

            <Section title="Overlays">
        <AppButton tone="secondary" onPress={() => setSheetOpen(true)}>
          Open Sheet
        </AppButton>
        <Sheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)}>
          <AppText variant="title">Sheet Title</AppText>
          <AppText variant="body">Backdrop + slide preset.</AppText>
          <AppButton tone="primary" onPress={() => setSheetOpen(false)}>
            Close
          </AppButton>
        </Sheet>
            </Section>
          </>
        }
      />
    </Screen>
  );
}

