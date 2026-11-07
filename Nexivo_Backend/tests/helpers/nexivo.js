// A browser-like client for the Nexivo /api/ routes, as React calls them:
// CSRF cookie + X-CSRFToken header, JSON in and out.

import request from 'supertest';
import { setCookies } from './cookies.js';

const ORIGIN = 'http://localhost:5173';

/**
 * @param {import('express').Express} app
 * @param {string} [email] log in as this patient; without it the client is a clinician (no login)
 */
export async function apiClient(app, email) {
  const agent = request.agent(app);
  if (email) await agent.post('/login/').type('form').send({ email });
  const token = decodeURIComponent(setCookies(await agent.get('/csrf/')).csrftoken.value);
  const send = (method) => (url, body) =>
    agent[method](url).set('Origin', ORIGIN).set('X-CSRFToken', token).set('Accept', 'application/json').send(body);
  return {
    get: (url) => agent.get(url).set('Accept', 'application/json'),
    post: send('post'),
    put: send('put'),
    patch: send('patch'),
  };
}

export const daysAgoDate = (d) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
export const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
