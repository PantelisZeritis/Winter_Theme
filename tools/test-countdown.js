// Checks the countdown text around the holidays:  gjs -m tools/test-countdown.js
import {countdown, msUntilMidnight} from '../winter-theme@zeroze01/lib/countdown.js';

const cases = [
    [[2026, 1, 1], 'New Year’s Day', 'Happy New Year!'],
    [[2026, 1, 2], '357 days to go', '357 days until Christmas'],
    [[2024, 2, 29], '300 days to go', '300 days until Christmas'],
    [[2026, 3, 29], '271 days to go', '271 days until Christmas'],   // DST starts in Europe
    [[2026, 11, 17], '38 days to go', '38 days until Christmas'],
    [[2026, 12, 23], '2 days to go', '2 days until Christmas'],
    [[2026, 12, 24], 'Christmas Eve', 'Christmas Eve · Christmas is tomorrow'],
    [[2026, 12, 25], 'Christmas Day', 'Merry Christmas!'],
    [[2026, 12, 26], 'Happy holidays', 'Happy holidays · 6 days until the New Year'],
    [[2026, 12, 30], 'Happy holidays', 'Happy holidays · 2 days until the New Year'],
    [[2026, 12, 31], 'New Year’s Eve', 'New Year’s Eve · Happy New Year tomorrow'],
];

let failed = 0;
for (const [[y, m, d], short, long] of cases) {
    const got = countdown(y, m, d);
    const ok = got.short === short && got.long === long;
    if (!ok)
        failed++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${y}-${m}-${d}: ${got.short} | ${got.long}${ok ? '' : `   (expected ${short} | ${long})`}`);
}

// Every day of two years must produce text that fits the tile (the widest
// text that fits, measured in the shell, is 14 characters), and never a
// negative count.
for (const year of [2025, 2028]) {
    for (let t = new Date(year, 0, 1); t.getFullYear() === year; t.setDate(t.getDate() + 1)) {
        const {short, long} = countdown(t.getFullYear(), t.getMonth() + 1, t.getDate());
        if (!short || !long || short.length > 14 || /-\d/.test(short + long)) {
            failed++;
            print(`FAIL ${t.toDateString()}: ${short} | ${long}`);
        }
    }
}

const ms = msUntilMidnight(new Date(2026, 11, 24, 23, 59, 0));
if (ms !== 65000) {
    failed++;
    print(`FAIL msUntilMidnight at 23:59:00 gave ${ms}, expected 65000`);
}

print(failed ? `${failed} failed` : 'all countdown checks passed');
if (failed)
    imports.system.exit(1);
