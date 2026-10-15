/**
 * Interactive prompt helpers built on inquirer.
 *
 * Every helper validates using the same `src/utils/validate.js` rules the
 * services use, so nothing invalid can travel to the database and the error
 * messages the user sees always match the business rules.
 */
import inquirer from 'inquirer';
import { asAmount, asBoolean, asInteger, asText } from '../utils/validate.js';

/** Thrown when the user presses Ctrl+C / Esc - handled once at the top level. */
export class PromptExit extends Error {
  constructor(message = 'Aborted by user.') {
    super(message);
    this.name = 'PromptExit';
    this.expected = true;
  }
}

async function ask(question) {
  try {
    const answers = await inquirer.prompt([question]);
    return answers.value;
  } catch (error) {
    if (error?.name === 'ExitPromptError') throw new PromptExit();
    throw error;
  }
}

const trim = (input) => (typeof input === 'string' ? input.trim() : input);

/**
 * @param {{type?: string, message: string, choices?: any[], default?: any,
 *          clean?: (value: any) => any, optional?: boolean, pageSize?: number, mask?: string}} options
 */
async function askValue({
  type = 'input',
  message,
  choices,
  default: defaultValue,
  clean,
  optional = false,
  pageSize,
  mask,
}) {
  const validate = (input) => {
    const raw = trim(input);
    if (optional && (raw === '' || raw === null || raw === undefined)) return true;
    if (!clean) return true;
    try {
      clean(raw);
      return true;
    } catch (error) {
      return error.message ?? 'Invalid value.';
    }
  };

  const raw = await ask({
    type,
    name: 'value',
    message,
    choices,
    default: defaultValue,
    pageSize,
    mask,
    validate: type === 'list' ? undefined : validate,
    filter: trim,
  });

  if (optional && (raw === '' || raw === null || raw === undefined)) return null;
  return clean ? clean(raw) : raw;
}

/** Free text. `field` is used in validation messages. */
export async function text(message, { field = message, default: defaultValue, max = 200, optional = false } = {}) {
  return askValue({
    message,
    default: defaultValue,
    optional,
    clean: (value) => asText(value, field, { max, optional }),
  });
}

export async function requiredText(message, { field = message, default: defaultValue, max = 200 } = {}) {
  return text(message, { field, default: defaultValue, max });
}

export async function integer(message, { field = message, default: defaultValue, min, max, optional = false } = {}) {
  return askValue({
    message,
    default: defaultValue,
    optional,
    clean: (value) => asInteger(value, field, { min, max }),
  });
}

export async function amount(message, { field = message, default: defaultValue, min = 0.01, optional = false } = {}) {
  return askValue({
    message,
    default: defaultValue,
    optional,
    clean: (value) => asAmount(value, field, { min }),
  });
}

export async function confirm(message, defaultValue = false) {
  const value = await ask({
    type: 'confirm',
    name: 'value',
    message,
    default: defaultValue,
  });
  return value === true;
}

/** yes/no answered by typing, for forms where a strict list is nicer. */
export async function yesNo(message, { default: defaultValue = true } = {}) {
  const value = await ask({
    type: 'list',
    name: 'value',
    message,
    default: defaultValue,
    choices: [
      { name: 'Yes', value: 'yes' },
      { name: 'No', value: 'no' },
    ],
  });
  return asBoolean(value, message);
}

/**
 * Single choice list.
 * @param {string} message
 * @param {Array<{name: string, value: any, short?: string}>} choices
 */
export async function select(message, choices, { pageSize = 15, default: defaultValue } = {}) {
  return ask({
    type: 'list',
    name: 'value',
    message,
    choices,
    pageSize,
    default: defaultValue,
  });
}

export async function multiSelect(message, choices, { pageSize = 15, default: defaultValue = [] } = {}) {
  return ask({
    type: 'checkbox',
    name: 'value',
    message,
    choices,
    pageSize,
    default: defaultValue,
  });
}

export async function password(message) {
  const value = await ask({ type: 'password', name: 'value', message, mask: '*' });
  return typeof value === 'string' ? value : '';
}

/** Wait for the user before redrawing a menu. */
export async function pause(message = 'Press ENTER to continue') {
  try {
    await ask({ type: 'input', name: 'value', message: `${message} ...`, default: '' });
  } catch (error) {
    if (error instanceof PromptExit) return;
    throw error;
  }
}

export { PromptExit as Exit };
