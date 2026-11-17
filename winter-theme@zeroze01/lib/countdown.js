// What the Christmas countdown says on a given local date. Pure, so
// tools/test-countdown.js can check it under plain gjs.
//
//   Jan 2 – Dec 23   "N days until Christmas"
//   Dec 24           Christmas Eve
//   Dec 25           Merry Christmas
//   Dec 26 – Dec 30  happy holidays, counting down to the New Year
//   Dec 31           New Year's Eve
//   Jan 1            Happy New Year
//
// `short` must fit under the Quick Settings tile: about 14 characters, so the
// greetings themselves only appear in `long`, in the menu header.

const DAY = 24 * 60 * 60 * 1000;

// Whole calendar days from one date to another, immune to DST changes.
function daysBetween(y1, m1, d1, y2, m2, d2) {
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

function days(n) {
    return n === 1 ? '1 day' : `${n} days`;
}

// month is 1–12.
export function countdown(year, month, day) {
    if (month === 12 && day === 24)
        return {short: 'Christmas Eve', long: 'Christmas Eve · Christmas is tomorrow'};
    if (month === 12 && day === 25)
        return {short: 'Christmas Day', long: 'Merry Christmas!'};
    if (month === 12 && day === 31)
        return {short: 'New Year’s Eve', long: 'New Year’s Eve · Happy New Year tomorrow'};
    if (month === 12 && day > 25) {
        const n = daysBetween(year, month, day, year + 1, 1, 1);
        return {short: 'Happy holidays', long: `Happy holidays · ${days(n)} until the New Year`};
    }
    if (month === 1 && day === 1)
        return {short: 'New Year’s Day', long: 'Happy New Year!'};

    const n = daysBetween(year, month, day, year, 12, 25);
    return {short: `${days(n)} to go`, long: `${days(n)} until Christmas`};
}

// Milliseconds from `now` (a Date) until just after the next local midnight.
export function msUntilMidnight(now) {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    return Math.max(1000, next - now);
}
