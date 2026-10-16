import { getDb } from '../db/connection.js';

export function log({ actor = null, action, entity = null, entityId = null, detail = null }) {
  try {
    const serialised =
      detail === null || detail === undefined
        ? null
        : typeof detail === 'string'
          ? detail
          : JSON.stringify(detail);

    getDb()
      .prepare(
        `INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actor?.id ?? null,
        actor?.username ?? null,
        String(action),
        entity,
        entityId === null || entityId === undefined ? null : Number(entityId),
        serialised,
      );
  } catch (error) {
    process.stderr.write(`[audit] failed to record "${action}": ${error.message}\n`);
  }
}

export function listAuditLog({ limit = 50, action = null, actorId = null, entity = null } = {}) {
  const conditions = [];
  const params = [];
  if (action) {
    conditions.push('action = ?');
    params.push(action);
  }
  if (actorId) {
    conditions.push('user_id = ?');
    params.push(actorId);
  }
  if (entity) {
    conditions.push('entity = ?');
    params.push(entity);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb()
    .prepare(
      `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.detail,
              COALESCE(u.username, a.username) AS username
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
         ${where}
        ORDER BY a.id DESC
        LIMIT ?`,
    )
    .all(...params, Number(limit));
}
