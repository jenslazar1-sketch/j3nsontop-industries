import React from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { Screen, Panel, Row, Note } from '@/components/ui';
import { colors } from '@/theme';
import { useApk } from '@/src/lib/store';

export default function Intel() {
  const { analysis, elapsedMs } = useApk();
  const hasWebCrypto =
    typeof globalThis.crypto !== 'undefined' && !!(globalThis.crypto as any).subtle;

  return (
    <Screen>
      <Panel title="Device">
        <Row label="Platform" value={`${Platform.OS} ${String(Platform.Version)}`} />
        <Row label="Expo SDK" value={Constants.expoConfig?.sdkVersion ?? 'unknown'} />
        <Row label="App version" value={Constants.expoConfig?.version ?? '—'} />
        <Row label="Engine" value={(global as any).HermesInternal ? 'Hermes' : 'JSC'} />
        <Row label="Dev build" value={__DEV__ ? 'yes' : 'no'} />
      </Panel>

      <Panel title="Crypto">
        <Row
          label="WebCrypto"
          value={hasWebCrypto ? 'available' : 'shimmed'}
          color={colors.acid}
        />
        <Note>
          Certificate fingerprints need SHA-256 and SHA-1. React Native ships no
          WebCrypto, so the app installs a plain-JS implementation at startup.
          Either way the digests are identical — the engines never had to change.
        </Note>
      </Panel>

      <Panel title="Engines">
        <Note>
          zip · axml · attrs · dex · smali · cert · elf · vrscan · tamper · binary
          {'\n\n'}
          All ten are the same files the Android app, the iOS app and the CLI run,
          copied in unmodified. They are pure parsers over byte arrays with no DOM
          in them, so React Native loads them directly.
        </Note>
      </Panel>

      {analysis ? (
        <Panel title="Last analysis">
          <Row label="Package" value={analysis.facts.package ?? '—'} />
          <Row label="Parsed in" value={`${elapsedMs} ms`} />
          <Row label="Entries" value={String(analysis.shape.entries)} />
          <Row label="Signals" value={String(analysis.tamper?.findings.length ?? 0)} />
        </Panel>
      ) : null}

      <Panel title="Privacy">
        <Note>
          Nothing leaves the device. There is no network code in the analysis
          path at all — files are read from the picker, parsed in memory, and
          dropped when you hit clear.
        </Note>
      </Panel>
    </Screen>
  );
}
