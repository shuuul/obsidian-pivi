/**
 * Pure IPv4/IPv6 destination classification for SSRF egress policy.
 * Accepts dotted, integer, hex, octal, mixed, and IPv4-mapped IPv6 forms.
 */

export type IpDestinationClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'multicast'
  | 'unspecified'
  | 'cloud-metadata'
  | 'invalid';

const CLOUD_METADATA_V4 = new Set([
  // AWS / common IMDS
  '169.254.169.254',
  // GCP metadata alias
  '169.254.169.254',
  // Alibaba / some clouds
  '100.100.100.200',
]);

const DENIED_CLASSES: ReadonlySet<IpDestinationClass> = new Set([
  'loopback',
  'private',
  'link-local',
  'multicast',
  'unspecified',
  'cloud-metadata',
  'invalid',
]);

export function isDeniedIpClass(classification: IpDestinationClass): boolean {
  return DENIED_CLASSES.has(classification);
}

function parseOctalOrDecimalToken(token: string): number | null {
  if (!/^[0-9]+$/.test(token)) {
    return null;
  }
  // Leading zero means octal in legacy IP parsers when all digits are 0-7.
  if (token.length > 1 && token.startsWith('0') && /^[0-7]+$/.test(token)) {
    const value = Number.parseInt(token, 8);
    return Number.isFinite(value) ? value : null;
  }
  const value = Number.parseInt(token, 10);
  return Number.isFinite(value) ? value : null;
}

function parseHexToken(token: string): number | null {
  if (!/^0x[0-9a-f]+$/i.test(token)) {
    return null;
  }
  const value = Number.parseInt(token.slice(2), 16);
  return Number.isFinite(value) ? value : null;
}

function parseIpv4Part(token: string): number | null {
  const hex = parseHexToken(token);
  if (hex !== null) {
    return hex;
  }
  return parseOctalOrDecimalToken(token);
}

/** Expand short / mixed IPv4 notations into four octets when possible. */
export function expandIpv4Literal(raw: string): [number, number, number, number] | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  // Single integer / hex form (e.g. 2130706433 or 0x7f000001).
  if (!trimmed.includes('.')) {
    let value: number | null = null;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      value = Number.parseInt(trimmed.slice(2), 16);
    } else if (/^[0-9]+$/.test(trimmed)) {
      value = trimmed.startsWith('0') && /^[0-7]+$/.test(trimmed)
        ? Number.parseInt(trimmed, 8)
        : Number.parseInt(trimmed, 10);
    }
    if (value === null || !Number.isFinite(value) || value < 0 || value > 0xffffffff) {
      return null;
    }
    return [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
  }

  const parts = trimmed.split('.');
  if (parts.length < 1 || parts.length > 4) {
    return null;
  }
  const parsed = parts.map(parseIpv4Part);
  if (parsed.some((part) => part === null)) {
    return null;
  }
  const nums = parsed as number[];

  if (parts.length === 4) {
    const a = nums[0]!;
    const b = nums[1]!;
    const c = nums[2]!;
    const d = nums[3]!;
    if ([a, b, c, d].some((n) => n < 0 || n > 255)) {
      return null;
    }
    return [a, b, c, d];
  }
  if (parts.length === 3) {
    // a.b.c where c can be 16-bit
    const a = nums[0]!;
    const b = nums[1]!;
    const c = nums[2]!;
    if (a > 255 || b > 255 || c > 0xffff) {
      return null;
    }
    return [a, b, (c >>> 8) & 0xff, c & 0xff];
  }
  if (parts.length === 2) {
    // a.b where b can be 24-bit
    const a = nums[0]!;
    const b = nums[1]!;
    if (a > 255 || b > 0xffffff) {
      return null;
    }
    return [
      a,
      (b >>> 16) & 0xff,
      (b >>> 8) & 0xff,
      b & 0xff,
    ];
  }
  return null;
}

function classifyIpv4Octets(octets: [number, number, number, number]): IpDestinationClass {
  const [a, b, c, d] = octets;
  const dotted = `${a}.${b}.${c}.${d}`;

  if (a === 0) {
    return 'unspecified';
  }
  if (a === 127) {
    return 'loopback';
  }
  if (a === 10) {
    return 'private';
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return 'private';
  }
  if (a === 192 && b === 168) {
    return 'private';
  }
  if (a === 169 && b === 254) {
    if (c === 169 && d === 254) {
      return 'cloud-metadata';
    }
    return 'link-local';
  }
  if (a === 100 && b === 100 && c === 100 && d === 200) {
    return 'cloud-metadata';
  }
  if (CLOUD_METADATA_V4.has(dotted)) {
    return 'cloud-metadata';
  }
  // Carrier-grade NAT / shared address space
  if (a === 100 && b >= 64 && b <= 127) {
    return 'private';
  }
  if (a >= 224 && a <= 239) {
    return 'multicast';
  }
  if (a >= 240) {
    // Reserved / broadcast-ish; treat as denied invalid/public-unsafe.
    return 'invalid';
  }
  return 'public';
}

function stripIpv6Zone(raw: string): string {
  const percent = raw.indexOf('%');
  return percent >= 0 ? raw.slice(0, percent) : raw;
}

function expandIpv6(raw: string): number[] | null {
  const input = stripIpv6Zone(raw.trim().toLowerCase());
  if (!input || input.includes(':::')) {
    return null;
  }

  // IPv4-mapped / dotted tail
  let v4Tail: [number, number, number, number] | null = null;
  let head = input;
  const lastColon = input.lastIndexOf(':');
  if (input.includes('.') && lastColon >= 0) {
    v4Tail = expandIpv4Literal(input.slice(lastColon + 1));
    if (!v4Tail) {
      return null;
    }
    head = input.slice(0, lastColon);
  }

  const halves = head.split('::');
  if (halves.length > 2) {
    return null;
  }

  const parseGroup = (group: string): number | null => {
    if (!group) {
      return null;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      return null;
    }
    return Number.parseInt(group, 16);
  };

  const left = halves[0] ? halves[0].split(':').filter((part) => part.length > 0) : [];
  const right = halves.length === 2 && halves[1]
    ? halves[1].split(':').filter((part) => part.length > 0)
    : [];

  const leftVals: number[] = [];
  for (const part of left) {
    const value = parseGroup(part);
    if (value === null) {
      return null;
    }
    leftVals.push(value);
  }
  const rightVals: number[] = [];
  for (const part of right) {
    const value = parseGroup(part);
    if (value === null) {
      return null;
    }
    rightVals.push(value);
  }

  const totalGroups = 8 - (v4Tail ? 2 : 0);
  const used = leftVals.length + rightVals.length;
  if (halves.length === 1) {
    if (used !== totalGroups) {
      return null;
    }
  } else if (used > totalGroups) {
    return null;
  }

  const zeros = totalGroups - used;
  const groups = [
    ...leftVals,
    ...Array.from({ length: Math.max(zeros, 0) }, () => 0),
    ...rightVals,
  ];
  if (groups.length !== totalGroups) {
    return null;
  }

  const bytes: number[] = [];
  for (const group of groups) {
    bytes.push((group >>> 8) & 0xff, group & 0xff);
  }
  if (v4Tail) {
    bytes.push(...v4Tail);
  }
  return bytes.length === 16 ? bytes : null;
}

function classifyIpv6Bytes(bytes: number[]): IpDestinationClass {
  const isZero = bytes.every((b) => b === 0);
  if (isZero) {
    return 'unspecified';
  }

  // ::1
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) {
    return 'loopback';
  }

  // IPv4-mapped ::ffff:x.x.x.x
  const isV4Mapped = bytes.slice(0, 10).every((b) => b === 0)
    && bytes[10] === 0xff
    && bytes[11] === 0xff;
  if (isV4Mapped) {
    return classifyIpv4Octets([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!]);
  }

  // IPv4-compatible obsolete ::x.x.x.x (not ::1)
  const isV4Compatible = bytes.slice(0, 12).every((b) => b === 0);
  if (isV4Compatible) {
    return classifyIpv4Octets([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!]);
  }

  // Link-local fe80::/10
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) {
    return 'link-local';
  }

  // Unique local fc00::/7
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) {
    return 'private';
  }

  // Multicast ff00::/8
  if (bytes[0] === 0xff) {
    return 'multicast';
  }

  // Site-local deprecated fec0::/10 — treat as private
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0xc0) {
    return 'private';
  }

  return 'public';
}

/** Classify a hostname or literal IP for egress denial decisions. */
export function classifyIpLiteral(rawHost: string): IpDestinationClass {
  const host = rawHost.trim().toLowerCase();
  if (!host) {
    return 'invalid';
  }

  // Bracketed IPv6 from URL.host without brackets already; accept both.
  const unbracketed = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;

  if (unbracketed.includes(':')) {
    const bytes = expandIpv6(unbracketed);
    if (!bytes) {
      return 'invalid';
    }
    return classifyIpv6Bytes(bytes);
  }

  // Pure numeric / dotted IPv4 forms (including alternate representations).
  if (/^[0-9.]+$/.test(unbracketed) || /^0x[0-9a-f]+$/i.test(unbracketed)) {
    const octets = expandIpv4Literal(unbracketed);
    if (!octets) {
      return 'invalid';
    }
    return classifyIpv4Octets(octets);
  }

  // Non-IP hostnames are not classified here.
  return 'public';
}

export function isLiteralIpHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  const unbracketed = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
  if (unbracketed.includes(':')) {
    return expandIpv6(unbracketed) !== null;
  }
  if (/^[0-9.]+$/.test(unbracketed) || /^0x[0-9a-f]+$/i.test(unbracketed)) {
    return expandIpv4Literal(unbracketed) !== null;
  }
  return false;
}

/** Normalize a resolved address string into a comparable canonical form. */
export function canonicalizeIpAddress(address: string): string | null {
  const trimmed = address.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes(':')) {
    const bytes = expandIpv6(trimmed);
    if (!bytes) {
      return null;
    }
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
    }
    return groups.join(':');
  }
  const octets = expandIpv4Literal(trimmed);
  if (!octets) {
    return null;
  }
  return octets.join('.');
}
