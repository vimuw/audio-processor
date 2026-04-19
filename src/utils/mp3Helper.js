// ─── MP3 frame constants ──────────────────────────────────────────────────────

// Bitrate lookup in kbps — indexed by [mpegVersion][layer][bitrateIndex]
// mpegVersion: 3=MPEG1, 2=MPEG2, 0=MPEG2.5   (value 1 is reserved)
// layer:       3=LayerI, 2=LayerII, 1=LayerIII (value 0 is reserved)
const BITRATE_TABLE = {
    3: { // MPEG 1
        3: [0, 32,  64,  96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
        2: [0, 32,  48,  56,  64,  80,  96, 112, 128, 160, 192, 224, 256, 320, 384],
        1: [0, 32,  40,  48,  56,  64,  80,  96, 112, 128, 160, 192, 224, 256, 320],
    },
    2: { // MPEG 2
        3: [0, 32,  48,  56,  64,  80,  96, 112, 128, 144, 160, 176, 192, 224, 256],
        2: [0,  8,  16,  24,  32,  40,  48,  56,  64,  80,  96, 112, 128, 144, 160],
        1: [0,  8,  16,  24,  32,  40,  48,  56,  64,  80,  96, 112, 128, 144, 160],
    },
    0: { // MPEG 2.5
        3: [0, 32,  48,  56,  64,  80,  96, 112, 128, 144, 160, 176, 192, 224, 256],
        2: [0,  8,  16,  24,  32,  40,  48,  56,  64,  80,  96, 112, 128, 144, 160],
        1: [0,  8,  16,  24,  32,  40,  48,  56,  64,  80,  96, 112, 128, 144, 160],
    },
};

const SAMPLE_RATE_TABLE = {
    3: [44100, 48000, 32000], // MPEG 1
    2: [22050, 24000, 16000], // MPEG 2
    0: [11025, 12000,  8000], // MPEG 2.5
};

// Samples contained per frame [mpegVersion][layer]
const SAMPLES_PER_FRAME = {
    3: { 3: 384, 2: 1152, 1: 1152 }, // MPEG 1
    2: { 3: 384, 2: 1152, 1:  576 }, // MPEG 2
    0: { 3: 384, 2: 1152, 1:  576 }, // MPEG 2.5
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse a 4-byte MP3 frame header at buf[offset].
 * Returns { frameSize, sampleRate, samplesPerFrame } or null if invalid.
 */
function parseFrameHeader(buf, offset) {
    if (offset + 4 > buf.length) return null;

    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const b2 = buf[offset + 2];

    // Sync word: 0xFF followed by 0xE0 mask on next byte
    if (b0 !== 0xFF || (b1 & 0xE0) !== 0xE0) return null;

    const mpegVersion   = (b1 >> 3) & 0x3;
    const layer         = (b1 >> 1) & 0x3;
    const bitrateIdx    = (b2 >> 4) & 0xF;
    const sampleRateIdx = (b2 >> 2) & 0x3;
    const padding       = (b2 >> 1) & 0x1;

    if (mpegVersion === 1)                    return null; // reserved
    if (layer === 0)                          return null; // reserved
    if (bitrateIdx === 0 || bitrateIdx === 15) return null; // free-format / bad
    if (sampleRateIdx === 3)                  return null; // reserved

    const bitrateRow = BITRATE_TABLE[mpegVersion];
    if (!bitrateRow?.[layer]) return null;

    const bitrate         = bitrateRow[layer][bitrateIdx] * 1000; // bps
    const sampleRate      = SAMPLE_RATE_TABLE[mpegVersion][sampleRateIdx];
    const samplesPerFrame = SAMPLES_PER_FRAME[mpegVersion][layer];

    // Frame byte length
    let frameSize;
    if (layer === 3) { // Layer I uses a different formula
        frameSize = (Math.floor(12 * bitrate / sampleRate) + padding) * 4;
    } else {           // Layer II / III
        frameSize = Math.floor(144 * bitrate / sampleRate) + padding;
    }

    if (frameSize < 4) return null;

    return { frameSize, sampleRate, samplesPerFrame };
}

/**
 * If an ID3v2 tag starts at offset, return the byte position after the tag.
 * Otherwise return offset unchanged. Handles multiple chained ID3v2 tags.
 */
function skipId3v2(buf, offset) {
    while (
        offset + 10 <= buf.length &&
        buf[offset]     === 0x49 && // 'I'
        buf[offset + 1] === 0x44 && // 'D'
        buf[offset + 2] === 0x33    // '3'
    ) {
        // Tag size is 4 synchsafe bytes (MSB of each byte is always 0)
        const tagSize =
            ((buf[offset + 6] & 0x7F) << 21) |
            ((buf[offset + 7] & 0x7F) << 14) |
            ((buf[offset + 8] & 0x7F) <<  7) |
             (buf[offset + 9] & 0x7F);
        const hasFooter = (buf[offset + 5] & 0x10) !== 0;
        offset += 10 + tagSize + (hasFooter ? 10 : 0);
    }
    return offset;
}

/**
 * Scan forward from startOffset to find the first byte offset that begins a
 * valid MP3 frame, verified by checking the following frame also has a sync.
 * Returns { offset, frameSize, sampleRate, samplesPerFrame } or null.
 */
function findFirstFrame(buf, startOffset) {
    let i = startOffset;
    while (i < buf.length - 4) {
        if (buf[i] === 0xFF && (buf[i + 1] & 0xE0) === 0xE0) {
            const frame = parseFrameHeader(buf, i);
            if (frame) {
                const next = i + frame.frameSize;
                // Accept if we're at EOF or the next position also has a sync
                if (next >= buf.length - 1 || (buf[next] === 0xFF && (buf[next + 1] & 0xE0) === 0xE0)) {
                    return { offset: i, ...frame };
                }
            }
        }
        i++;
    }
    return null;
}

/**
 * Return a sanitized copy of the ID3v2 tag found at buf[0..end), with frames
 * that are meaningless or misleading for a split segment stripped out.
 * Strips: TLEN (track length ms), TRCK (track number/total).
 * Returns a Uint8Array, or null on any parse error (callers should omit the tag).
 *
 * Handles ID3v2.2 (3-byte frame IDs), ID3v2.3, and ID3v2.4.
 */
function buildSanitizedId3(buf, end) {
    if (end < 10) return null;
    if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null;

    const version = buf[3]; // 2 = ID3v2.2,  3 = ID3v2.3,  4 = ID3v2.4
    const flags   = buf[5];

    const tagBodySize =
        ((buf[6] & 0x7F) << 21) |
        ((buf[7] & 0x7F) << 14) |
        ((buf[8] & 0x7F) <<  7) |
         (buf[9] & 0x7F);
    const tagEnd = Math.min(10 + tagBodySize, end);

    const STRIP_V22 = new Set(['TLE', 'TRK']);
    const STRIP_V23 = new Set(['TLEN', 'TRCK']);

    const kept = [];
    let pos = 10;

    if (version === 2) {
        // ID3v2.2: 3-char ID, 3-byte big-endian size, no frame flags
        while (pos + 6 <= tagEnd) {
            if (buf[pos] === 0x00) break; // padding
            const id   = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2]);
            const size = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
            if (size <= 0 || pos + 6 + size > tagEnd) break;
            if (!STRIP_V22.has(id)) kept.push(buf.subarray(pos, pos + 6 + size));
            pos += 6 + size;
        }
    } else if (version === 3 || version === 4) {
        // Skip extended header if present (we won't copy it to the output)
        if (flags & 0x40) {
            if (pos + 4 > tagEnd) return null;
            let skip;
            if (version === 4) {
                // v2.4: synchsafe size, includes the 4 size bytes themselves
                skip =
                    ((buf[pos]     & 0x7F) << 21) |
                    ((buf[pos + 1] & 0x7F) << 14) |
                    ((buf[pos + 2] & 0x7F) <<  7) |
                     (buf[pos + 3] & 0x7F);
            } else {
                // v2.3: regular big-endian size, does NOT include the 4 size bytes
                skip = (((buf[pos] << 24) | (buf[pos + 1] << 16) |
                          (buf[pos + 2] << 8) | buf[pos + 3]) >>> 0) + 4;
            }
            pos += skip;
        }
        // ID3v2.3/v2.4: 4-char ID, 4-byte size, 2-byte flags
        while (pos + 10 <= tagEnd) {
            if (buf[pos] === 0x00) break; // padding
            const id = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
            let size;
            if (version === 4) {
                size =
                    ((buf[pos + 4] & 0x7F) << 21) |
                    ((buf[pos + 5] & 0x7F) << 14) |
                    ((buf[pos + 6] & 0x7F) <<  7) |
                     (buf[pos + 7] & 0x7F);
            } else {
                size = (((buf[pos + 4] << 24) | (buf[pos + 5] << 16) |
                          (buf[pos + 6] << 8)  |  buf[pos + 7]) >>> 0);
            }
            if (pos + 10 + size > tagEnd) break;
            if (!STRIP_V23.has(id)) kept.push(buf.subarray(pos, pos + 10 + size));
            pos += 10 + size;
        }
    } else {
        return null; // unknown ID3v2 major version
    }

    // Rebuild tag: new 10-byte header + kept frames (no extended header, no padding)
    const newBodySize = kept.reduce((n, f) => n + f.length, 0);
    const out = new Uint8Array(10 + newBodySize);
    out[0] = 0x49; out[1] = 0x44; out[2] = 0x33; // "ID3"
    out[3] = buf[3]; // major version
    out[4] = buf[4]; // revision
    out[5] = flags & ~0x40; // clear the extended-header flag
    out[6] = (newBodySize >> 21) & 0x7F; // synchsafe size
    out[7] = (newBodySize >> 14) & 0x7F;
    out[8] = (newBodySize >>  7) & 0x7F;
    out[9] =  newBodySize        & 0x7F;
    let off = 10;
    for (const frame of kept) { out.set(frame, off); off += frame.length; }
    return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Split an MP3 File/Blob into segments of approximately `segmentSeconds` each.
 *
 * Pure JavaScript — no FFmpeg or WASM involved.
 * Uses frame-boundary detection so cuts are always on valid frame edges.
 * Output segments are created with Blob.slice() (zero-copy lazy views into the
 * original file buffer), so memory usage stays minimal.
 *
 * @param {File|Blob} file
 * @param {number} segmentSeconds  Target segment duration in seconds
 * @returns {Promise<Array<{name: string, data: Blob}>>}
 */
export async function splitMp3(file, segmentSeconds) {
    const buf = new Uint8Array(await file.arrayBuffer());

    // Skip any ID3v2 header(s) at the very start of the file
    const dataStart = skipId3v2(buf, 0);

    // Locate first valid MP3 frame (double-sync verified)
    const firstFrame = findFirstFrame(buf, dataStart);
    if (!firstFrame) throw new Error('No valid MP3 frames found in file.');

    const { sampleRate, samplesPerFrame } = firstFrame;
    const frameDurationSec  = samplesPerFrame / sampleRate;
    const framesPerSegment  = Math.max(1, Math.round(segmentSeconds / frameDurationSec));

    // Walk every frame and record split byte offsets
    const splitPoints = [firstFrame.offset];
    let pos        = firstFrame.offset;
    let frameCount = 0;

    while (pos < buf.length - 4) {
        const frame = parseFrameHeader(buf, pos);
        if (!frame) { pos++; continue; } // re-sync on corrupt byte

        pos += frame.frameSize;
        frameCount++;

        if (frameCount >= framesPerSegment) {
            splitPoints.push(pos);
            frameCount = 0;
        }
    }

    // Ensure the last split point covers all remaining bytes (incl. ID3v1 tag)
    if (splitPoints[splitPoints.length - 1] < buf.length) {
        splitPoints.push(buf.length);
    }

    // Build a sanitized ID3v2 tag for segments: preserves most metadata but
    // strips TLEN (track-length ms) and TRCK (track number) which are wrong
    // for individual segments and cause seek-bar / duration mis-display.
    const sanitizedId3 = firstFrame.offset > 0
        ? buildSanitizedId3(buf, firstFrame.offset)
        : null;

    const results = [];
    for (let i = 0; i + 1 < splitPoints.length; i++) {
        const start = splitPoints[i];
        const end   = splitPoints[i + 1];
        if (end <= start) continue;
        const audioBlob = file.slice(start, end, 'audio/mpeg');
        results.push({
            name: `segment_${String(i).padStart(3, '0')}.mp3`,
            data: sanitizedId3
                ? new Blob([sanitizedId3, audioBlob], { type: 'audio/mpeg' })
                : audioBlob,
        });
    }

    return results;
}

/**
 * Join multiple MP3 Files by Blob concatenation — no FFmpeg or WASM needed.
 *
 * MP3 is a self-synchronizing bitstream; players re-sync at frame boundaries
 * so plain concatenation produces a fully valid and playable MP3 file.
 *
 * @param {File[]} files
 * @returns {{ name: string, data: Blob }}
 */
export async function joinMp3Blobs(files) {
    const chunks = [];
    for (const file of files) {
        const buf = new Uint8Array(await file.arrayBuffer());
        // Strip leading ID3v2 tag(s)
        let start = skipId3v2(buf, 0);
        // Strip trailing ID3v1 tag (last 128 bytes starting with "TAG")
        let end = buf.length;
        if (end - start >= 128 &&
            buf[end - 128] === 0x54 && // 'T'
            buf[end - 127] === 0x41 && // 'A'
            buf[end - 126] === 0x47    // 'G'
        ) {
            end -= 128;
        }
        if (end > start) {
            chunks.push(buf.subarray(start, end));
        }
    }
    return {
        name: 'joined_audio.mp3',
        data: new Blob(chunks, { type: 'audio/mpeg' }),
    };
}
