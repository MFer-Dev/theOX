import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, AppButton, FormField, Sheet, Avatar, Pill, PillRow, Card } from '../../ui';
import { apiClient } from '../../api/client';
import { profileStore } from '../../storage/profile';
import { YStack } from 'tamagui';

type Props = {
  token: string;
  navigation: any;
};

export default function EditProfile({ token, navigation }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarKey, setAvatarKey] = useState<'default' | 'alt1' | 'alt2'>('default');

  useEffect(() => {
    const load = async () => {
      try {
        const me = await apiClient.me?.(token);
        setDisplayName(me?.user?.display_name ?? '');
        setBio(me?.user?.bio ?? '');
        const o = await profileStore.getOverrides();
        setAvatarKey((o.avatar_key as any) ?? 'default');
      } catch {
        // ignore
      }
    };
    load();
  }, [token]);

  const save = async () => {
    setError(null);
    setLoading(true);
    try {
      await apiClient.updateProfile?.(token, { display_name: displayName, bio });
      await profileStore.setOverrides({ avatar_key: avatarKey });
      navigation?.goBack?.();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed.');
    } finally {
      setLoading(false);
      setDirty(false);
    }
  };

  const cancel = () => {
    if (dirty) setShowDiscard(true);
    else navigation?.goBack?.();
  };

  return (
    <Screen>
      <Section title="Edit Profile">
        <Card bordered padding="$4">
          <YStack alignItems="center" gap="$3">
            <Avatar name={displayName || 'Me'} uri={profileStore.avatars[avatarKey]} size={72} />
            <AppButton tone="secondary" onPress={() => setAvatarOpen(true)}>
              Change avatar
            </AppButton>
          </YStack>
        </Card>
        <FormField
          label="Display name"
          value={displayName}
          onChangeText={(t: string) => {
            setDisplayName(t);
            setDirty(true);
          }}
        />
        <FormField
          label="Bio (optional)"
          value={bio}
          onChangeText={(t: string) => {
            setBio(t);
            setDirty(true);
          }}
          multiline
          numberOfLines={4}
        />
        {error ? <AppText variant="caption" color="$red10">{error}</AppText> : null}
        <YStack gap="$2" paddingTop="$2">
          <AppButton tone="primary" fullWidth onPress={save} loading={loading} disabled={loading}>
            Save
          </AppButton>
          <AppButton tone="ghost" fullWidth onPress={cancel} disabled={loading}>
            Cancel
          </AppButton>
        </YStack>
      </Section>
      <Sheet isOpen={showDiscard} onClose={() => setShowDiscard(false)}>
        <AppText variant="title">Discard changes?</AppText>
        <AppText variant="body">You will lose your edits.</AppText>
        <AppButton tone="destructive" onPress={() => navigation?.goBack?.()}>
          Discard
        </AppButton>
        <AppButton tone="ghost" onPress={() => setShowDiscard(false)}>
          Keep editing
        </AppButton>
      </Sheet>
      <Sheet isOpen={avatarOpen} onClose={() => setAvatarOpen(false)}>
        <Section title="Choose an avatar" subtitle="This is a local stub until media upload is wired.">
          <PillRow>
            {(['default', 'alt1', 'alt2'] as const).map((k) => (
              <Pill
                key={k}
                label={k === 'default' ? 'Default' : k === 'alt1' ? 'Alt 1' : 'Alt 2'}
                active={avatarKey === k}
                onPress={() => {
                  setAvatarKey(k);
                  setDirty(true);
                  setAvatarOpen(false);
                }}
              />
            ))}
          </PillRow>
        </Section>
      </Sheet>
    </Screen>
  );
}

