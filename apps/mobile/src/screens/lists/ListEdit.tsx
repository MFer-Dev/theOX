import React, { useEffect, useState } from 'react';
import { Screen, Section, FormField, AppButton, AppText, Card } from '../../ui';
import { apiClient } from '../../api/client';
import { listsStore } from '../../storage/lists';

export default function ListEditScreen({ route, navigation, token }: any) {
  const id = route?.params?.id as string;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (token && token !== 'dev-session') {
          const res: any = await apiClient.listsGet(token, id);
          const l = res?.list ?? res;
          if (!alive) return;
          setName(String(l?.name ?? ''));
          setDescription(String(l?.description ?? ''));
        } else {
          const l = await listsStore.getList(id);
          if (!alive) return;
          setName(String(l?.name ?? ''));
          setDescription(String(l?.description ?? ''));
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, token]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (token && token !== 'dev-session') {
        await apiClient.listsUpdate(token, id, { name: name.trim(), description: description.trim() || undefined });
      } else {
        await listsStore.updateList(id, { name: name.trim(), description: description.trim() || undefined });
      }
      navigation.goBack();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Section title="Edit list" subtitle="Name and description.">
        <Card bordered>
          <FormField label="Name" value={name} onChangeText={setName} placeholder="List name" />
          <FormField label="Description" value={description} onChangeText={setDescription} placeholder="Description (optional)" />
        </Card>
        {error ? (
          <AppText variant="caption" color="$red10">
            {error}
          </AppText>
        ) : null}
        <AppButton tone="primary" onPress={save} disabled={!name.trim() || saving} loading={saving}>
          Save
        </AppButton>
      </Section>
    </Screen>
  );
}


