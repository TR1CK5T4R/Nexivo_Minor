import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Mail, LogIn, Heart, AlertCircle, Lock } from 'lucide-react';
import { Card, Button, FormInput } from '../components';
import { useAuth } from '../context/AuthContext';

export default function DoctorLogin() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const { doctor, loading, loginDoctor, loginGuest } = useAuth();
    const destination = location.state?.from ?? '/doctor';

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            await loginDoctor(email, password);
            navigate(destination, { replace: true });
        } catch (err) {
            setError(err.message || 'Login failed. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const continueAsGuest = async () => {
        setSubmitting(true);
        setError('');
        try {
            await loginGuest('doctor');
            navigate(destination, { replace: true });
        } catch (err) {
            setError(err.message || 'Guest access failed. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!loading && !submitting && doctor) return <Navigate to={destination} replace />;

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
            <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <a href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
                        <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
                            <Heart className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">Nexivo</h1>
                            <p className="text-xs text-gray-600">Doctor Portal</p>
                        </div>
                    </a>
                </div>
            </div>

            <div className="flex items-center justify-center px-6 py-12">
                <Card className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                            <LogIn className="w-8 h-8 text-white" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Doctor Login</h2>
                        <p className="text-gray-600">Enter your credentials to access your patients</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <FormInput
                            label="Email Address"
                            type="email"
                            name="email"
                            placeholder="your.email@example.com"
                            icon={Mail}
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                setError('');
                            }}
                            required
                        />

                        <FormInput
                            label="Password"
                            type="password"
                            name="password"
                            placeholder="Enter your password"
                            icon={Lock}
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                setError('');
                            }}
                            required
                        />

                        {error && (
                            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
                                <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                                <p className="text-sm text-rose-700">{error}</p>
                            </div>
                        )}

                        <Button
                            type="submit"
                            variant="primary"
                            size="lg"
                            className="w-full"
                            icon={LogIn}
                            iconPosition="left"
                            disabled={submitting}
                        >
                            {submitting ? 'Logging in...' : 'Log in'}
                        </Button>
                    </form>

                    <div className="mt-6 pt-6 border-t border-gray-200 text-center">
                        <p className="text-sm text-gray-600 mb-3">Just looking around? Try the doctor side with made-up patients.</p>
                        <Button type="button" variant="outline" className="w-full" onClick={continueAsGuest} disabled={submitting}>
                            Continue as guest doctor
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    );
}
