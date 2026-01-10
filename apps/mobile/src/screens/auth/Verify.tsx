import React, { useState } from 'react';
import { Screen, Section, AppText, OtpField, AppButton, ErrorState } from '../../ui';

type Props = {
  email: string;
  onVerified: () => void;
  onResend: () => Promise<void> | void;
};

export default function VerifyScreen({ email, onVerified, onResend }: Props) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false);

  const submit = async () => {
    setError(null);
    if (otp.length < 4) {
      setError('Code incomplete.');
      return;
    }
    setLoading(true);
    try {
      // verify OTP backend
      onVerified();
    } catch (e: any) {
      setError(e?.message ?? 'Invalid or expired code.');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown) return;
    setCooldown(true);
    try {
      await onResend();
    } finally {
      setTimeout(() => setCooldown(false), 30000);
    }
  };

  return (
    <Screen>
      <Section title="Verify">
        <AppText variant="body">Enter the code we sent to {email}.</AppText>
        <OtpField onChange={setOtp} />
        {error ? <ErrorState body={error} /> : null}
        <AppButton tone="primary" onPress={submit} loading={loading} disabled={loading}>
          Verify
        </AppButton>
        <AppButton tone="ghost" onPress={resend} disabled={cooldown || loading}>
          {cooldown ? 'Resend in 30s' : 'Resend code'}
        </AppButton>
      </Section>
    </Screen>
  );
}

