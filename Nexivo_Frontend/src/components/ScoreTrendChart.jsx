import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from './Card';

// Score per check-in against the expected recovery curve.
export const ScoreTrendChart = ({ rows }) => (
    <Card padding="lg" hover={false}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Score trend</h2>
        {rows.length === 0 ? (
            <p className="text-slate-600">The chart appears after the first check-in.</p>
        ) : (
            <div className="h-72" role="img" aria-label="Recovery score by day after surgery, with the expected recovery curve">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rows} margin={{ top: 5, right: 10, bottom: 20, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} label={{ value: 'Day after surgery', position: 'insideBottom', offset: -10 }} />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Legend verticalAlign="top" />
                        <Line type="monotone" dataKey="score" name="Recovery score" stroke="#059669" strokeWidth={2} dot />
                        <Line type="linear" dataKey="expected" name="Expected" stroke="#64748b" strokeDasharray="6 4" dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        )}
    </Card>
);
