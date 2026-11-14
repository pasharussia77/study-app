// Private activity log kept on this phone, used only to build the test report.
const key = (pid) => 'diag:' + pid;
export function diagLog(pid, evt) {
  try {
    let arr = JSON.parse(localStorage.getItem(key(pid)) || '[]');
    arr.push({ t: Date.now(), ...evt });
    arr = arr.slice(-300);
    while (arr.length > 20 && JSON.stringify(arr).length > 450000) arr.shift();
    localStorage.setItem(key(pid), JSON.stringify(arr));
  } catch {}
}
export function diagGet(pid) { try { return JSON.parse(localStorage.getItem(key(pid)) || '[]'); } catch { return []; } }
export function diagClear(pid) { try { localStorage.removeItem(key(pid)); } catch {} }
