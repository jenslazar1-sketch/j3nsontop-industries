/* The shared visual vocabulary: panel, row, chip, section heading, button.
 *
 * Plain StyleSheet rather than a utility-class runtime — the palette is six
 * colours and the layout is a stack of panels, so a styling dependency would
 * cost more than it saves and is one more thing to go wrong on import. */
import React from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  ActivityIndicator, type ViewStyle, type StyleProp,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, mono, space, radius, sevColor, sevLabel } from '@/theme';

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const inner = scroll ? (
    <ScrollView
      style={s.flex}
      contentContainerStyle={s.scrollPad}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[s.flex, s.scrollPad]}>{children}</View>
  );
  return <SafeAreaView style={s.screen} edges={['bottom', 'left', 'right']}>{inner}</SafeAreaView>;
}

export function Panel({
  title, right, children, style,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.panel, style]}>
      {title ? (
        <View style={s.panelHead}>
          <Text style={s.panelTitle}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Row({ label, value, mono: isMono = true, color }: {
  label: string; value: React.ReactNode; mono?: boolean; color?: string;
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel} numberOfLines={1}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text
          style={[s.rowValue, isMono && s.monoText, color ? { color } : null]}
          numberOfLines={2}
          selectable
        >
          {String(value)}
        </Text>
      ) : (
        <View style={s.rowValueBox}>{value}</View>
      )}
    </View>
  );
}

export function Chip({ text, tone = 'dim' }: { text: string; tone?: string }) {
  const c = sevColor[tone] ?? colors.dim;
  return (
    <View style={[s.chip, { borderColor: c }]}>
      <Text style={[s.chipText, { color: c }]}>{text}</Text>
    </View>
  );
}

export function SevChip({ sev }: { sev: string }) {
  return <Chip text={sevLabel[sev] ?? sev.toUpperCase()} tone={sev} />;
}

export function Button({
  title, onPress, tone = 'acid', disabled, busy,
}: {
  title: string; onPress: () => void; tone?: 'acid' | 'dim' | 'red'; disabled?: boolean; busy?: boolean;
}) {
  const c = tone === 'acid' ? colors.acid : tone === 'red' ? colors.red : colors.dim;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn,
        { borderColor: c, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={c} /> : <Text style={[s.btnText, { color: c }]}>{title}</Text>}
    </Pressable>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={s.empty}>{text}</Text>;
}

export function Note({ children, tone = 'dim' }: { children: React.ReactNode; tone?: string }) {
  const c = sevColor[tone] ?? colors.dim;
  return (
    <View style={[s.note, { borderLeftColor: c }]}>
      <Text style={s.noteText}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.ink },
  scrollPad: { padding: space.md, paddingBottom: space.xl * 2, gap: space.md },
  panel: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  panelHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: space.sm, gap: space.sm,
  },
  panelTitle: {
    color: colors.acid, fontSize: 12, fontWeight: '700',
    letterSpacing: 1.6, textTransform: 'uppercase', flexShrink: 1,
  },
  row: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 5, gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line2,
  },
  rowLabel: { color: colors.dim2, fontSize: 12, width: 104, flexShrink: 0 },
  rowValue: { color: colors.paper, fontSize: 12.5, flex: 1, textAlign: 'right' },
  rowValueBox: { flex: 1, alignItems: 'flex-end' },
  monoText: { fontFamily: mono },
  chip: {
    borderWidth: 1, borderRadius: radius.sm,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  chipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  btn: {
    borderWidth: 1, borderRadius: radius.sm,
    paddingVertical: 12, paddingHorizontal: space.lg,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(124,255,0,0.05)', minHeight: 46,
  },
  btnText: { fontSize: 13, fontWeight: '700', letterSpacing: 1.1 },
  empty: { color: colors.dim2, fontSize: 12, fontStyle: 'italic', paddingVertical: space.sm },
  note: {
    borderLeftWidth: 3, paddingLeft: space.sm, paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  noteText: { color: colors.dim, fontSize: 12, lineHeight: 17 },
});

export { s as uiStyles };
