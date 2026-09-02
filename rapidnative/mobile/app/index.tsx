import React, { useCallback } from 'react';
import { View, Text, StyleSheet, InteractionManager } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Screen, Panel, Row, Button, Note, Chip } from '@/components/ui';
import { colors, space, mono } from '@/theme';
import { pickApk, WARN_BYTES } from '@/src/lib/files';
import { useApk, setState, clear, type Analysis } from '@/src/lib/store';
import { analyse, human } from '@/src/lib/analyse';

export default function Home() {
  const { file, analysis, busy, error, elapsedMs } = useApk();

  const onLoad = useCallback(async () => {
    setState({ error: null });
    let picked;
    try {
      picked = await pickApk();
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (!picked) return;

    setState({ file: picked, analysis: null, busy: true, error: null, elapsedMs: 0 });

    // Let the spinner actually paint before the parser takes the JS thread.
    InteractionManager.runAfterInteractions(async () => {
      const t0 = Date.now();
      try {
        const a: Analysis = await analyse(picked!.bytes);
        setState({ analysis: a, busy: false, elapsedMs: Date.now() - t0 });
        Haptics.notificationAsync(
          a.tamper && (a.tamper.level === 'critical' || a.tamper.level === 'high')
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Success
        ).catch(() => {});
      } catch (e) {
        setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  }, []);

  return (
    <Screen>
      <View style={s.hero}>
        <Text style={s.brand}>J3NSONTOP</Text>
        <Text style={s.sub}>INDUSTRIES</Text>
        <Text style={s.tag}>
          On-device APK analysis. Nothing is uploaded — every byte is parsed here.
        </Text>
      </View>

      <Button
        title={file ? 'LOAD ANOTHER APK' : 'LOAD AN APK'}
        onPress={onLoad}
        busy={busy}
      />

      {error ? <Note tone="critical">{error}</Note> : null}

      {busy && file ? (
        <Panel title="Working">
          <Row label="File" value={file.name} />
          <Row label="Size" value={human(file.size)} />
          <Note>
            {file.size > WARN_BYTES
              ? 'Large file — parsing runs on the JS thread and may take a few seconds.'
              : 'Parsing zip, manifest, dex, certificates and native libraries.'}
          </Note>
        </Panel>
      ) : null}

      {file && analysis && !busy ? (
        <>
          <Panel
            title="Loaded"
            right={<Chip text={`${elapsedMs} ms`} tone="ok" />}
          >
            <Row label="File" value={file.name} />
            <Row label="Package" value={analysis.facts.package ?? '—'} color={colors.acid} />
            <Row
              label="Version"
              value={`${analysis.facts.versionName ?? '?'} (${analysis.facts.versionCode ?? '?'})`}
            />
            <Row label="Size" value={human(analysis.size)} />
            <Row label="Entries" value={String(analysis.shape.entries)} />
            <Row label="ABIs" value={analysis.shape.abis.join(', ') || 'none (no native code)'} />
          </Panel>

          <Panel title="Verdicts">
            <Row
              label="Integrity"
              value={
                <View style={s.verdictRow}>
                  <Chip
                    text={analysis.tamper ? analysis.tamper.verdict : 'n/a'}
                    tone={analysis.tamper ? analysis.tamper.level : 'info'}
                  />
                </View>
              }
            />
            <Row
              label="VR"
              value={
                <View style={s.verdictRow}>
                  <Chip
                    text={analysis.vrVerdict ? analysis.vrVerdict.text : 'n/a'}
                    tone={analysis.vrVerdict ? analysis.vrVerdict.level : 'info'}
                  />
                </View>
              }
            />
            <View style={s.jump}>
              <Button title="APK LAB" tone="dim" onPress={() => router.push('/apklab')} />
              <Button title="INTEGRITY" tone="dim" onPress={() => router.push('/integrity')} />
            </View>
          </Panel>

          {analysis.errors.length ? (
            <Panel title="Parse notes">
              {analysis.errors.map((e, i) => (
                <Note key={i} tone="med">{e}</Note>
              ))}
            </Panel>
          ) : null}

          <Button title="CLEAR" tone="red" onPress={() => { clear(); }} />
        </>
      ) : null}

      {!file && !busy ? (
        <Panel title="What this reads">
          <Note>
            The zip container and its alignment, AndroidManifest.xml (binary XML),
            every classes.dex, the v1/v2/v3 signing certificates, and each native
            .so as an ELF. It reports what is there — it does not modify anything.
          </Note>
        </Panel>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space.lg, gap: 2 },
  brand: { color: colors.acid, fontSize: 34, fontWeight: '900', letterSpacing: 4 },
  sub: { color: colors.dim, fontSize: 13, fontWeight: '700', letterSpacing: 8 },
  tag: {
    color: colors.dim2, fontSize: 11.5, textAlign: 'center',
    marginTop: space.sm, paddingHorizontal: space.lg, lineHeight: 16,
    fontFamily: mono,
  },
  verdictRow: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6 },
  jump: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
});
