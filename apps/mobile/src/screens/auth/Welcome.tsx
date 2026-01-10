import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { Screen, Section, AppButton, AppText } from '../../ui';
import { GROUP_SINGULAR, EVENT_NAME } from '../../config/lexicon';

type Props = {
  onLogin?: () => void;
};

const AuthWelcome = ({ onLogin: _onLogin }: Props) => {
  const nav = useNavigation<any>();
  return (
    <Screen>
      <Section
        title="Welcome"
        subtitle={`Log in or create an account. Your ${GROUP_SINGULAR} keeps conversation scoped; ${EVENT_NAME} temporarily opens cross-Trybe visibility.`}
      >
        <AppButton tone="ghost" onPress={() => nav.navigate('AuthTour')}>
          <AppText variant="body">How it works</AppText>
        </AppButton>
        <AppButton onPress={() => nav.navigate('Login')}>
          <AppText variant="body" color="$color">
            Login
          </AppText>
        </AppButton>
        <AppButton tone="ghost" onPress={() => nav.navigate('Register')}>
          <AppText variant="body">Create Account</AppText>
        </AppButton>
        {__DEV__ ? (
          <AppButton tone="ghost" onPress={() => _onLogin?.()}>
            <AppText variant="body">Continue (Dev)</AppText>
          </AppButton>
        ) : null}
      </Section>
    </Screen>
  );
};

export default AuthWelcome;

