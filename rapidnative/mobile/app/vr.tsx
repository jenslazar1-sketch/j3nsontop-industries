import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, Panel, Row, Empty, Chip, Note } from '@/components/ui';
import { colors, space, mono, sevColor, sevLabel } from '@/theme';
import { useApk } from '@/src/lib/store';

export default function Vr() {
  const { analysis } = useApk();

  if (!analysis) {
    return (
      <Screen>
        <Panel title="VR Compatibility">
          <Empty text="No APK loaded. Open the Load tab and pick one." />
        </Panel>
      </Screen>
    );
  }

  const { vr, vrVerdict } = analysis;
  if (!vr || !vrVerdict) {
    return (
      <Screen>
        <Panel title="VR Compatibility">
          <Empty text="The VR scan could not run on this file." />
        </Panel>
      </Screen>
    );
  }

  if (!vr.isVR) {
    return (
      <Screen>
        <Panel title="VR Compatibility">
          <Row label="Verdict" value="Not a VR app" />
          <Note>
            No XR runtime library and no headset feature declared. This is an
            ordinary Android app.
          </Note>
        </Panel>
      </Screen>
    );
  }

  const accent = sevColor[vrVerdict.level] ?? colors.dim;

  return (
    <Screen>
      <View style={[s.verdict, { borderColor: accent }]}>
        <Text style={[s.verdictText, { color: accent }]}>{vrVerdict.text}</Text>
        <Text style={s.verdictSub}>{sevLabel[vrVerdict.level] ?? vrVerdict.level}</Text>
      </View>

      <Note>
        "Can this run on a phone" is really four separate questions. Each is
        answered on its own below, because the usual outcome is that it installs
        and then dies at startup — a single yes/no would hide that.
      </Note>

      <Panel title="What it is">
        <Row label="Runtime" value={vr.runtime?.name ?? 'unknown'} color={colors.acid} />
        <Row label="Engine" value={vr.engine ?? 'unknown'} />
        <Row label="ABIs" value={vr.abis.join(', ') || 'none'} />
        <Row label="64-bit" value={vr.has64 ? 'yes' : 'no'} />
        <Row label="x86" value={vr.hasX86 ? 'yes (emulator-friendly)' : 'no (ARM only)'} />
      </Panel>

      <Panel title={`Blockers · ${vr.blockers.length}`}>
        {vr.blockers.length ? (
          vr.blockers.map((b: any, i: number) => (
            <View key={i} style={s.blocker}>
              <View style={s.blockerHead}>
                <Chip text={sevLabel[b.level] ?? b.level} tone={b.level} />
                <Text style={s.blockerTitle}>{b.title}</Text>
              </View>
              <Text style={s.blockerDetail}>{b.detail}</Text>
            </View>
          ))
        ) : (
          <Empty text="Nothing blocking — it should start on a plain phone." />
        )}
      </Panel>

      <Panel title="Declared features">
        {vr.features.length ? (
          <View style={s.chips}>
            {vr.features.map((f: any) => (
              <Chip
                key={f.name}
                text={`${f.name.replace('android.hardware.', '')}${f.required ? '' : ' (optional)'}`}
                tone={f.required ? 'med' : 'info'}
              />
            ))}
          </View>
        ) : (
          <Empty text="No hardware features declared." />
        )}
      </Panel>

      {vr.notes?.length ? (
        <Panel title="Notes">
          {vr.notes.map((n: string, i: number) => <Note key={i}>{n}</Note>)}
        </Panel>
      ) : null}

      <Panel title="XR libraries">
        {vr.libs?.length ? (
          vr.libs
            .filter((l: any) => /openxr|vrapi|wave|pico|ovr|oculus/i.test(l.name))
            .map((l: any, i: number) => (
              <Row key={i} label={l.abi} value={l.name} />
            ))
        ) : (
          <Empty text="No XR libraries." />
        )}
      </Panel>
    </Screen>
  );
}

const s = StyleSheet.create({
  verdict: {
    borderWidth: 2, borderRadius: 12, padding: space.lg,
    alignItems: 'center', backgroundColor: colors.panel, gap: 4,
  },
  verdictText: { fontSize: 17, fontWeight: '800', letterSpacing: 0.5, textAlign: 'center' },
  verdictSub: { color: colors.dim2, fontSize: 11, fontFamily: mono, letterSpacing: 1 },
  blocker: {
    paddingVertical: space.sm, gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line2,
  },
  blockerHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  blockerTitle: { color: colors.paper, fontSize: 13, fontWeight: '700', flex: 1 },
  blockerDetail: { color: colors.dim, fontSize: 12, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
});
