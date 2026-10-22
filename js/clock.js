// App clock. Test hook: ?clockOffset=<ms> shifts it (to test midnight and the reminder).

const offset = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('clockOffset')) || 0 : 0;

export const now = () => Date.now() + offset;
