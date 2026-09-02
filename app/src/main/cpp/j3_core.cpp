/* J3NSONTOP INDUSTRIES - j3_core.cpp
 *
 * The hot loops, in native code.
 *
 * The JS engine can already do all of this, and on a 200 KB APK the difference
 * is invisible. On a 300 MB one it is the difference between "instant" and
 * "the phone thinks about it for half a minute", because the JS path also has
 * to move the bytes across the bridge first.
 *
 * So the split is: Java opens the file, native chews it, and only a small JSON
 * result ever reaches JavaScript. The bytes never leave native memory.
 */
#include <jni.h>
#include <android/log.h>
#include <zlib.h>
#include <cstring>
#include <cstdio>
#include <cmath>
#include <vector>
#include <string>

#define LOG_TAG "J3Native"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

namespace {

/* ------------------------------------------------------------------ md5 */

struct MD5 {
    uint32_t a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
    uint64_t len = 0;
    uint8_t buf[64];
    size_t have = 0;

    static uint32_t rol(uint32_t x, int n) { return (x << n) | (x >> (32 - n)); }

    void block(const uint8_t* p) {
        static const uint32_t K[64] = {
            0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
            0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
            0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
            0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
            0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
            0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
            0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
            0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391 };
        static const int S[64] = {
            7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22, 5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
            4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23, 6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21 };
        uint32_t M[16];
        for (int i = 0; i < 16; i++)
            M[i] = p[i*4] | (p[i*4+1] << 8) | (p[i*4+2] << 16) | ((uint32_t)p[i*4+3] << 24);
        uint32_t A = a, B = b, C = c, D = d, F; int g;
        for (int i = 0; i < 64; i++) {
            if (i < 16)      { F = (B & C) | (~B & D);  g = i; }
            else if (i < 32) { F = (D & B) | (~D & C);  g = (5*i + 1) & 15; }
            else if (i < 48) { F = B ^ C ^ D;           g = (3*i + 5) & 15; }
            else             { F = C ^ (B | ~D);        g = (7*i) & 15; }
            F += A + K[i] + M[g];
            A = D; D = C; C = B;
            B += rol(F, S[i]);
        }
        a += A; b += B; c += C; d += D;
    }

    void update(const uint8_t* p, size_t n) {
        len += n;
        while (n) {
            size_t take = 64 - have; if (take > n) take = n;
            memcpy(buf + have, p, take);
            have += take; p += take; n -= take;
            if (have == 64) { block(buf); have = 0; }
        }
    }

    void finish(uint8_t out[16]) {
        uint64_t bits = len * 8;
        uint8_t pad = 0x80;
        update(&pad, 1);
        uint8_t zero = 0;
        while (have != 56) update(&zero, 1);
        uint8_t l[8];
        for (int i = 0; i < 8; i++) l[i] = (uint8_t)(bits >> (i * 8));
        len -= 8;                       // the length bytes are not message data
        update(l, 8);
        uint32_t v[4] = { a, b, c, d };
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++) out[i*4+j] = (uint8_t)(v[i] >> (j * 8));
    }
};

/* ----------------------------------------------------------------- sha1 */

struct SHA1 {
    uint32_t h[5] = { 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0 };
    uint64_t len = 0;
    uint8_t buf[64];
    size_t have = 0;

    static uint32_t rol(uint32_t x, int n) { return (x << n) | (x >> (32 - n)); }

    void block(const uint8_t* p) {
        uint32_t w[80];
        for (int i = 0; i < 16; i++)
            w[i] = ((uint32_t)p[i*4] << 24) | (p[i*4+1] << 16) | (p[i*4+2] << 8) | p[i*4+3];
        for (int i = 16; i < 80; i++) w[i] = rol(w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16], 1);
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; i++) {
            uint32_t f, k;
            if (i < 20)      { f = (b & c) | (~b & d);           k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d;                    k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d);  k = 0x8F1BBCDC; }
            else             { f = b ^ c ^ d;                    k = 0xCA62C1D6; }
            uint32_t t = rol(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }

    void update(const uint8_t* p, size_t n) {
        len += n;
        while (n) {
            size_t take = 64 - have; if (take > n) take = n;
            memcpy(buf + have, p, take);
            have += take; p += take; n -= take;
            if (have == 64) { block(buf); have = 0; }
        }
    }

    void finish(uint8_t out[20]) {
        uint64_t bits = len * 8;
        uint8_t pad = 0x80; update(&pad, 1);
        uint8_t zero = 0; while (have != 56) update(&zero, 1);
        uint8_t l[8];
        for (int i = 0; i < 8; i++) l[i] = (uint8_t)(bits >> ((7 - i) * 8));
        len -= 8;
        update(l, 8);
        for (int i = 0; i < 5; i++)
            for (int j = 0; j < 4; j++) out[i*4+j] = (uint8_t)(h[i] >> ((3 - j) * 8));
    }
};

/* --------------------------------------------------------------- sha256 */

struct SHA256 {
    uint32_t h[8] = { 0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
                      0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19 };
    uint64_t len = 0;
    uint8_t buf[64];
    size_t have = 0;

    static uint32_t ror(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

    void block(const uint8_t* p) {
        static const uint32_t K[64] = {
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2 };
        uint32_t w[64];
        for (int i = 0; i < 16; i++)
            w[i] = ((uint32_t)p[i*4] << 24) | (p[i*4+1] << 16) | (p[i*4+2] << 8) | p[i*4+3];
        for (int i = 16; i < 64; i++) {
            uint32_t s0 = ror(w[i-15],7) ^ ror(w[i-15],18) ^ (w[i-15] >> 3);
            uint32_t s1 = ror(w[i-2],17) ^ ror(w[i-2],19)  ^ (w[i-2] >> 10);
            w[i] = w[i-16] + s0 + w[i-7] + s1;
        }
        uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
        for (int i = 0; i < 64; i++) {
            uint32_t S1 = ror(e,6) ^ ror(e,11) ^ ror(e,25);
            uint32_t ch = (e & f) ^ (~e & g);
            uint32_t t1 = hh + S1 + ch + K[i] + w[i];
            uint32_t S0 = ror(a,2) ^ ror(a,13) ^ ror(a,22);
            uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
            uint32_t t2 = S0 + maj;
            hh=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
        }
        h[0]+=a; h[1]+=b; h[2]+=c; h[3]+=d; h[4]+=e; h[5]+=f; h[6]+=g; h[7]+=hh;
    }

    void update(const uint8_t* p, size_t n) {
        len += n;
        while (n) {
            size_t take = 64 - have; if (take > n) take = n;
            memcpy(buf + have, p, take);
            have += take; p += take; n -= take;
            if (have == 64) { block(buf); have = 0; }
        }
    }

    void finish(uint8_t out[32]) {
        uint64_t bits = len * 8;
        uint8_t pad = 0x80; update(&pad, 1);
        uint8_t zero = 0; while (have != 56) update(&zero, 1);
        uint8_t l[8];
        for (int i = 0; i < 8; i++) l[i] = (uint8_t)(bits >> ((7 - i) * 8));
        len -= 8;
        update(l, 8);
        for (int i = 0; i < 8; i++)
            for (int j = 0; j < 4; j++) out[i*4+j] = (uint8_t)(h[i] >> ((3 - j) * 8));
    }
};

std::string hex(const uint8_t* p, size_t n) {
    static const char* D = "0123456789abcdef";
    std::string s;
    s.reserve(n * 2);
    for (size_t i = 0; i < n; i++) { s += D[p[i] >> 4]; s += D[p[i] & 15]; }
    return s;
}

/* One pass over the buffer feeding all three digests plus the histogram, so a
 * 300 MB file is read once rather than four times. */
struct Digests {
    MD5 md5; SHA1 sha1; SHA256 sha256;
    uLong crc = crc32(0L, Z_NULL, 0);
    uint64_t freq[256] = {0};
    uint64_t total = 0;

    void feed(const uint8_t* p, size_t n) {
        md5.update(p, n); sha1.update(p, n); sha256.update(p, n);
        crc = crc32(crc, p, (uInt)n);
        for (size_t i = 0; i < n; i++) freq[p[i]]++;
        total += n;
    }

    double entropy() const {
        if (!total) return 0.0;
        double e = 0.0;
        for (int i = 0; i < 256; i++) {
            if (!freq[i]) continue;
            double pr = (double)freq[i] / (double)total;
            e -= pr * log2(pr);
        }
        return e;
    }

    std::string json() {
        uint8_t m[16], s1[20], s2[32];
        md5.finish(m); sha1.finish(s1); sha256.finish(s2);
        char crcbuf[16];
        snprintf(crcbuf, sizeof crcbuf, "%08lx", (unsigned long)crc);
        char ent[32];
        snprintf(ent, sizeof ent, "%.4f", entropy());
        return std::string("{\"size\":") + std::to_string(total) +
               ",\"crc32\":\"" + crcbuf + "\"" +
               ",\"md5\":\"" + hex(m, 16) + "\"" +
               ",\"sha1\":\"" + hex(s1, 20) + "\"" +
               ",\"sha256\":\"" + hex(s2, 32) + "\"" +
               ",\"entropy\":" + ent + ",\"native\":true}";
    }
};

jbyteArray toByteArray(JNIEnv* env, const std::vector<uint8_t>& v) {
    jbyteArray out = env->NewByteArray((jsize)v.size());
    if (!out) return nullptr;
    env->SetByteArrayRegion(out, 0, (jsize)v.size(), (const jbyte*)v.data());
    return out;
}

} // namespace

extern "C" {

JNIEXPORT jstring JNICALL
Java_com_j3nsontop_industries_NativeCore_digest(JNIEnv* env, jclass, jbyteArray data) {
    jsize n = env->GetArrayLength(data);
    jbyte* p = env->GetByteArrayElements(data, nullptr);
    Digests d;
    d.feed((const uint8_t*)p, (size_t)n);
    env->ReleaseByteArrayElements(data, p, JNI_ABORT);
    return env->NewStringUTF(d.json().c_str());
}

/** Streaming variant: Java hands us a chunk at a time, we keep the state. */
JNIEXPORT jlong JNICALL
Java_com_j3nsontop_industries_NativeCore_digestOpen(JNIEnv*, jclass) {
    return (jlong)(intptr_t)new Digests();
}

JNIEXPORT void JNICALL
Java_com_j3nsontop_industries_NativeCore_digestFeed(JNIEnv* env, jclass, jlong h,
                                                    jbyteArray data, jint len) {
    auto* d = (Digests*)(intptr_t)h;
    if (!d) return;
    jbyte* p = env->GetByteArrayElements(data, nullptr);
    d->feed((const uint8_t*)p, (size_t)len);
    env->ReleaseByteArrayElements(data, p, JNI_ABORT);
}

JNIEXPORT jstring JNICALL
Java_com_j3nsontop_industries_NativeCore_digestClose(JNIEnv* env, jclass, jlong h) {
    auto* d = (Digests*)(intptr_t)h;
    if (!d) return env->NewStringUTF("{}");
    std::string j = d->json();
    delete d;
    return env->NewStringUTF(j.c_str());
}

/** Raw DEFLATE, the format every zip entry actually uses. */
JNIEXPORT jbyteArray JNICALL
Java_com_j3nsontop_industries_NativeCore_inflateRaw(JNIEnv* env, jclass,
                                                    jbyteArray src, jint expected) {
    jsize n = env->GetArrayLength(src);
    jbyte* p = env->GetByteArrayElements(src, nullptr);

    z_stream zs{};
    // Negative window bits selects raw deflate with no zlib/gzip wrapper.
    if (inflateInit2(&zs, -MAX_WBITS) != Z_OK) {
        env->ReleaseByteArrayElements(src, p, JNI_ABORT);
        return nullptr;
    }

    std::vector<uint8_t> out;
    out.resize(expected > 0 ? (size_t)expected : (size_t)n * 4 + 1024);

    zs.next_in = (Bytef*)p;
    zs.avail_in = (uInt)n;
    size_t written = 0;
    int rc;
    do {
        if (written == out.size()) out.resize(out.size() * 2);
        zs.next_out = out.data() + written;
        zs.avail_out = (uInt)(out.size() - written);
        rc = inflate(&zs, Z_NO_FLUSH);
        written = out.size() - zs.avail_out;
        if (rc == Z_STREAM_END) break;
        if (rc != Z_OK && rc != Z_BUF_ERROR) break;
        if (rc == Z_BUF_ERROR && zs.avail_in == 0) break;
    } while (true);

    inflateEnd(&zs);
    env->ReleaseByteArrayElements(src, p, JNI_ABORT);

    if (rc != Z_STREAM_END) return nullptr;
    out.resize(written);
    return toByteArray(env, out);
}

JNIEXPORT jstring JNICALL
Java_com_j3nsontop_industries_NativeCore_version(JNIEnv* env, jclass) {
    std::string s = std::string("{\"zlib\":\"") + zlibVersion() + "\"";
#if defined(__aarch64__)
    s += ",\"abi\":\"arm64-v8a\"";
#elif defined(__x86_64__)
    s += ",\"abi\":\"x86_64\"";
#elif defined(__arm__)
    s += ",\"abi\":\"armeabi-v7a\"";
#else
    s += ",\"abi\":\"?\"";
#endif
    s += ",\"ok\":true}";
    return env->NewStringUTF(s.c_str());
}

} // extern "C"
