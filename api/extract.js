import * as cheerio from 'cheerio';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import net from 'node:net';

dns.setDefaultResultOrder('ipv4first');

const PRIVATE_CIDR_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

function isPrivateIp(ip) {
  return PRIVATE_CIDR_PATTERNS.some((pattern) => pattern.test(ip));
}

async function assertSafePublicHostname(hostname) {
  if (!hostname) throw new Error('Missing hostname');

  const results = await dnsPromises.lookup(hostname, { all: true });
  if (!results.length) throw new Error('Hostname did not resolve');

  for (const entry of results) {
    const ip = entry.address;
    if (!net.isIP(ip)) throw new Error('Resolved address is not a valid IP');
    if (isPrivateIp(ip)) {
      throw new Error('Private or loopback IPs are not allowed');
    }
  }
}

function normalizeText(value) {
  return value?.replace(/\s+/g, ' ').trim() || null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return null;
}

function toAbsoluteUrl(baseUrl, maybeRelative) {
  const normalized = normalizeText(maybeRelative);
  if (!normalized) return null;
  try {
    return new URL(normalized, baseUrl).toString();
  } catch {
    return normalized;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ ok: false, error: 'Query parameter "url" is required' });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ ok: false, error: 'Only http/https URLs are allowed' });
  }

  try {
    await assertSafePublicHostname(parsed.hostname);

    const response = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 ZoroyaHTMLInspector/1.1',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url || parsed.toString();
    const notes = [];

    if (!response.ok) {
      notes.push(`Upstream responded with HTTP ${response.status}`);
    }

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      notes.push('Response content-type is not HTML; extraction may be incomplete.');
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = firstNonEmpty($('head > title').first().text());
    const metaDescription = firstNonEmpty(
      $('meta[name="description"]').attr('content'),
      $('meta[property="description"]').attr('content')
    );
    const canonical = toAbsoluteUrl(finalUrl, $('link[rel="canonical"]').attr('href'));
    const ogTitle = firstNonEmpty($('meta[property="og:title"]').attr('content'));
    const ogDescription = firstNonEmpty($('meta[property="og:description"]').attr('content'));
    const lang = firstNonEmpty($('html').attr('lang'));

    const h1 = $('h1')
      .map((_, el) => normalizeText($(el).text()))
      .get()
      .filter(Boolean);

    const h2 = $('h2')
      .map((_, el) => normalizeText($(el).text()))
      .get()
      .filter(Boolean);

    if (!title) notes.push('title tag not found');
    if (!metaDescription) notes.push('meta description not found');
    if (!canonical) notes.push('canonical not found');
    if (!h1.length) notes.push('No H1 found');
    if (!h2.length) notes.push('No H2 found');

    return res.status(200).json({
      ok: true,
      input_url: parsed.toString(),
      final_url: finalUrl,
      status: response.status,
      content_type: contentType,
      title,
      meta_description: metaDescription,
      canonical,
      h1,
      h2,
      og_title: ogTitle,
      og_description: ogDescription,
      lang,
      notes,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      cause:
        error && typeof error === 'object' && 'cause' in error
          ? String(error.cause)
          : null,
    });
  }
}
