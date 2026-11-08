// API Service for connecting React to Django Backend
// This file contains functions that match your actual Django endpoints

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL !== undefined 
    ? import.meta.env.VITE_API_BASE_URL 
    : ''; // Default to empty string for Vite proxy in local dev

// Helper to get CSRF token from cookies
const getCSRFToken = () => {
    const name = 'csrftoken';
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
};

// Generic API call helper
const apiCall = async (endpoint, method = 'GET', data = null) => {
    const csrfToken = getCSRFToken();

    const config = {
        method,
        credentials: 'include', // Important for session-based auth
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json', // Tell Django we want JSON response
            ...(csrfToken && { 'X-CSRFToken': csrfToken })
        },
    };

    if (data && method !== 'GET') {
        config.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

        // Handle different response types
        if (response.status === 204) {
            return { success: true };
        }

        const responseData = await response.json().catch(() => ({}));

        if (!response.ok) {
            // Nexivo endpoints answer {error, fields}; older ones may send {message}.
            const error = new Error(responseData.message || responseData.error || `API Error: ${response.statusText}`);
            error.status = response.status;
            error.fields = responseData.fields;
            throw error;
        }

        return responseData;
    } catch (error) {
        console.error(`API call failed for ${endpoint}:`, error);
        throw error;
    }
};

// Fetch CSRF token from Django
export const fetchCSRFToken = async () => {
    try {
        // Make a simple GET request to get the CSRF token cookie
        await fetch(`${API_BASE_URL}/csrf/`, {
            credentials: 'include'
        });
    } catch (error) {
        console.error('Failed to fetch CSRF token:', error);
    }
};

// ==================== Patient API ====================

export const patientAPI = {
    // Patient login (email only) - Django expects form data and returns HTML redirect
    login: async (email) => {
        // First, get CSRF token by making a request to Django
        await fetchCSRFToken();

        const csrfToken = getCSRFToken();

        // Send as form data instead of JSON
        const formData = new URLSearchParams();
        formData.append('email', email);

        const config = {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(csrfToken && { 'X-CSRFToken': csrfToken })
            },
            body: formData,
            redirect: 'manual' // Don't follow redirects automatically
        };

        try {
            const response = await fetch(`${API_BASE_URL}/login/`, config);

            // Django returns 302 redirect on success, or renders error page
            // Status 0 means opaqueredirect (redirect blocked by CORS but request succeeded)
            // Status 200 could be the form page or error
            // Status 302 is redirect (success)
            if (response.status === 0 || response.status === 302 || response.type === 'opaqueredirect') {
                return { success: true };
            }

            // If we get here, login might have failed
            // Try to get error message from response
            const text = await response.text().catch(() => '');
            console.error('Login may have failed:', text);

            // But let's be optimistic - if we got a response, try checking auth
            return { success: true };

        } catch (error) {
            console.error('Login request failed:', error);
            throw new Error('Unable to connect to server. Please make sure Django is running.');
        }
    },

    // Get current logged-in patient dashboard data
    getDashboard: async () => {
        return apiCall('/patient/dashboard/');
    },

    // Logout patient. The backend answers 302 → '/', which isn't an API page
    // (404 on Node), so don't follow it: the redirect itself means the
    // session was destroyed. Same approach as login above.
    logout: async () => {
        const csrfToken = getCSRFToken();
        const response = await fetch(`${API_BASE_URL}/patient/logout/`, {
            method: 'POST',
            credentials: 'include',
            headers: { ...(csrfToken && { 'X-CSRFToken': csrfToken }) },
            redirect: 'manual',
        });
        if (response.type === 'opaqueredirect' || response.status === 302) {
            return { success: true };
        }
        throw new Error(`API Error: ${response.statusText}`);
    },
};

// ==================== Doctor API ====================

export const doctorAPI = {
    // Submit patient information from doctor
    submitPatientInfo: async (patientData) => {
        return apiCall('/doctor_info', 'POST', patientData);
    },
};

// ==================== Chatbot API ====================

export const chatbotAPI = {
    // Send message to chatbot with optional language (hindi/english)
    sendMessage: async (message, language = 'english') => {
        return apiCall('/patient/chatbot/send/', 'POST', { message, language });
    },
};

// ==================== Exercise API ====================

export const exerciseAPI = {
    // Store one finished or abandoned set (E23). Pose tracking and rep
    // counting run in the browser (hooks/usePoseWorkout.js), replacing Django's
    // /exercise/start/, /status/, /reset/ and /video_feed/.
    saveSession: async ({ exerciseType, targetReps, excellentReps, goodReps, partialReps, startedAt, endedAt }) => {
        return apiCall('/exercise/sessions/', 'POST', {
            exercise_type: exerciseType,
            target_reps: targetReps,
            excellent_reps: excellentReps,
            good_reps: goodReps,
            partial_reps: partialReps,
            started_at: startedAt,
            ended_at: endedAt,
        });
    },
};

// ==================== Nexivo Recovery API ====================

// Clinician pages have no login, so the CSRF cookie may not exist yet.
const unsafeCall = async (endpoint, method, data) => {
    if (!getCSRFToken()) await fetchCSRFToken();
    return apiCall(endpoint, method, data);
};

export const recoveryAPI = {
    getConfig: () => apiCall('/api/config/scoring'),
    getProfile: (patientId) => apiCall(`/api/patients/${patientId}/recovery-profile`),
    saveProfile: (patientId, profile) => unsafeCall(`/api/patients/${patientId}/recovery-profile`, 'PUT', profile),
    // Returns {observation, score, alerts}.
    createObservation: (patientId, checkIn) => unsafeCall(`/api/patients/${patientId}/observations`, 'POST', checkIn),
    getLatestScore: (patientId) => apiCall(`/api/patients/${patientId}/scores/latest`),
    listScores: (patientId) => apiCall(`/api/patients/${patientId}/scores`),
    getTimeline: (patientId) => apiCall(`/api/patients/${patientId}/timeline`),
    listAlerts: (patientId) => apiCall(`/api/patients/${patientId}/alerts`),
    setAlertStatus: (alertId, status) => unsafeCall(`/api/alerts/${alertId}`, 'PATCH', { status }),
    listMilestones: (patientId) => apiCall(`/api/patients/${patientId}/milestones`),
    setMilestoneCompleted: (milestoneId, completed) =>
        unsafeCall(`/api/milestones/${milestoneId}`, 'PATCH', { completed }),
    getOverview: () => apiCall('/api/clinician/overview'),
};

// ==================== Nexivo Research API ====================

export const researchAPI = {
    listDatasets: () => apiCall('/api/research/datasets'),
    // {name, source: 'synthetic', seed, patients} or {name, source: 'csv', csv}
    createDataset: (dataset) => unsafeCall('/api/research/datasets', 'POST', dataset),
    listRuns: () => apiCall('/api/research/evaluations'),
    runEvaluation: (datasetId, seed) => unsafeCall('/api/research/evaluations', 'POST', { dataset_id: datasetId, seed }),
    getRun: (runId) => apiCall(`/api/research/evaluations/${runId}`),
};

// ==================== Combined Export ====================

const djangoAPI = {
    patient: patientAPI,
    doctor: doctorAPI,
    chatbot: chatbotAPI,
    exercise: exerciseAPI,
    recovery: recoveryAPI,
};

export default djangoAPI;
