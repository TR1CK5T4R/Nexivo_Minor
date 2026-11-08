import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Route guard for the doctor pages. The API enforces access on its own; this only
// sends a visitor to the login page instead of showing a page that can't load.
export const RequireDoctor = ({ children }) => {
    const { doctor, loading } = useAuth();
    const location = useLocation();

    if (loading) return <p className="p-8 text-center text-slate-600" role="status">Loading...</p>;
    if (!doctor) return <Navigate to="/doctor/login" replace state={{ from: location.pathname }} />;
    return children;
};
