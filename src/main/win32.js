'use strict';
// Thin user32 / kernel32 / advapi32 bindings, called in-process through koffi (FFI):
//   * SendInput            - Ctrl+V paste and the Start-menu masking key tap
//   * GetAsyncKeyState     - physical key state, used to evict stale keys
//   * process tokens       - integrity level, to spot windows run as administrator

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  u: koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT }),
});

const SendInput = user32.func('__stdcall', 'SendInput', 'uint32', ['uint32', koffi.pointer(INPUT), 'int32']);
const GetAsyncKeyState = user32.func('__stdcall', 'GetAsyncKeyState', 'int16', ['int32']);
const GetForegroundWindow = user32.func('__stdcall', 'GetForegroundWindow', 'void *', []);
const GetWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['void *', koffi.out(koffi.pointer('uint32'))]);

const kernel32 = koffi.load('kernel32.dll');
const OpenProcess = kernel32.func('__stdcall', 'OpenProcess', 'void *', ['uint32', 'bool', 'uint32']);
const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'bool', ['void *']);
const QueryFullProcessImageNameW = kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'bool',
  ['void *', 'uint32', koffi.out(koffi.pointer('char16_t')), koffi.inout(koffi.pointer('uint32'))]);
const GetLastError = kernel32.func('__stdcall', 'GetLastError', 'uint32', []);
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

// Integrity level of a process (medium for normal apps, high for "Run as
// administrator"): Windows drops our synthetic Ctrl+V into a higher one.
const advapi32 = koffi.load('advapi32.dll');
const OpenProcessToken = advapi32.func('__stdcall', 'OpenProcessToken', 'bool', ['void *', 'uint32', koffi.out(koffi.pointer('void *'))]);
const GetTokenInformation = advapi32.func('__stdcall', 'GetTokenInformation', 'bool',
  ['void *', 'int', 'void *', 'uint32', koffi.out(koffi.pointer('uint32'))]);
const GetSidSubAuthorityCount = advapi32.func('__stdcall', 'GetSidSubAuthorityCount', 'void *', ['void *']);
const GetSidSubAuthority = advapi32.func('__stdcall', 'GetSidSubAuthority', 'void *', ['void *', 'uint32']);
const TOKEN_QUERY = 0x0008;
const TokenIntegrityLevel = 25;
const LABEL_BUFFER_BYTES = 128; // TOKEN_MANDATORY_LABEL (16) + its one-sub-authority SID (12) on x64, with room to spare

const INPUT_KEYBOARD = 1;
const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const PAULI_MARKER = 0x5041554c; // 'PAUL' in dwExtraInfo, identifies our own injected input

const VK_CONTROL = 0x11;
const VK_V = 0x56;
// Unassigned virtual key. Tapping it while Win is held stops the Start menu
// from opening when Win is released - the same trick as AutoHotkey's vkE8 masking.
const VK_MASK = 0xe8;

const EXTENDED = new Set([0x5b, 0x5c, 0xa3, 0xa5, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e]);

function keyInput(vk, up) {
  let flags = up ? KEYEVENTF_KEYUP : 0;
  if (EXTENDED.has(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
  return { type: INPUT_KEYBOARD, u: { ki: { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: PAULI_MARKER } } };
}

/** @param {{vk: number, up?: boolean}[]} steps sent atomically */
function sendKeys(steps) {
  const inputs = steps.map((s) => keyInput(s.vk, !!s.up));
  return SendInput(inputs.length, inputs, koffi.sizeof(INPUT)) === inputs.length;
}

function isKeyDown(vk) {
  return (GetAsyncKeyState(vk) & 0x8000) !== 0;
}

function sendPaste() {
  return sendKeys([
    { vk: VK_CONTROL }, { vk: VK_V }, { vk: VK_V, up: true }, { vk: VK_CONTROL, up: true },
  ]);
}

function sendCopy() {
  return sendKeys([
    { vk: VK_CONTROL }, { vk: 0x43 }, { vk: 0x43, up: true }, { vk: VK_CONTROL, up: true },
  ]);
}

/** Process id of the focused window, null if there is none */
function foregroundPid() {
  try {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;
    const pidOut = [0];
    GetWindowThreadProcessId(hwnd, pidOut);
    return pidOut[0] || null;
  } catch {
    return null;
  }
}

/** Executable of the focused window, e.g. { exe: 'Code.exe', pid: 1234 } */
function foregroundApp() {
  try {
    const pid = foregroundPid();
    if (!pid) return null;
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!handle) return null;
    try {
      const buf = Buffer.alloc(1024);
      const size = [512];
      if (!QueryFullProcessImageNameW(handle, 0, buf, size)) return null;
      const full = buf.toString('utf16le', 0, size[0] * 2);
      return { exe: full.split('\\').pop(), pid };
    } finally {
      CloseHandle(handle);
    }
  } catch {
    return null;
  }
}

/**
 * Mandatory integrity level of a process: 0x2000 medium, 0x3000 high (elevated), 0x4000 system.
 * @param {number} [pid] default: our own process
 * @returns {{level: number|null, failure: string|null}} level null when it can't be read; failure says which call failed
 */
function integrityLevelInfo(pid = process.pid) {
  let handle = null;
  let token = null;
  let label = null;
  const fail = (call) => ({ level: null, failure: `${call} failed (error ${GetLastError()})` });
  try {
    handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!handle) return fail('OpenProcess');
    const tokenOut = [null];
    if (!OpenProcessToken(handle, TOKEN_QUERY, tokenOut) || !tokenOut[0]) return fail('OpenProcessToken');
    token = tokenOut[0];
    label = koffi.alloc('uint8', LABEL_BUFFER_BYTES);
    const needed = [0];
    if (!GetTokenInformation(token, TokenIntegrityLevel, label, LABEL_BUFFER_BYTES, needed)) return fail('GetTokenInformation');
    const sid = koffi.decode(label, 'void *'); // TOKEN_MANDATORY_LABEL.Label.Sid
    if (!sid) return { level: null, failure: 'no integrity label' };
    const count = koffi.decode(GetSidSubAuthorityCount(sid), 'uint8');
    if (!count) return { level: null, failure: 'integrity label without sub-authority' };
    return { level: koffi.decode(GetSidSubAuthority(sid, count - 1), 'uint32'), failure: null };
  } catch (err) {
    return { level: null, failure: err.message };
  } finally {
    if (label) koffi.free(label);
    if (token) CloseHandle(token);
    if (handle) CloseHandle(handle);
  }
}

/** @param {number} [pid] default: our own process @returns {number|null} */
function integrityLevel(pid) {
  return integrityLevelInfo(pid).level;
}

function sendMaskKey() {
  return sendKeys([{ vk: VK_MASK }, { vk: VK_MASK, up: true }]);
}

/** Synthesise key-ups for modifiers that are still down (mask first so Win can't open Start). */
function releaseModifiers(vks) {
  const held = vks.filter(isKeyDown);
  if (held.length === 0) return;
  const steps = [{ vk: VK_MASK }, { vk: VK_MASK, up: true }, ...held.map((vk) => ({ vk, up: true }))];
  sendKeys(steps);
}

module.exports = {
  sendKeys, isKeyDown, sendPaste, sendCopy, sendMaskKey, releaseModifiers, foregroundApp, foregroundPid,
  integrityLevel, integrityLevelInfo, PAULI_MARKER,
};
