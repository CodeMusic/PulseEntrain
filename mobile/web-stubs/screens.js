import React from 'react';
import { View, StyleSheet } from 'react-native';

// Minimal web stub for react-native-screens (4.4.0 ships only partial web files
// and its index pulls in RN-core fabric components). Renders screens as plain
// views so @react-navigation/native-stack compiles and works on web. Native
// screen optimizations / native headers are lost (headers come from RN core),
// which is expected for an exploratory web target.
const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hidden: { display: 'none' },
});

const Fill = ({ children, style }) => <View style={[styles.fill, style]}>{children}</View>;
const Pass = ({ children, style }) => <View style={style}>{children}</View>;
const Null = () => null;

export const ScreenStack = ({ children, style }) => <View style={[{ flex: 1 }, style]}>{children}</View>;
export const ScreenStackItem = ({ children, style, activityState }) => (
  <View style={[styles.fill, activityState === 0 && styles.hidden, style]}>{children}</View>
);
export const Screen = ScreenStackItem;
export const InnerScreen = ScreenStackItem;
export const ScreenContainer = Fill;
export const ScreenContentWrapper = Fill;
export const ScreenContent = Pass;
export const ScreenFooter = Pass;
export const FullWindowOverlay = Pass;
export const ScreenStackHeaderConfig = Null;
export const ScreenStackHeaderSubview = Pass;
export const ScreenStackHeaderBackButtonImage = Null;
export const ScreenStackHeaderCenterView = Pass;
export const ScreenStackHeaderLeftView = Pass;
export const ScreenStackHeaderRightView = Pass;
export const ScreenStackHeaderSearchBarView = Null;
export const SearchBar = Null;
export const compatibilityFlags = {};
export const isSearchBarAvailableForCurrentPlatform = false;
export const enableScreens = () => {};
export const enableFreeze = () => {};
export const screensEnabled = () => false;
export const useTransitionProgress = () => ({ progress: 0, closing: 0, goingForward: 0 });

export default { enableScreens, enableFreeze, screensEnabled, ScreenStack, Screen, ScreenContainer };
