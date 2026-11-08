// A browser-like client for the Nexivo /api/ routes, as React calls them:
// CSRF cookie + X-CSRFToken header, JSON in and out.

import request from 'supertest';
import { setCookies } from './cookies.js';
import { createDoctor, TEST_DOCTOR } from './db.js';

const ORIGIN = 'http://localhost:5173';

/**
 * @param {import('express').Express} app
 * @param {string | null} [email] log in as this patient; without it the client is the
 *   test doctor; null means no login at all
 */
export async function apiClient(app, email) {
  const agent = request.agent(app);
  if (email) await agent.post('/login/').type('form').send({ email });
  const csrfCookie = setCookies(await agent.get('/csrf/')).csrftoken.value;
  const token = decodeURIComponent(csrfCookie);
  let sessionCookie;
  if (email === undefined) {
    await createDoctor();
    const { email: doctorEmail, password } = TEST_DOCTOR;
    const login = await agent
      .post('/api/doctor/login')
      .set('Origin', ORIGIN)
      .set('X-CSRFToken', token)
      .send({ email: doctorEmail, password });
    if (login.status !== 200) throw new Error(`doctor login failed: ${login.status}`);
    sessionCookie = setCookies(login).sessionid.value;
  }
  const send = (method) => (url, body) =>
    agent[method](url).set('Origin', ORIGIN).set('X-CSRFToken', token).set('Accept', 'application/json').send(body);
  return {
    get: (url) => agent.get(url).set('Accept', 'application/json'),
    post: send('post'),
    put: send('put'),
    patch: send('patch'),
    headers: () => ({
      Cookie: `csrftoken=${csrfCookie}; sessionid=${sessionCookie}`,
      Origin: ORIGIN,
      'X-CSRFToken': token,
    }),
  };
}

/**
 * Headers for a raw POST /doctor_info as the logged-in test doctor (cookies, CSRF
 * token, trusted Origin), for tests that need exact control over the request body.
 *
 * @param {import('express').Express} app
 * @returns {Promise<Record<string, string>>}
 */
export async function doctorHeaders(app) {
  const c = await apiClient(app);
  return c.headers();
}

export const daysAgoDate = (d) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
export const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
