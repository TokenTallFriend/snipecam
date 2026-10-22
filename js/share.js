// Getting photos out: share sheet (iPhone → Slack), save, clipboard, download fallback.

// [pure] Slack tag line for everyone in a photo (rule 4). Uses the Slack handle, or the name if none.
export function tagText(members) {
  if (!members.length) return '';
  return `🎯 Sniped ${members.map((m) => m.slack || m.name).join(' ')}`;
}

const pad = (n) => String(n).padStart(2, '0');
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// [pure] snipe-2026-10-21-143005-alice-bob.jpg
export function snipeFilename(date, names = []) {
  const d = new Date(date);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const who = names.map(slug).filter(Boolean).join('-');
  return `snipe-${stamp}${who ? `-${who}` : ''}.jpg`;
}

export const toFile = (blob, name) => new File([blob], name, { type: blob.type || 'image/jpeg' });

// Copies text. Call synchronously inside a tap handler, before share() (both need the tap's "user activation").
export function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
    }
  } catch { /* fall through */ }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.style.cssText = 'position:fixed;opacity:0;';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return ok;
}

export function downloadBlob(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const canShareFiles = (files) => !!navigator.canShare?.({ files });

async function shareOrCancel(data) {
  try {
    await navigator.share(data);
    return 'shared';
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

// One photo per post (rule 5). iPhone: share sheet. Elsewhere: downloads the photo.
// Must be called from a tap handler without awaiting anything slow first.
export function shareFile(file, text) {
  if (canShareFiles([file])) return shareOrCancel({ files: [file], text });
  downloadBlob(file, file.name);
  return Promise.resolve('downloaded');
}

// Saves several photos. iPhone: share sheet with "Save N Images". Elsewhere: downloads each.
export function saveFiles(files) {
  if (canShareFiles(files)) return shareOrCancel({ files });
  files.forEach((f) => downloadBlob(f, f.name));
  return Promise.resolve('downloaded');
}
