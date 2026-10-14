'use strict';
// Thin user32 bindings - the parts of Wispr Flow's native "Wispr Flow Helper.exe"
// we need, called in-process through koffi (FFI) instead of a C# sidecar:
//   * SendInput            - Ctrl+V paste and the Start-menu masking key tap
//   * GetAsyncKeyState     - physical key state, used to evict stale keys
//                            (Wispr's CheckStaleKeys helper request)

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
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

const INPUT_KEYBOARD = 1;
const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const PAULI_MARKER = 0x5041554c; // 'PAUL' in dwExtraInfo, identifies our own injected input

const VK_CONTROL = 0x11;
const VK_V = 0x56;
// Unassigned virtual key. Tapping it while Win is held stops the Start menu
// from opening when Win is released - the same trick as Wispr's
// "SendMaskingSequence" / "windows-shortcut-masking" (and AutoHotkey's vkE8).
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

/** Executable of the focused window, e.g. { exe: 'Code.exe', pid: 1234 } - Wispr's GetActiveAppInfo. */
function foregroundApp() {
  try {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;
    const pidOut = [0];
    GetWindowThreadProcessId(hwnd, pidOut);
    const pid = pidOut[0];
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
  sendKeys, isKeyDown, sendPaste, sendCopy, sendMaskKey, releaseModifiers, foregroundApp, PAULI_MARKER,
};
