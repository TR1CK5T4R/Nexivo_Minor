import { useCallback, useEffect, useState } from 'react';
import { recoveryAPI } from '../services/djangoApi';

// 404 means "not there yet" (no profile, no score), not an error.
const orNull = (err) => {
    if (err.status === 404) return null;
    throw err;
};

/**
 * Everything the patient recovery page shows, loaded in parallel.
 * @param {number | undefined} patientId
 * @returns {{ data: object | null, loading: boolean, error: Error | null, reload: () => Promise<void> }}
 */
export const useRecoveryData = (patientId) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const reload = useCallback(async () => {
        if (!patientId) return;
        try {
            setError(null);
            const [profile, latest, scores, timeline, alerts, milestones] = await Promise.all([
                recoveryAPI.getProfile(patientId).catch(orNull),
                recoveryAPI.getLatestScore(patientId).catch(orNull),
                recoveryAPI.listScores(patientId),
                recoveryAPI.getTimeline(patientId),
                recoveryAPI.listAlerts(patientId),
                recoveryAPI.listMilestones(patientId),
            ]);
            setData({ profile, latest, scores, timeline, alerts, milestones });
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [patientId]);

    useEffect(() => {
        reload();
    }, [reload]);

    return { data, loading, error, reload };
};

export default useRecoveryData;
