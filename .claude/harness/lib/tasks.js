'use strict';
// Task-list parser for the build loop: tasks with blocking relationships and an
// AFK (agent can do it alone) or HITL (needs a human) label. See templates/tasks.md.

const TYPES = Object.freeze(['AFK', 'HITL']);
const STATUSES = Object.freeze(['todo', 'doing', 'done', 'blocked']);
const HEADING = /^##\s+([A-Za-z0-9_.-]+)\s*:\s*(.+?)\s*$/;
const FIELD = /^[-*]\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/;

function parseDeps(value) {
  if (!value || /^none$/i.test(value.trim())) return [];
  return value.split(/[,\s]+/).filter(Boolean);
}

function parseTasks(text) {
  const tasks = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (!heading && /^##\s/.test(line)) {
      current = null; // a non-task heading ends the previous task; its fields must not leak
      continue;
    }
    if (heading) {
      current = { id: heading[1], title: heading[2], type: '', blockedBy: [], status: 'todo' };
      tasks.push(current);
      continue;
    }
    const field = current && FIELD.exec(line);
    if (!field) continue;
    const key = field[1].toLowerCase();
    if (key === 'type') current.type = field[2].toUpperCase();
    else if (key === 'status') current.status = field[2].toLowerCase();
    else if (key === 'blocked-by') current.blockedBy = parseDeps(field[2]);
  }
  return tasks;
}

function findCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map(); // id -> 'visiting' | 'done'
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'visiting') return [...trail.slice(trail.indexOf(id)), id];
    state.set(id, 'visiting');
    for (const dep of byId.get(id).blockedBy) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep, [...trail, id]);
      if (cycle) return cycle;
    }
    state.set(id, 'done');
    return null;
  };
  for (const t of tasks) {
    const cycle = visit(t.id, []);
    if (cycle) return cycle;
  }
  return null;
}

function validateTasks(tasks) {
  if (tasks.length === 0) return ['no tasks found (expected "## <id>: <title>" headings)'];
  const errors = [];
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) errors.push(`duplicate id ${t.id}`);
    ids.add(t.id);
  }
  for (const t of tasks) {
    if (!t.type) errors.push(`${t.id}: missing type (AFK or HITL)`);
    else if (!TYPES.includes(t.type)) errors.push(`${t.id}: unknown type "${t.type}"`);
    if (!STATUSES.includes(t.status)) errors.push(`${t.id}: unknown status "${t.status}"`);
    for (const dep of t.blockedBy) if (!ids.has(dep)) errors.push(`${t.id}: blocked by unknown task ${dep}`);
  }
  const cycle = findCycle(tasks);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')}`);
  return errors;
}

function readyTasks(tasks, { includeHitl = false } = {}) {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
  return tasks.filter(
    (t) => t.status === 'todo' && (includeHitl || t.type === 'AFK') && t.blockedBy.every((d) => done.has(d)),
  );
}

function summarise(tasks) {
  const ready = readyTasks(tasks);
  if (ready.length > 0) return { state: 'ready', ready };
  if (tasks.every((t) => t.status === 'done')) return { state: 'all-done', ready: [] };
  if (tasks.some((t) => t.status === 'doing')) return { state: 'in-progress', ready: [] };
  if (readyTasks(tasks, { includeHitl: true }).length > 0) return { state: 'needs-human', ready: [] };
  return { state: 'stuck', ready: [] };
}

module.exports = { parseTasks, validateTasks, readyTasks, summarise, TYPES, STATUSES };
