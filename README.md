# Nexivo

A post-operative recovery monitoring and risk assessment system, built as a personal project by [Tushar Singla](#author), a final-year B.Tech IT student.

After surgery, patients go home and their recovery is checked now and then against fixed rules, the same for everyone ("pain 7 or more is bad"). Nexivo asks a different question: **is this patient recovering as expected, compared with themselves?** It keeps every check-in as permanent history and gives:

- **A Personalized Recovery Score (0–100)** for each check-in, judged against the patient's own recent baseline, their trend and an expected recovery curve, with a category: **Normal**, **Slower than expected** or **Requires attention**.
- **Trend and anomaly alerts:** sudden deterioration, a drop from the personal baseline, unusual changes, no improvement, missed medication, overdue milestones. Duplicates are merged, and alerts can be acknowledged and resolved.
- **Explanations:** which parameters moved the score, in plain sentences ("Pain rose to 7/10 (usual for this patient: 3/10), lowering the score by 10 points."), plus a recommendation. All wording comes from templates, never from an AI.
- **Dashboards** for patients and clinicians, and a **research module** that measures Nexivo against a fixed-threshold baseline.

It also keeps everything from the earlier version: an AI recovery chat (English or Hindi) that alerts the doctor when a message sounds serious, and camera-tracked exercises that count reps in the browser.

> Nexivo provides decision support and does not replace clinical judgement. It is a student project, not a medical product, and its thresholds are not clinically validated. Please use only made-up data.

Nexivo is the next version of my earlier project, ReViveCare. Database names and demo emails still use `revivecare`; renaming them would break existing setups and logins.

## Quick start

**You need:** Node.js 22+ and PostgreSQL 14+ running locally. No API keys are needed to try the recovery features (the AI chat needs a free Groq key; see [Configuration](#configuration)).

**1. Databases** (one role, a development database and a test database):

```sh
createuser revivecare
createdb -O revivecare revivecare_dev
createdb -O revivecare revivecare_test
# The migrations and tests recreate the `public` schema, so the role must own it.
psql -d revivecare_dev -c 'ALTER SCHEMA public OWNER TO revivecare'
psql -d revivecare_test -c 'ALTER SCHEMA public OWNER TO revivecare'
```

**2. Backend** (first terminal):

```sh
cd Nexivo_Backend
cp .env.example .env
# In .env, set SESSION_SECRET and CSRF_SECRET to two different random values,
# e.g. the output of: openssl rand -hex 32
npm install
npm run db:migrate   # creates the tables and the default scoring config
npm run db:demo      # demo doctor, and demo patients with recovery histories (safe to run again)
npm run dev          # http://localhost:3000
```

**3. Frontend** (second terminal):

```sh
cd Nexivo_Frontend
npm install
npm run dev          # http://localhost:5173
```

Open http://localhost:5173.

## Try it

All demo accounts hold made-up data and are created by `npm run db:demo`.

**As a patient:** choose **Patient Portal** and log in with a demo account (login checks only the email in this version, so any password works). Then open **My Recovery** or **Daily Check-in** on the dashboard.

| Email                           | Surgery (made up)                    | Recovery status                              |
| ------------------------------- | ------------------------------------ | -------------------------------------------- |
| `demo.knee@revivecare.test`     | Knee ACL reconstruction, 10 days ago | Requires attention                           |
| `demo.hip@revivecare.test`      | Hip replacement, 3 weeks ago         | Slower than expected                         |
| `demo.shoulder@revivecare.test` | Rotator cuff repair, 6 weeks ago     | Normal                                       |
| `demo.appendix@revivecare.test` | Appendectomy, 4 days ago             | Normal (limited history: only two check-ins) |

**As a doctor:** choose **Doctor Portal** (http://localhost:5173/doctor) and log in. Here the password is checked.

| Email                         | Password   |
| ----------------------------- | ---------- |
| `demo.doctor@revivecare.test` | `demo1234` |

**Recovery Overview** lists the patients, most urgent first; click one to see their score, factors, charts, alerts, milestones and timeline. **Research Evaluation** opens the research dashboard.

## Configuration

**Environment:** every variable is described in [`Nexivo_Backend/.env.example`](Nexivo_Backend/.env.example). Only `DATABASE_URL`, `SESSION_SECRET` and `CSRF_SECRET` are required. The AI chat needs `GROQ_API_KEY`; doctor alert emails need the `SMTP_*`, `EMAIL_*` and `DOCTOR_EMAIL` values (Twilio calls are optional). The server refuses to start, naming the problem, if a value is missing or invalid.

**Scoring:** weights, thresholds, window sizes and all explanation text live in a versioned **scoring config** in the database. The active version is `nexivo-1.1` (the spec's defaults plus the text templates). Config versions are never edited: a change is a new version, and every stored score records the version that produced it.

```sh
# See the active config
curl -s http://localhost:3000/api/config/scoring

# Create and activate a new version (weights must add up to 1.0; every setting is checked).
# Write requests need the CSRF cookie and header, and this one a doctor login:
curl -s -c jar.txt http://localhost:3000/csrf/ > /dev/null
TOKEN=$(awk '$6 == "csrftoken" { print $7 }' jar.txt | sed 's/%7C/|/g')
curl -s -b jar.txt -c jar.txt -H "X-CSRFToken: $TOKEN" -H 'Content-Type: application/json' \
  -X POST http://localhost:3000/api/doctor/login \
  -d '{"email": "demo.doctor@revivecare.test", "password": "demo1234"}'
curl -s http://localhost:3000/api/config/scoring \
  | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const { params } = JSON.parse(s);
      params.weights.pain = 0.3; params.weights.milestones = 0.05;
      console.log(JSON.stringify({ version: "my-1.2", params }));
    })' > new-config.json
curl -s -b jar.txt -H "X-CSRFToken: $TOKEN" -H 'Content-Type: application/json' \
  -X POST http://localhost:3000/api/config/scoring -d @new-config.json

# Score existing check-ins with the new version (old scores are kept)
cd Nexivo_Backend && npm run db:recompute
```

Every setting is validated by the schema in [`Nexivo_Backend/src/config/scoringConfig.js`](Nexivo_Backend/src/config/scoringConfig.js).

## Running an evaluation

The research dashboard (http://localhost:5173/research, also linked from the doctor dashboard) compares two engines, check-in by check-in, without look-ahead: at each step both see only that patient's earlier check-ins.

- **Fixed-threshold baseline:** ReviveCare's own rule evaluator, unchanged, applied to the same thresholds for everyone (pain ≥ 7, mobility ≤ 3, adherence below 80%, any severe symptom), with no history.
- **Nexivo:** the personalized score, alerts and category.

1. **Get data:** generate a synthetic dataset (choose a seed and a number of patients), or import a CSV with the columns `patient_id, day_post_op, pain, mobility, fatigue, <symptom columns>, doses_prescribed, doses_taken, milestones_completed, milestones_due, label`. The label is `normal`, `slower` or `attention`; symptom columns are any of `fever, wound_redness, swelling, nausea, breathlessness` (severity 0–3).
2. **Run:** pick the dataset and a split seed. Patients are split 30% tuning / 70% test; the table shows the test set.
3. **Read and export:** accuracy, precision, recall, F1-score, false-positive rate and false positives per patient side by side (positive class: Requires attention), Nexivo's 3-class accuracy and macro-F1, and confusion matrices. Export as CSV or JSON.

The same dataset, config and seed always give identical metrics.

> Results on synthetic data validate the pipeline and illustrate how the engines behave. They are not clinical evidence. Clinical claims require validated datasets and ethical approval (future scope).

## Tests

```sh
cd Nexivo_Backend && npm test     # unit + integration tests (uses revivecare_test, rebuilt on every run)
cd Nexivo_Frontend && npm test    # unit tests
```

Both folders also have `npm run lint`. The backend README covers coverage, golden tests and the Django parity suite.

## Repository layout

| Folder                                | What it is                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`Nexivo_Frontend/`](Nexivo_Frontend) | React 19 + Vite app: patient and clinician screens, recovery and research dashboards, AI chat, pose tracking                             |
| [`Nexivo_Backend/`](Nexivo_Backend)   | Node.js 22 + Express 5 + PostgreSQL API: recovery data, scoring engine (`src/engine`), research (`src/research`), chat, exercise history |
| [`parity-tools/`](parity-tools)       | Scripts I used to check the Node.js backend behaves exactly like the original Django version                                             |

## Known limitations

- Patient login checks only the email address; there are no real passwords yet.
- Every doctor can see every patient: nothing limits a doctor to their assigned patients yet. There is also no screen to create doctors or change a password; the demo doctor comes from `npm run db:demo`.
- Days after surgery are counted in UTC calendar days.
- Scores, alerts and categories come from deterministic rules with starting values for a research prototype, not clinically validated thresholds. There is no machine learning and no forecasting.

## The story behind the backend

I first built the backend in Django. To learn Node.js and PostgreSQL properly, I rewrote it as a Node.js + Express API with raw SQL, keeping every endpoint and rule the frontend relies on. To prove nothing changed, I wrote a parity suite that sends the same 116 request scenarios to both backends and compares the answers. Nexivo then grew on top of that codebase, and the only existing endpoint whose behaviour changed is `POST /doctor_info`, which now needs a doctor login. ReviveCare's rule logic now serves as the baseline Nexivo is measured against.

## Author

**Tushar Singla**, final-year B.Tech IT student at Maharaja Agrasen Institute of Technology, Delhi.

- GitHub: [@TR1CK5T4R](https://github.com/TR1CK5T4R)
- LinkedIn: [tushar-singla-b8aaa027b](https://www.linkedin.com/in/tushar-singla-b8aaa027b)
