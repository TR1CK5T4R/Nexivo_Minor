// Nexivo recovery categories (spec M5): a colour and always the text label, never colour alone.
export const CATEGORIES = {
    normal: { label: 'Normal', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    slower: { label: 'Slower than expected', className: 'bg-amber-100 text-amber-900 border-amber-300' },
    attention: { label: 'Requires attention', className: 'bg-rose-100 text-rose-800 border-rose-300' },
};

// Alert severities (spec M3), with the same rule: text label always shown.
export const ALERT_SEVERITIES = {
    high: { label: 'High', className: 'bg-rose-50 border-rose-200 text-rose-900' },
    medium: { label: 'Medium', className: 'bg-amber-50 border-amber-200 text-amber-900' },
    low: { label: 'Low', className: 'bg-slate-50 border-slate-200 text-slate-700' },
};
