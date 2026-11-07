import { Info } from 'lucide-react';

// Shown on every Nexivo recovery screen (spec Section 3: decision support, not diagnosis).
export const DecisionSupportNotice = ({ className = '' }) => (
    <div role="note" className={`flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-900 ${className}`}>
        <Info className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p>Nexivo provides decision support and does not replace clinical judgement.</p>
    </div>
);
