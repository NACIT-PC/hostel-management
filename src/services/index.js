/**
 * Service barrel. Services import each other directly by file (never through
 * this barrel) so that this module cannot create import cycles.
 */
export * as auditService from './auditService.js';
export * as authService from './authService.js';
export * as settingsService from './settingsService.js';
export * as hostelService from './hostelService.js';
export * as studentService from './studentService.js';
export * as feeService from './feeService.js';
export * as eligibilityService from './eligibilityService.js';
export * as allocationService from './allocationService.js';
export * as stayService from './stayService.js';
export * as reportService from './reportService.js';

export { roleLabel } from './authService.js';
export { canRevealHealth } from './studentService.js';
export { hostelRuleText, describeCategory } from './hostelService.js';
export { requirementLabel } from './matching.js';
export { money } from '../utils/format.js';
