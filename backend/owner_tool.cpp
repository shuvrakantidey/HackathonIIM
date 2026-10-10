// owner_tool.cpp - Saarthi AI owner security module (C++17, no external libraries, Linux/macOS)
//
//   ./owner_tool generate              -> prints JSON {"password","salt","hash"}
//   echo "<password>" | ./owner_tool verify <saltHex> <hashHex>   -> prints "ok" or "no"
//
// The password is generated from the operating system's secure random source and stored
// only as a PBKDF2-HMAC-SHA256 hash (100,000 rounds, random salt). The password itself is never saved.
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

static const int ITERATIONS = 100000;

// ---------- SHA-256 ----------
class Sha256 {
  uint32_t st[8];
  uint8_t buf[64];
  size_t blen = 0;
  uint64_t total = 0;
  static uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
  void compress(const uint8_t* p) {
    static const uint32_t K[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
    uint32_t w[64];
    for (int i = 0; i < 16; i++)
      w[i] = (uint32_t)p[i * 4] << 24 | (uint32_t)p[i * 4 + 1] << 16 | (uint32_t)p[i * 4 + 2] << 8 | (uint32_t)p[i * 4 + 3];
    for (int i = 16; i < 64; i++) {
      uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
    for (int i = 0; i < 64; i++) {
      uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      uint32_t ch = (e & f) ^ (~e & g);
      uint32_t t1 = h + S1 + ch + K[i] + w[i];
      uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      uint32_t mj = (a & b) ^ (a & c) ^ (b & c);
      uint32_t t2 = S0 + mj;
      h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    st[0] += a; st[1] += b; st[2] += c; st[3] += d; st[4] += e; st[5] += f; st[6] += g; st[7] += h;
  }

 public:
  Sha256() {
    static const uint32_t init[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    memcpy(st, init, sizeof(st));
  }
  void update(const uint8_t* d, size_t n) {
    total += n;
    while (n > 0) {
      size_t take = 64 - blen < n ? 64 - blen : n;
      memcpy(buf + blen, d, take);
      blen += take; d += take; n -= take;
      if (blen == 64) { compress(buf); blen = 0; }
    }
  }
  void final(uint8_t out[32]) {
    uint64_t bits = total * 8;
    uint8_t pad = 0x80;
    update(&pad, 1);
    uint8_t zero = 0;
    while (blen != 56) update(&zero, 1);
    uint8_t lenb[8];
    for (int i = 0; i < 8; i++) lenb[i] = (uint8_t)(bits >> (56 - 8 * i));
    update(lenb, 8);
    for (int i = 0; i < 8; i++) {
      out[i * 4] = st[i] >> 24; out[i * 4 + 1] = st[i] >> 16; out[i * 4 + 2] = st[i] >> 8; out[i * 4 + 3] = st[i];
    }
  }
};

// ---------- PBKDF2-HMAC-SHA256 (one 32-byte block) ----------
static std::vector<uint8_t> pbkdf2(const std::string& password, const std::vector<uint8_t>& salt, int iterations) {
  uint8_t key[64] = {0};
  if (password.size() > 64) {
    Sha256 k; k.update((const uint8_t*)password.data(), password.size()); k.final(key);
  } else {
    memcpy(key, password.data(), password.size());
  }
  uint8_t ipad[64], opad[64];
  for (int i = 0; i < 64; i++) { ipad[i] = key[i] ^ 0x36; opad[i] = key[i] ^ 0x5c; }
  Sha256 inner0, outer0;
  inner0.update(ipad, 64);
  outer0.update(opad, 64);

  auto hmac = [&](const uint8_t* msg, size_t n, uint8_t out[32]) {
    uint8_t ih[32];
    Sha256 in = inner0; in.update(msg, n); in.final(ih);
    Sha256 o = outer0; o.update(ih, 32); o.final(out);
  };

  std::vector<uint8_t> first(salt);
  first.push_back(0); first.push_back(0); first.push_back(0); first.push_back(1);  // block index 1
  uint8_t u[32], t[32];
  hmac(first.data(), first.size(), u);
  memcpy(t, u, 32);
  for (int i = 1; i < iterations; i++) {
    uint8_t next[32];
    hmac(u, 32, next);
    memcpy(u, next, 32);
    for (int j = 0; j < 32; j++) t[j] ^= u[j];
  }
  return std::vector<uint8_t>(t, t + 32);
}

// ---------- helpers ----------
static std::string toHex(const std::vector<uint8_t>& v) {
  static const char* d = "0123456789abcdef";
  std::string s;
  for (uint8_t b : v) { s += d[b >> 4]; s += d[b & 15]; }
  return s;
}
static bool fromHex(const std::string& s, std::vector<uint8_t>& out) {
  if (s.size() % 2) return false;
  out.clear();
  for (size_t i = 0; i < s.size(); i += 2) {
    auto nib = [](char c) -> int { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; };
    int a = nib(s[i]), b = nib(s[i + 1]);
    if (a < 0 || b < 0) return false;
    out.push_back((uint8_t)(a * 16 + b));
  }
  return true;
}
static bool secureRandom(uint8_t* out, size_t n) {
  std::ifstream f("/dev/urandom", std::ios::binary);
  f.read((char*)out, n);
  return (size_t)f.gcount() == n;
}

static std::string makePassword() {
  // No look-alike characters (no 0 O 1 l I). 57 symbols, 12 characters = about 70 bits.
  const std::string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const int limit = 256 - (256 % (int)alphabet.size());  // reject biased values
  std::string pw;
  while (pw.size() < 14) {
    if (pw.size() == 4 || pw.size() == 9) { pw += '-'; continue; }
    uint8_t b;
    if (!secureRandom(&b, 1)) return "";
    if (b >= limit) continue;
    pw += alphabet[b % alphabet.size()];
  }
  return pw;
}

int main(int argc, char** argv) {
  if (argc >= 2 && std::string(argv[1]) == "generate") {
    std::string pw = makePassword();
    std::vector<uint8_t> salt(16);
    if (pw.empty() || !secureRandom(salt.data(), salt.size())) { std::cerr << "random source unavailable\n"; return 1; }
    std::cout << "{\"password\":\"" << pw << "\",\"salt\":\"" << toHex(salt) << "\",\"hash\":\"" << toHex(pbkdf2(pw, salt, ITERATIONS)) << "\"}\n";
    return 0;
  }
  if (argc >= 4 && std::string(argv[1]) == "verify") {
    std::vector<uint8_t> salt, expected;
    if (!fromHex(argv[2], salt) || !fromHex(argv[3], expected) || expected.size() != 32) { std::cerr << "bad input\n"; return 1; }
    std::string pw;
    std::getline(std::cin, pw);
    if (!pw.empty() && pw.back() == '\r') pw.pop_back();
    std::vector<uint8_t> got = pbkdf2(pw, salt, ITERATIONS);
    uint8_t diff = 0;  // constant-time comparison
    for (int i = 0; i < 32; i++) diff |= got[i] ^ expected[i];
    std::cout << (diff == 0 ? "ok" : "no") << "\n";
    return 0;
  }
  // test mode used during development: ./owner_tool pbkdf2 <password> <salt text> <iterations>
  if (argc >= 5 && std::string(argv[1]) == "pbkdf2") {
    std::string s = argv[3];
    std::cout << toHex(pbkdf2(argv[2], std::vector<uint8_t>(s.begin(), s.end()), atoi(argv[4]))) << "\n";
    return 0;
  }
  std::cerr << "usage: owner_tool generate | owner_tool verify <saltHex> <hashHex> (password on stdin)\n";
  return 2;
}
