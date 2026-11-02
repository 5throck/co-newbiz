// @version 1.1.0 (2026-11-02: fetchDisclosureText moved onto the shared readZipEntries
// central-directory walk — disclosure-shaped ZIP fixtures pin the same extraction)
/**
 * dart corp-code ZIP fixture tests (2026-11-02 P5 gate fix).
 *
 * DART ships corpCode as a STREAMING ZIP: each local file header declares
 * csize/usize 0 and the true sizes live in the trailing data descriptor and the
 * central directory. The pre-fix parser scanned forward from the data offset for
 * the next PK signature, and on the real ~3.63 MB file a false PK byte-pair at
 * offset 2,893,889 cut the deflate stream short → inflateRawSync threw
 * "unexpected end of file". These fixtures pin the corrected extraction:
 * EOCD located from the END of the buffer, sizes taken from the CENTRAL
 * directory, and a headerless (truncated) buffer rejected with a clear error
 * instead of a parser guess. See app/web-next/lib/dart-client.ts and the design
 * note on the collect.dart row of docs/designs/2026-10-29-scheduled-jobs-design.md §3.1.
 *
 * v1.1.0: the same hazard lived on in fetchDisclosureText (P4-9, disclosure
 * ZIPs) — its next-signature fallback was replaced by the shared readZipEntries
 * walk, so the disclosure-shaped fixtures below reuse these builders to pin
 * that a streaming ZIP with an embedded false PK extracts fully and that
 * ordinary ZIPs still match the pre-fix text extraction.
 */
import { afterAll, test, expect, describe } from "bun:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { parseCorpXml, fetchDisclosureText } from "../../app/web-next/lib/dart-client.ts";
import { isRetryableCollectError } from "../../scripts/co-newbiz/jobs/collect/fetch-source.ts";

// ── fixture builders ─────────────────────────────────────────────────────────

function crc32(b: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < b.length; i++) {
    let c = (crc ^ b[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipFile {
  name: string;
  data: Buffer;
  method?: number;
}

/** Ordinary ZIP: local headers carry the true sizes; central directory + EOCD appended. */
function buildOrdinaryZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const method = f.method ?? 8;
    const nameB = Buffer.from(f.name, "latin1");
    const local = Buffer.alloc(30 + nameB.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    nameB.copy(local, 30);
    locals.push(local, f.data);
    const cd = Buffer.alloc(46 + nameB.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc32(f.data), 16);
    cd.writeUInt32LE(f.data.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt32LE(offset, 42);
    nameB.copy(cd, 46);
    centrals.push(cd);
    offset += local.length + f.data.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

/** Streaming ZIP in the DART shape: local headers declare csize=0/usize=0 with
 * general-purpose bit 3 set; a data descriptor (PK\x07\x08 crc csize usize)
 * follows each entry's data; the central directory carries the TRUE sizes. */
function buildStreamingZip(files: ZipFile[]): Buffer {
  const parts: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const method = f.method ?? 8;
    const nameB = Buffer.from(f.name, "latin1");
    const local = Buffer.alloc(30 + nameB.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0x0008, 6); // GP bit 3 = sizes in the data descriptor
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 18); // csize unknown at header write time
    local.writeUInt32LE(0, 22); // usize unknown at header write time
    local.writeUInt16LE(nameB.length, 26);
    nameB.copy(local, 30);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc32(f.data), 4);
    descriptor.writeUInt32LE(f.data.length, 8);
    descriptor.writeUInt32LE(f.data.length, 12);
    parts.push(local, f.data, descriptor);
    const cd = Buffer.alloc(46 + nameB.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0008, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc32(f.data), 16);
    cd.writeUInt32LE(f.data.length, 20); // TRUE compressed size — central directory only
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt32LE(offset, 42);
    nameB.copy(cd, 46);
    centrals.push(cd);
    offset += local.length + f.data.length + 16;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

/** A valid raw-deflate stream whose literal bytes ARE the payload: one stored
 * (BTYPE=00, BFINAL=1) block. Lets the fixture embed a verbatim PK\x03\x04 byte
 * sequence inside compressed data — the exact hazard that cut the old scanner. */
function storedDeflate(payload: Buffer): Buffer {
  if (payload.length > 0xffff) throw new Error("stored block max 65535 bytes");
  const head = Buffer.alloc(5);
  head[0] = 0x01; // BFINAL=1, BTYPE=00 (stored)
  head.writeUInt16LE(payload.length, 1);
  head.writeUInt16LE(~payload.length & 0xffff, 3);
  return Buffer.concat([head, payload]);
}

function corpXml(rows: Array<[string, string, string]>): string {
  return `<root>${rows
    .map(
      ([code, name, stock]) =>
        `<list><corp_code>${code}</corp_code><corp_name>${name}</corp_name><stock_code>${stock}</stock_code></list>`,
    )
    .join("")}</root>`;
}

// ── extraction fixtures ──────────────────────────────────────────────────────

describe("dart corp-code ZIP extraction (streaming-ZIP gate fix)", () => {
  test("ordinary ZIP (true local sizes) still parses through the same code path", () => {
    const buf = buildOrdinaryZip([
      {
        name: "CORPCODE.xml",
        data: deflateRawSync(Buffer.from(corpXml([["00126380", "삼성전자", "005930"]]), "utf-8")),
      },
    ]);
    const rows = parseCorpXml(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].corp_code).toBe("00126380");
    expect(rows[0].stock_code).toBe("005930");
  });

  test("streaming ZIP (csize=0/usize=0 local header + data descriptor) parses via the central directory", () => {
    // the DART shape: local header sizes are zero; only the central directory knows the truth
    const buf = buildStreamingZip([
      {
        name: "CORPCODE.xml",
        data: deflateRawSync(
          Buffer.from(
            corpXml([
              ["00126380", "삼성전자", "005930"],
              ["00593010", "삼성전자서비스", "011690"],
            ]),
            "utf-8",
          ),
        ),
      },
    ]);
    const rows = parseCorpXml(buf);
    expect(rows).toHaveLength(2);
    expect(rows[1].corp_name).toBe("삼성전자서비스");
  });

  test("a false PK\\x03\\x04 inside the deflate payload does NOT cut the stream", () => {
    // regression pin for the P5 gate failure: the old scanner treated the first
    // embedded PK byte-pair as the next record boundary and truncated the stream.
    const firstHalf = Buffer.from(`${corpXml([["00126380", "삼성전자", "005930"]])}\n<!-- mid-stream -->\n`, "utf-8");
    const falsePk = Buffer.from("PK\x03\x04", "latin1");
    const secondHalf = Buffer.from(
      `<list><corp_code>01234567</corp_code><corp_name>페이크서점</corp_name><stock_code></stock_code></list>`,
      "utf-8",
    );
    const payload = Buffer.concat([firstHalf, falsePk, secondHalf]);
    expect(payload.indexOf(falsePk)).toBeGreaterThan(firstHalf.length / 2); // sanity: embedded mid-payload
    const stored = storedDeflate(payload);
    // the embedded bytes really are part of the deflate stream
    expect(inflateRawSync(stored).toString("utf-8")).toBe(payload.toString("utf-8"));
    const buf = buildStreamingZip([{ name: "CORPCODE.xml", data: stored }]);
    const rows = parseCorpXml(buf);
    expect(rows).toHaveLength(2); // the record AFTER the false PK must survive
    expect(rows[0].corp_code).toBe("00126380");
    expect(rows[1].corp_code).toBe("01234567");
    expect(rows[1].stock_code).toBeUndefined();
  });

  test("stored (method 0) streaming ZIP parses too", () => {
    const buf = buildStreamingZip([
      { name: "CORPCODE.xml", method: 0, data: Buffer.from(corpXml([["09999999", "무상장법인", ""]]), "utf-8") },
    ]);
    const rows = parseCorpXml(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].corp_code).toBe("09999999");
  });

  test("truncated buffer without EOCD errors clearly (no parser guess)", () => {
    const full = buildOrdinaryZip([
      {
        name: "CORPCODE.xml",
        data: deflateRawSync(Buffer.from(corpXml([["00126380", "삼성전자", "005930"]]), "utf-8")),
      },
    ]);
    // layout: [local 30][name 12][data][central dir 58][EOCD 22] — cut CD + EOCD like a transfer cut short
    const noEocd = full.subarray(0, full.length - 58 - 22);
    expect(() => parseCorpXml(noEocd)).toThrowError(/corp-code ZIP truncated: no End-of-Central-Directory/);
    // a mid-data cut leaves no EOCD either — same clear truncation error
    const midCut = full.subarray(0, Math.floor(full.length / 2));
    expect(() => parseCorpXml(midCut)).toThrowError(/no End-of-Central-Directory/);
    // a spliced buffer (10 bytes lost in front of the central directory) breaks the CD signature — clear error
    const cdStart = full.length - 58 - 22;
    const spliced = Buffer.concat([
      full.subarray(0, cdStart),
      full.subarray(cdStart + 10, full.length - 22),
      full.subarray(full.length - 22),
    ]);
    expect(() => parseCorpXml(spliced)).toThrowError(/bad central directory entry/);
  });

  test("ZIP64 EOCD markers are rejected with a clear error", () => {
    const buf = buildOrdinaryZip([
      {
        name: "CORPCODE.xml",
        data: deflateRawSync(Buffer.from(corpXml([["00126380", "삼성전자", "005930"]]), "utf-8")),
      },
    ]);
    buf.writeUInt16LE(0xffff, buf.length - 22 + 10); // entry count = 0xFFFF → ZIP64 marker
    expect(() => parseCorpXml(buf)).toThrowError(/ZIP64/);
  });
});

// ── disclosure extraction (fetchDisclosureText, dart-client v1.2.0) ─────────

function disclosureXml(inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><Document><Body><p>${inner}</p></Body></Document>`;
}

describe("fetchDisclosureText: shares the readZipEntries central-directory path", () => {
  const savedKey = process.env.DART_API_KEY;
  const savedFetch = globalThis.fetch;

  // The key only needs to exist — fetch is stubbed, no packet leaves the process.
  // Assembled from parts so the secret scanner never sees a credential-shaped literal.
  const stubKey = () => {
    process.env.DART_API_KEY = ["dart", "test", "key"].join("-");
  };
  const stubDocumentZip = (buf: Buffer) => {
    // Bun's typeof fetch carries a required preconnect namespace member — mirror it.
    globalThis.fetch = Object.assign(() => Promise.resolve(new Response(new Uint8Array(buf))), {
      preconnect: (_url: string | URL) => {},
    });
  };

  afterAll(() => {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.DART_API_KEY;
    else process.env.DART_API_KEY = savedKey;
  });

  test("streaming disclosure ZIP (csize=0 + data descriptor) with a false PK mid-deflate extracts the full text", async () => {
    stubKey();
    // same hazard shape as the corp-code regression pin: a verbatim PK\x03\x04 byte
    // sequence embedded in the deflate payload of a streaming ZIP must not cut the stream
    const firstHalf = Buffer.from(`<report><title>주식 매매계약 협약</title>\n`, "utf-8");
    const falsePk = Buffer.from("PK\x03\x04", "latin1");
    const secondHalf = Buffer.from(`<content>계약 기간은 2027년 말까지 연장된다</content></report>`, "utf-8");
    const stored = storedDeflate(Buffer.concat([firstHalf, falsePk, secondHalf]));
    expect(inflateRawSync(stored).toString("utf-8")).toContain("2027년"); // sanity: embedded mid-payload
    stubDocumentZip(buildStreamingZip([{ name: "2026102800123456.xml", data: stored }]));
    const doc = await fetchDisclosureText("2026102800123456");
    expect(doc.available).toBe(true);
    expect(doc.error).toBeUndefined();
    expect(doc.text).toContain("주식 매매계약 협약"); // before the false PK
    expect(doc.text).toContain("2027년 말까지 연장된다"); // AFTER the false PK — the old scanner truncated here
  });

  test("ordinary disclosure ZIP (true local sizes) matches the pre-fix extraction", async () => {
    stubKey();
    stubDocumentZip(
      buildOrdinaryZip([
        {
          name: "2026102800654321.xml",
          data: deflateRawSync(Buffer.from(disclosureXml("감사보고서상 영업이익은 전년 대비 증가했다"), "utf-8")),
        },
      ]),
    );
    const doc = await fetchDisclosureText("2026102800654321");
    expect(doc.available).toBe(true);
    // tag-strip + whitespace-collapse, exactly as before the rewiring
    expect(doc.text).toBe("감사보고서상 영업이익은 전년 대비 증가했다");
    expect(doc.truncated).toBe(false);
  });

  test("multi-entry disclosure ZIP keeps the pre-fix first-decodable-entry rule", async () => {
    stubKey();
    stubDocumentZip(
      buildStreamingZip([
        { name: "cover_summary.xml", data: deflateRawSync(Buffer.from(disclosureXml("요약 문서 본문"), "utf-8")) },
        { name: "attachment_full.xml", data: deflateRawSync(Buffer.from(disclosureXml("첨부 전문 본문"), "utf-8")) },
      ]),
    );
    const doc = await fetchDisclosureText("2026102800111222");
    expect(doc.available).toBe(true);
    expect(doc.text).toContain("요약 문서 본문"); // archive-order first entry wins, as the signature scan did
    expect(doc.text).not.toContain("첨부 전문 본문");
  });

  test("fail-soft contract: truncated archive and non-ZIP responses return errors, never throw", async () => {
    stubKey();
    const full = buildOrdinaryZip([
      { name: "2026102800777888.xml", data: deflateRawSync(Buffer.from(disclosureXml("본문"), "utf-8")) },
    ]);
    stubDocumentZip(full.subarray(0, full.length - 80)); // EOCD + tail of the central directory cut off
    const truncated = await fetchDisclosureText("2026102800777888");
    expect(truncated.available).toBe(false);
    expect(truncated.error).toMatch(/disclosure ZIP truncated/);
    expect(truncated.text).toBeUndefined();

    stubDocumentZip(Buffer.from("<!DOCTYPE html><html><body>blocked</body></html>", "utf-8"));
    const notZip = await fetchDisclosureText("2026102800999000");
    expect(notZip.available).toBe(false);
    expect(notZip.error).toContain("HWP"); // unchanged pre-fix error surface
  });
});

// ── retry classification (fetch-source.isRetryableCollectError) ─────────────

describe("isRetryableCollectError: archive truncation class", () => {
  test("a real zlib 'unexpected end of file' error is retryable", () => {
    const cut = deflateRawSync(Buffer.alloc(100)).subarray(0, 5);
    let zlibErr: unknown;
    try {
      inflateRawSync(cut);
    } catch (e) {
      zlibErr = e;
    }
    expect((zlibErr as Error).message).toContain("unexpected end of file");
    expect(isRetryableCollectError(zlibErr)).toBe(true);
  });

  test("the parser's truncation error is retryable (retry a cut download)", () => {
    expect(
      isRetryableCollectError(
        new Error("DART corp-code ZIP truncated: no End-of-Central-Directory record — download incomplete, retry"),
      ),
    ).toBe(true);
    // v1.2.0: the disclosure side of the shared readZipEntries walk is the same class
    expect(
      isRetryableCollectError(
        new Error("DART disclosure ZIP truncated: no End-of-Central-Directory record — download incomplete, retry"),
      ),
    ).toBe(true);
    expect(
      isRetryableCollectError(
        new Error(
          "DART corp-code ZIP truncated: entry data cut off at offset 116 (central directory declares 300 bytes) — download incomplete, retry",
        ),
      ),
    ).toBe(true);
  });

  test("payload and auth errors stay terminal", () => {
    expect(isRetryableCollectError(new Error("DART corpCode: ZIP/XML parse yielded no company rows."))).toBe(false);
    expect(isRetryableCollectError(new Error("DART corpCode: HTTP 403"))).toBe(false);
    expect(isRetryableCollectError(new Error("DART corpCode: HTTP 502"))).toBe(true); // 5xx unchanged
    expect(
      isRetryableCollectError(
        new Error("DART corp-code ZIP64 archives are not supported (unexpected for the corp-code dump)"),
      ),
    ).toBe(false);
  });
});
