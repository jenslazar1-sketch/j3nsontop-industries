import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, Panel, Row, Empty, Chip, Note } from '@/components/ui';
import { colors, space, mono } from '@/theme';
import { useApk } from '@/src/lib/store';
import { human } from '@/src/lib/analyse';

export default function ApkLab() {
  const { analysis } = useApk();

  if (!analysis) {
    return (
      <Screen>
        <Panel title="APK Lab">
          <Empty text="No APK loaded. Open the Load tab and pick one." />
        </Panel>
      </Screen>
    );
  }

  const { facts, shape, dexStats, libs, zip } = analysis;

  return (
    <Screen>
      <Panel title="Manifest">
        <Row label="Package" value={facts.package ?? '—'} color={colors.acid} />
        <Row label="Version" value={`${facts.versionName ?? '?'} (${facts.versionCode ?? '?'})`} />
        <Row label="minSdk" value={facts.minSdk ?? '—'} />
        <Row label="targetSdk" value={facts.targetSdk ?? '—'} />
        <Row label="Application" value={facts.application ?? '(default)'} />
        <Row
          label="Debuggable"
          value={facts.debuggable ? 'YES' : 'no'}
          color={facts.debuggable ? colors.red : undefined}
        />
        <Row label="Activities" value={String(facts.activities.length)} />
      </Panel>

      <Panel title={`Contents · ${shape.entries} entries`}>
        <Row label="Uncompressed" value={human(shape.total)} />
        <Row label="Compressed" value={human(shape.compressed)} />
        <Row label="Dex" value={`${shape.dexCount} file(s), ${human(shape.dexBytes)}`} />
        <Row label="Native" value={`${shape.libCount} lib(s), ${human(shape.libBytes)}`} />
        <Row label="Resources" value={human(shape.resBytes)} />
        <Row label="Assets" value={human(shape.assetBytes)} />
        <Row label="ABIs" value={shape.abis.join(', ') || 'none'} />
      </Panel>

      <Panel title="Signing">
        <Row
          label="Schemes"
          value={zip.signing.schemes.length ? zip.signing.schemes.join(', ') : 'unsigned'}
          color={zip.signing.schemes.length ? colors.acid : colors.red}
        />
        <Row label="Block" value={zip.signing.present ? human(zip.signing.size) : 'absent'} />
      </Panel>

      <Panel title="Dex">
        {dexStats.length ? (
          dexStats.map((d) => (
            <Row key={d.name} label={d.name} value={`${d.classes} classes · ${human(d.size)}`} />
          ))
        ) : (
          <Empty text="No classes.dex — this APK carries no Java/Kotlin bytecode." />
        )}
      </Panel>

      <Panel title={`Native libraries${libs.length >= 40 ? ' · first 40' : ''}`}>
        {libs.length ? (
          libs.map((l, i) => (
            <View key={`${l.abi}/${l.name}/${i}`} style={s.lib}>
              <View style={s.libHead}>
                <Text style={s.libName} numberOfLines={1} selectable>
                  {l.name}
                </Text>
                <Chip text={l.abi} tone="info" />
              </View>
              <Text style={s.libMeta}>
                {human(l.size)}
                {l.machine ? ` · ${l.machine}` : ''}
                {l.error ? ` · unreadable: ${l.error}` : ''}
              </Text>
              {l.needed?.length ? (
                <Text style={s.libNeeded} numberOfLines={2}>
                  needs {l.needed.slice(0, 6).join(', ')}
                  {l.needed.length > 6 ? ` +${l.needed.length - 6}` : ''}
                </Text>
              ) : null}
            </View>
          ))
        ) : (
          <Empty text="No .so files — pure Java/Kotlin, or code shipped some other way." />
        )}
      </Panel>

      <Panel title="Largest entries">
        {shape.biggest.map((e) => (
          <Row key={e.name} label={human(e.size)} value={e.name} />
        ))}
      </Panel>

      <Panel title="Permissions">
        {facts.permissions.length ? (
          <View style={s.chips}>
            {facts.permissions.map((p) => (
              <Chip
                key={p}
                text={p.replace('android.permission.', '')}
                tone={/QUERY_ALL_PACKAGES|REQUEST_INSTALL|SYSTEM_ALERT|READ_LOGS/.test(p) ? 'med' : 'info'}
              />
            ))}
          </View>
        ) : (
          <Empty text="Declares no permissions." />
        )}
        {facts.permissions.some((p) => p.includes('QUERY_ALL_PACKAGES')) ? (
          <Note tone="med">
            QUERY_ALL_PACKAGES lets this app enumerate every package installed on the
            device. Legitimate for tooling; worth knowing about in a game.
          </Note>
        ) : null}
      </Panel>
    </Screen>
  );
}

const s = StyleSheet.create({
  lib: {
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line2,
    gap: 2,
  },
  libHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  libName: { color: colors.paper, fontSize: 12.5, fontFamily: mono, flex: 1 },
  libMeta: { color: colors.dim2, fontSize: 11 },
  libNeeded: { color: colors.dim2, fontSize: 10.5, fontFamily: mono },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
});
