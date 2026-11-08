import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';

// Import page components
import ReviveCare from './pages/ReviveCare';
import MedicalDashboard from './pages/MedicalDashboard';
import DoctorDashboard from './pages/DoctorDashboard';
import PatientDashboard from './pages/PatientDashboard';
import PatientDashboardsimple from './pages/PatientDashboardsimple';
import PatientLogin from './pages/PatientLogin';
import DoctorLogin from './pages/DoctorLogin';
import { RequireDoctor } from './components/RequireDoctor';
import AddPatientForm from './pages/AddPatientForm';
import AddPatientFormStandalone from './pages/AddPatientFormStandalone';
import ChatInterface from './pages/ChatInterface';
import ExerciseSelection from './pages/ExerciseSelection';
import ExerciseWorkout from './pages/ExerciseWorkout';
import CheckInForm from './pages/CheckInForm';
import MovementTest from './pages/MovementTest';
import PatientRecovery from './pages/PatientRecovery';
import ClinicianOverview from './pages/ClinicianOverview';
import ResearchDashboard from './pages/ResearchDashboard';

/**
 * Main App Component
 * Handles routing for the Nexivo application
 */
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Landing Page */}
          <Route path="/" element={<ReviveCare />} />

          {/* Dashboard Routes */}
          <Route path="/medical-dashboard" element={<RequireDoctor><MedicalDashboard /></RequireDoctor>} />
          <Route path="/doctor/login" element={<DoctorLogin />} />
          <Route path="/doctor" element={<RequireDoctor><DoctorDashboard /></RequireDoctor>} />

          {/* Patient Routes */}
          <Route path="/patient/login" element={<PatientLogin />} />
          <Route path="/patient/dashboard" element={<PatientDashboard />} />
          <Route path="/patient" element={<Navigate to="/patient/login" replace />} />
          <Route path="/patient/simple" element={<PatientDashboardsimple />} />

          {/* Exercise Routes */}
          <Route path="/patient/exercises" element={<ExerciseSelection />} />
          <Route path="/patient/exercise/:exerciseId" element={<ExerciseWorkout />} />

          {/* Nexivo recovery monitoring */}
          <Route path="/patient/check-in" element={<CheckInForm />} />
          <Route path="/patient/movement-test" element={<MovementTest />} />
          <Route path="/patient/recovery" element={<PatientRecovery />} />
          <Route path="/doctor/overview" element={<RequireDoctor><ClinicianOverview /></RequireDoctor>} />
          <Route path="/doctor/patients/:id" element={<RequireDoctor><PatientRecovery /></RequireDoctor>} />
          <Route path="/research" element={<RequireDoctor><ResearchDashboard /></RequireDoctor>} />

          {/* Chat Interface Route - Patient AI Assistant */}
          <Route path="/patient/chat" element={<ChatInterface />} />
          <Route path="/chat" element={<ChatInterface />} />

          {/* Form Routes */}
          <Route path="/doctor/add-patient" element={<RequireDoctor><AddPatientForm /></RequireDoctor>} />
          <Route path="/add-patient/standalone" element={<RequireDoctor><AddPatientFormStandalone /></RequireDoctor>} />

          {/* Redirect unknown routes to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;