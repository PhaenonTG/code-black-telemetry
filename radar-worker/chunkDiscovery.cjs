'use strict';

// S3 prefixes are neither continuous nor chronological. Compare timestamps in
// actual chunk keys, including across scan-number rollover and missing folders.
async function discoverLatestChunkVolume(site, fetchText, bucket, now = Date.now) {
  if (!/^[A-Z][A-Z0-9]{3}$/.test(site)) throw new Error('invalid radar site');
  let token = '', newest = null;
  const seen = new Set(), deadline = now() + 60_000;
  for (let page = 0; page < 128; page++) {
    if (now() > deadline) throw new Error('chunk discovery deadline exceeded');
    const url = new URL(bucket);
    url.search = new URLSearchParams({ 'list-type': '2', prefix: `${site}/`, 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) }).toString();
    const xml = await fetchText(url.toString());
    if (!xml.includes('<ListBucketResult')) throw new Error('invalid chunk listing');
    for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
      const key = match[1].match(/^([A-Z0-9]{4})\/(\d+)\/(\d{8}-\d{6})-\d+-[SIE]$/);
      if (key && key[1] === site && (!newest || key[3] > newest.time)) newest = { volume: Number(key[2]), time: key[3] };
    }
    if (/<IsTruncated>false<\/IsTruncated>/.test(xml)) {
      if (!newest) throw new Error(`no Level II chunk data found for ${site}`);
      return newest.volume;
    }
    const next = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1]
      ?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    if (!next || seen.has(next)) throw new Error('invalid chunk pagination');
    seen.add(next); token = next;
  }
  throw new Error('chunk discovery page limit exceeded');
}
module.exports = { discoverLatestChunkVolume };
