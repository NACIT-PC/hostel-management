import { HEALTH_REQUIREMENT_BY_CODE, ALL_YEARS } from '../config.js';

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

export function amenitySet(amenities) {
  return new Set(
    String(amenities ?? '')
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  );
}

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

export function requirementLabel(code) {
  return HEALTH_REQUIREMENT_BY_CODE.get(code)?.label ?? code;
}
