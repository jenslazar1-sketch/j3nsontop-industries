import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, Panel, Row, Empty, Chip, SevChip, Note } from '@/components/ui';
import { colors, space, mono, sevColor } from '@/theme';
import { useApk } from '@/src/lib/store';

/* Libraries whose names are a mod menu or a hooking framework. Kept in step
 * with tamper.js — this is only for labelling the list the user sees; the
 * verdict itself always comes from the engine. */
const MODRE = /(mod|menu|cheat|hack|inject|hook|frida|substrate|xposed|lsposed|dobby|gadget|melon|bepinex)/i;
const LEGITRE = /^(libunity|libil2cpp|libmain|libc\+\+_shared|libfmod|libopenxr|libvrapi|libGLESv|liblog|libz|libandroid|libmono|libjpeg|libpng|libwebp|libsqlite|libcrypto|libssl|libavcodec|libhermes|libfb|libreactnative|libjsc)/i;

function libVerdict(name: string) {
  if (MODRE.test(name)) return { label: 'MOD · HOOK', tone: 'critical' };
  if (LEGITRE.test(name)) return { label: 'engine', tone: 'ok' };
  return { label: 'unknown', tone: 'info' };
}

export default function Integrity() {
  const { analysis } = useApk();

  if (!analysis) {
    return (
      <Screen>
        <Panel title="Integrity">
          <Empty text="No APK loaded. Open the Load tab and pick one." />
        </Panel>
      </Screen>
    );
  }

  const t = analysis.tamper;
  if (!t) {
    return (
      <Screen>
        <Panel title="Integrity">
          <Empty text="The integrity engine could not run on this file." />
        </Panel>
      </Screen>
    );
  }

  const accent = sevColor[t.level] ?? colors.dim;

  return (
    <Screen>
      <View style={[s.verdict, { borderColor: accent }]}>
        <Text style={[s.verdictText, { color: accent }]}>{t.verdict}</Text>
        <Text style={s.verdictSub}>
          score {t.score} · {t.findings.length} signal{t.findings.length === 1 ? '' : 's'}
        </Text>
      </View>

      <Note>
        No single check proves a repack. These are independent signals, scored —
        the evidence is shown so the call stays yours.
      </Note>

      <Panel title="Signals">
        {t.findings.length ? (
          t.findings.map((f: any, i: number) => (
            <View key={f.id ?? i} style={s.finding}>
              <View style={s.findingHead}>
                <SevChip sev={f.sev} />
                <Text style={s.findingTitle}>{f.title}</Text>
              </View>
              <Text style={s.findingDetail}>{f.detail}</Text>
              {f.evidence ? (
                <Text style={s.evidence} numberOfLines={4} selectable>
                  {f.evidence}
                </Text>
              ) : null}
            </View>
          ))
        ) : (
          <Empty text="Nothing flagged. Signing, payload, manifest and physical layout all look like an untouched build." />
        )}
      </Panel>

      <Panel title="Signers">
        <Row
          label="Schemes"
          value={t.schemes.length ? t.schemes.join(', ') : 'unsigned'}
          color={t.schemes.length ? colors.acid : colors.red}
        />
        {analysis.certs.length ? (
          analysis.certs.map((c: any, i: number) => (
            <View key={i} style={s.cert}>
              <Text style={s.certSubject} selectable>{c.subject}</Text>
              <Text style={s.certMeta}>issued by {c.issuer}</Text>
              <Text style={s.certMeta}>serial {c.serial}</Text>
              {c.fp ? (
                <Text style={s.fp} selectable>
                  SHA-256 {c.fp.sha256}
                </Text>
              ) : (
                <Text style={s.certMeta}>fingerprint unavailable</Text>
              )}
              <View style={s.chips}>
                {(c.schemes ?? []).map((sc: string) => (
                  <Chip key={sc} text={sc} tone="ok" />
                ))}
              </View>
            </View>
          ))
        ) : (
          <Empty text="No certificates recovered — the APK is unsigned or the block is damaged." />
        )}
      </Panel>

      <Panel title="Native libraries">
        {analysis.libs.length ? (
          Array.from(new Set(analysis.libs.map((l) => l.name))).map((name) => {
            const v = libVerdict(name);
            return (
              <View key={name} style={s.libRow}>
                <Text style={s.libName} numberOfLines={1} selectable>{name}</Text>
                <Chip text={v.label} tone={v.tone} />
              </View>
            );
          })
        ) : (
          <Empty text="No native libraries." />
        )}
      </Panel>

      <Panel title="Loaded by code">
        {Object.keys(t.loadedLibs ?? {}).length ? (
          Object.keys(t.loadedLibs).map((k) => (
            <Row key={k} label="loadLibrary" value={k} />
          ))
        ) : (
          <Empty text="No System.loadLibrary() names recovered from the dex." />
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
  verdictText: { fontSize: 26, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  verdictSub: { color: colors.dim2, fontSize: 12, fontFamily: mono },
  finding: {
    paddingVertical: space.sm, gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line2,
  },
  findingHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  findingTitle: { color: colors.paper, fontSize: 13, fontWeight: '700', flex: 1 },
  findingDetail: { color: colors.dim, fontSize: 12, lineHeight: 17 },
  evidence: {
    color: colors.dim2, fontSize: 10.5, fontFamily: mono,
    backgroundColor: colors.ink, padding: 6, borderRadius: 4,
  },
  cert: { paddingVertical: space.sm, gap: 2 },
  certSubject: { color: colors.paper, fontSize: 12.5, fontWeight: '700' },
  certMeta: { color: colors.dim2, fontSize: 11 },
  fp: { color: colors.cyan, fontSize: 10, fontFamily: mono, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  libRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line2,
  },
  libName: { color: colors.paper, fontSize: 12, fontFamily: mono, flex: 1 },
});
