// Strict parser for research dataset CSVs. The schema is
// fixed and numeric, so there is no quoting: a field with a quote is rejected
// rather than half-understood. Pure.
//
// Columns: patient_id, day_post_op, pain, mobility, fatigue, <one per configured
// symptom, optional>, doses_prescribed, doses_taken, milestones_completed,
// milestones_due, label (normal | slower | attention). Any order.

const REQUIRED = [
  'patient_id',
  'day_post_op',
  'pain',
  'mobility',
  'fatigue',
  'doses_prescribed',
  'doses_taken',
  'milestones_completed',
  'milestones_due',
  'label',
];
const LABELS = ['normal', 'slower', 'attention'];
export const MAX_ROWS = 50_000;

/** A CSV problem, with the 1-based line it was found on. */
export class CsvError extends Error {
  constructor(line, message) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'CsvError';
  }
}

const RANGES = {
  day_post_op: [0, 365],
  pain: [0, 10],
  mobility: [0, 10],
  fatigue: [0, 10],
  doses_prescribed: [0, 1000],
  doses_taken: [0, 1000],
  milestones_completed: [0, 100],
  milestones_due: [0, 100],
};

/**
 * @param {string} text the CSV file
 * @param {string[]} symptomNames the scoring config's symptom list (allowed extra columns)
 * @returns {object[]} rows in file order: {patient_key, day_post_op, pain, ..., symptoms, label}
 * @throws {CsvError}
 */
export function parseResearchCsv(text, symptomNames) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  for (const name of REQUIRED) if (!header.includes(name)) throw new CsvError(1, `missing column "${name}"`);
  for (const [i, name] of header.entries()) {
    if (header.indexOf(name) !== i) throw new CsvError(1, `column "${name}" appears twice`);
    if (!REQUIRED.includes(name) && !symptomNames.includes(name))
      throw new CsvError(1, `unknown column "${name}" (symptom columns: ${symptomNames.join(', ')})`);
  }
  const symptomColumns = header.filter((h) => symptomNames.includes(h));

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    const line = i + 1;
    if (lines[i].includes('"')) throw new CsvError(line, 'quoted fields are not supported');
    const cells = lines[i].split(',').map((c) => c.trim());
    if (cells.length !== header.length)
      throw new CsvError(line, `expected ${header.length} fields, got ${cells.length}`);
    const cell = (name) => cells[header.indexOf(name)];
    const int = (name, [min, max]) => {
      const value = cell(name);
      if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
        throw new CsvError(line, `${name} must be a whole number from ${min} to ${max} (got "${value}")`);
      return Number(value);
    };
    const patientKey = cell('patient_id');
    if (patientKey === '' || patientKey.length > 100) throw new CsvError(line, 'patient_id must be 1-100 characters');
    const label = cell('label');
    if (!LABELS.includes(label)) throw new CsvError(line, `label must be one of ${LABELS.join(', ')} (got "${label}")`);
    const row = {
      patient_key: patientKey,
      ...Object.fromEntries(Object.entries(RANGES).map(([name, range]) => [name, int(name, range)])),
      symptoms: Object.fromEntries(symptomColumns.map((s) => [s, int(s, [0, 3])])),
      label,
    };
    if (row.doses_taken > row.doses_prescribed) throw new CsvError(line, 'doses_taken is more than doses_prescribed');
    if (row.milestones_completed > row.milestones_due)
      throw new CsvError(line, 'milestones_completed is more than milestones_due');
    rows.push(row);
    if (rows.length > MAX_ROWS) throw new CsvError(null, `more than ${MAX_ROWS} rows`);
  }
  if (rows.length === 0) throw new CsvError(null, 'no data rows');
  return rows;
}
