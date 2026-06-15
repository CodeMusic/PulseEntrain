import React from 'react';
import { View, Image, Dimensions, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

// Artwork that, when it must crop, trims from the BOTTOM (keeps the title text
// at the top of these covers visible). Adapts to each image's real aspect ratio.
export default function ArtImage({ source, height, radius = 18, hpad = 24, style }) {
  const meta = source ? Image.resolveAssetSource(source) : null;
  const ar = meta && meta.height ? meta.width / meta.height : 1;
  const boxW = Dimensions.get('window').width - hpad * 2;
  const boxAr = boxW / height;

  // ar < boxAr → image is relatively taller; fitting to width overflows the
  // box vertically, so anchor to the top and let the overflow clip the bottom.
  // Otherwise the image is wide → normal cover (crops the sides, top intact).
  const fitByWidth = ar < boxAr;
  const imgStyle = fitByWidth
    ? { width: '100%', aspectRatio: ar, position: 'absolute', top: 0 }
    : { width: '100%', height: '100%' };

  return (
    <View style={[styles.box, { height, borderRadius: radius }, style]}>
      {source ? <Image source={source} resizeMode="cover" style={imgStyle} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden', backgroundColor: COLORS.bgCardLight },
});
