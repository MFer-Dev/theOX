import React, { useState } from 'react';
import { Screen, Section, AppText, AppButton, Sheet, FormField, Card } from '../../ui';
import { apiClient } from '../../api/client';

type Props = {
  navigation: any;
  token: string;
  onLogout: () => void;
};

export default function AccountSettings({ navigation, token, onLogout }: Props) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doDelete = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiClient.accountDelete(token, reason.trim() || undefined);
      setDeleteOpen(false);
      onLogout();
    } catch (e: any) {
      setErr(e?.message ?? 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Section title="Account">
        <AppText variant="body">Manage your account security.</AppText>
        <AppButton tone="secondary" onPress={() => navigation?.navigate?.('ChangePassword')}>
          Change Password
        </AppButton>
        <AppButton tone="secondary" onPress={() => navigation?.navigate?.('Sessions')}>
          Active Sessions
        </AppButton>
        <AppButton tone="destructive" onPress={() => setDeleteOpen(true)}>
          Delete Account
        </AppButton>
        <AppButton tone="destructive" onPress={onLogout}>
          Log Out
        </AppButton>
      </Section>

      <Sheet isOpen={deleteOpen} onClose={() => (busy ? null : setDeleteOpen(false))}>
        <Section title="Delete account" subtitle="This action is permanent and will revoke all sessions.">
          <Card bordered>
            <FormField
              label="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              placeholder="Tell us what went wrong (optional)"
            />
            {err ? (
              <AppText variant="caption" color="$red10">
                {err}
              </AppText>
            ) : null}
            <AppButton tone="destructive" fullWidth onPress={doDelete} loading={busy} disabled={busy}>
              Delete permanently
            </AppButton>
            <AppButton tone="ghost" fullWidth onPress={() => setDeleteOpen(false)} disabled={busy}>
              Cancel
            </AppButton>
          </Card>
        </Section>
      </Sheet>
    </Screen>
  );
}

