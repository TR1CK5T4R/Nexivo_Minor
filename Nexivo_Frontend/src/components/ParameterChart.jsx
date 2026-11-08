import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// One small line chart per parameter (spec M5: parameter-wise graphs).
export const ParameterChart = ({ rows, dataKey, label, max, hint }) => (
    <figure className="p-4 bg-white border border-slate-200 rounded-xl">
        <figcaption className="text-sm font-semibold text-slate-800">
            {label} <span className="font-normal text-slate-500">({hint})</span>
        </figcaption>
        <div className="h-36 mt-2" role="img" aria-label={`${label} by day after surgery`}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, max]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey={dataKey} name={label} stroke="#2563eb" strokeWidth={2} dot connectNulls />
                </LineChart>
            </ResponsiveContainer>
        </div>
    </figure>
);
