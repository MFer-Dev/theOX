import React from 'react';
import { FlatList, FlatListProps, StyleSheet } from 'react-native';
import { View } from 'tamagui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Separator = () => <View height={StyleSheet.hairlineWidth} backgroundColor="$gray4" opacity={0.9} />;

export function List<ItemT>(props: FlatListProps<ItemT>) {
  const insets = useSafeAreaInsets();
  return (
    <FlatList
      {...props}
      ItemSeparatorComponent={props.ItemSeparatorComponent ?? Separator}
      contentContainerStyle={[
        styles.content,
        // Reserve room for bottom tab bar + FAB so content is never obscured, but avoid creating a visible dead band.
        { paddingBottom: 104 + Math.max(0, insets.bottom) },
        props.contentContainerStyle,
      ]}
      showsVerticalScrollIndicator={props.showsVerticalScrollIndicator ?? true}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 0,
  },
});

