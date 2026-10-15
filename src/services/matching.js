/**
 * Matching rules.
 *
 * These functions encode *why* a student may or may not be placed in a given
 * hostel/room/bed. They are pure (no database access) which keeps the rules
 * easy to unit-test and impossible to bypass accidentally.
 */
import { HEALTH_REQUIREMENT_BY_CODE, ALL_YEARS } from '../config.js';

/**
 * Hostel-level rules: gender and year/form restriction.
 * @returns {{ok: boolean, reasons: string[]}}
 */
export function hostelAcceptsStudent(hostel, student) {
  const reasons = [];
  if (!hostel || !student) return { ok: false, reasons: ['Missing hostel or student record.'] };

  if (hostel.gender !== 'Mixed' && hostel.gender !== student.gender) {
    reasons.push(
      `${hostel.name} is a ${hostel.gender.toLowerCase()} hostel but the student is ${String(
        student.gender,
      ).toLowerCase()}.`,
    );
  }

  const category = hostel.category ?? ALL_YEARS;
  if (category !== ALL_YEARS && category !== student.year_form) {
    reasons.push(`${hostel.name} is reserved for ${category} (student is ${student.year_form}).`);
  }

  return { ok: reasons.length === 0, reasons };
}

/** Split the stored comma separated amenities string into a lookup set. */
export function amenitySet(amenities) {
  return new Set(
    String(amenities ?? '')
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  );
}

/**
 * Does a physical room+bed satisfy a requirement code?
 * @returns {boolean|null} `null` when the code is advisory only (not enforceable).
 */
export function requirementSatisfied(code, room, bed) {
  const meta = HEALTH_REQUIREMENT_BY_CODE.get(code);
  if (!meta || !meta.enforceable) return null;
  const amenities = amenitySet(room?.amenities);

  switch (code) {
    case 'GROUND_FLOOR':
      return Number(room?.floor ?? 0) === 0;
    case 'LOWER_BUNK':
      return bed?.bunk_level !== 'UPPER';
    case 'QUIET_ROOM':
      return amenities.has('QUIET');
    case 'FAN_REQUIRED':
      return amenities.has('FAN');
    case 'EN_SUITE':
      return amenities.has('EN_SUITE');
    case 'NEAR_BATHROOM':
      return amenities.has('NEAR_BATHROOM');
    case 'WHEELCHAIR_ACCESS':
      return amenities.has('WHEELCHAIR_ACCESS');
    case 'SINGLE_ROOM':
      return Number(room?.capacity ?? 0) === 1;
    default:
      return null;
  }
}

/**
 * Evaluate a bed against a student's health requirements.
 *
 * @param {Array<{code: string, level: 'required'|'preferred'}>} requirements
 * @param {{floor:number, capacity:number, amenities:string}} room
 * @param {{bunk_level:string}} bed
 */
export function evaluateBed(requirements, room, bed) {
  const unmetRequired = [];
  const unmetPreferred = [];
  const metPreferred = [];

  for (const requirement of requirements ?? []) {
    const satisfied = requirementSatisfied(requirement.code, room, bed);
    if (satisfied === null) continue; // advisory note - cannot be enforced
    if (!satisfied) {
      if (requirement.level === 'required') unmetRequired.push(requirement.code);
      else unmetPreferred.push(requirement.code);
    } else if (requirement.level === 'preferred') {
      metPreferred.push(requirement.code);
    }
  }

  return {
    hardOk: unmetRequired.length === 0,
    unmetRequired,
    unmetPreferred,
    metPreferred,
    score: metPreferred.length - unmetPreferred.length,
  };
}

/** Human readable label for a requirement code. */
export function requirementLabel(code) {
  return HEALTH_REQUIREMENT_BY_CODE.get(code)?.label ?? code;
}
