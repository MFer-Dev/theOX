import React, { useEffect, useMemo, useState } from 'react';
import { Screen, Section, AppText, AppButton, FormField, List, Card, Sheet } from '../../ui';
import { apiClient } from '../../api/client';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  contentId: string;
};

export default function NotesDrawer({ isOpen, onClose, token, contentId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [editBody, setEditBody] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp: any = await apiClient.notesByContent(token, contentId);
      const list = (resp?.notes ?? []) as any[];
      setNotes(list);
      const first = list?.[0]?.id;
      if (!selectedNoteId && first) {
        setSelectedNoteId(first);
        setEditBody(list?.[0]?.latest_body ?? '');
      }
    } catch {
      setError('Notes unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const selected = useMemo(() => notes.find((n) => n.id === selectedNoteId) ?? null, [notes, selectedNoteId]);

  const create = async () => {
    if (!draftBody.trim()) return;
    await apiClient.noteCreate(token, contentId, draftBody.trim());
    setDraftBody('');
    await load();
  };

  const update = async () => {
    if (!selectedNoteId || !editBody.trim()) return;
    await apiClient.noteUpdate(token, selectedNoteId, editBody.trim(), 'visible');
    await load();
  };

  return (
    <Sheet isOpen={isOpen} onClose={onClose}>
      <Screen scroll={false}>
        <Section title="Notes" subtitle="Context and clarification (beta).">
          {error ? (
            <AppText variant="caption" color="$red10">
              {error}
            </AppText>
          ) : null}
          <FormField label="Create note" value={draftBody} onChangeText={setDraftBody} placeholder="Add context…" multiline />
          <AppButton tone="primary" onPress={create} disabled={!draftBody.trim() || loading}>
            Create
          </AppButton>
        </Section>

        <List
          style={{ flex: 1 }}
          data={notes}
          keyExtractor={(n) => n.id}
          ListHeaderComponent={
            <Section title="Existing">
              {selected ? (
                <>
                  <AppText variant="caption">Editing selected note</AppText>
                  <FormField value={editBody} onChangeText={setEditBody} multiline numberOfLines={4} />
                  <AppButton tone="secondary" onPress={update} disabled={!editBody.trim() || loading}>
                    Save
                  </AppButton>
                </>
              ) : (
                <AppText variant="caption" color="$gray10">
                  Select a note to edit.
                </AppText>
              )}
            </Section>
          }
          renderItem={({ item }) => (
            <Card
              padding="$3"
              bordered
              onPress={() => {
                setSelectedNoteId(item.id);
                setEditBody(item.latest_body ?? '');
              }}
              backgroundColor={item.id === selectedNoteId ? '$backgroundStrong' : undefined}
            >
              <AppText variant="body" numberOfLines={2}>
                {item.latest_body ?? 'Note'}
              </AppText>
              <AppText variant="caption" color="$gray10">
                {item.status ?? 'draft'}
              </AppText>
            </Card>
          )}
        />
      </Screen>
    </Sheet>
  );
}


