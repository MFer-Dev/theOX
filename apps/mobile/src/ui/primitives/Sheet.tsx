import React from 'react';
import { Modal, TouchableOpacity, View, StyleSheet } from 'react-native';
import { YStack } from 'tamagui';
import { APP_RADIUS } from './style';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export const Sheet = ({ isOpen, onClose, children }: Props) => (
  <Modal
    visible={isOpen}
    transparent
    animationType="slide"
    onRequestClose={onClose}
    accessibilityViewIsModal
    presentationStyle="overFullScreen"
  >
    <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
      <View style={styles.container} accessible accessibilityRole="menu">
        <YStack padding="$4" borderTopLeftRadius={APP_RADIUS} borderTopRightRadius={APP_RADIUS} backgroundColor="$background">
          {children}
        </YStack>
      </View>
    </TouchableOpacity>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  container: { flex: 1, justifyContent: 'flex-end' },
});
