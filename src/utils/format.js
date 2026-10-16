const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;

const wrap = (code, reset = 39) => (text) =>
  useColor ? `\u001b[${code}m${text}\u001b[${reset}m` : String(text);

export const color = {
  bold: (t) => (useColor ? `\u001b[1m${t}\u001b[22m` : String(t)),
  dim: (t) => (useColor ? `\u001b[2m${t}\u001b[22m` : String(t)),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  gray: wrap(90),
};

export function heading(title) {
  return `\n${color.bold(title)}`;
}

export function section(title) {
  return `\n${color.bold(title)}`;
}

export function success(message) {
  return `${color.green('[OK]')} ${message}`;
}

export function warn(message) {
  return `${color.yellow('[!]')} ${message}`;
}

export function failure(message) {
  return `${color.red('[x]')} ${message}`;
}

export function info(message) {
  return `${color.cyan('[i]')} ${message}`;
}

export function bullet(message, level = 0) {
  return `${'  '.repeat(level)}${color.dim('-')} ${message}`;
}

const displayWidth = (text) => String(text ?? '').length;

const align = (text, width, alignment) => {
  const value = String(text ?? '');
  if (alignment === 'right') return value.padStart(width);
  if (alignment === 'center') {
    const left = Math.floor((width - value.length) / 2);
    return ' '.repeat(Math.max(0, left)) + value.padEnd(width - Math.max(0, left));
  }
  return value.padEnd(width);
};

export function table(rows, columns, options = {}) {
  const { empty = 'No records found.', maxWidth = 160 } = options;
  if (!rows || rows.length === 0) return color.dim(empty);

  const cellValue = (row, column) =>
    column.format ? column.format(row) : row[column.key] ?? '';

  const widths = columns.map((column, index) => {
    const headerLength = displayWidth(column.header);
    const maxCell = rows.reduce(
      (max, row) => Math.max(max, displayWidth(cellValue(row, column))),
      0,
    );
    const preferred = Math.max(headerLength, Math.min(maxCell, column.max ?? 40));
    return Math.max(preferred, index === 0 ? 3 : 3);
  });

  const totalWidth = () =>
    widths.reduce((sum, width) => sum + width, 0) + (columns.length - 1) * 3;

  while (totalWidth() > maxWidth) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 6) break;
    widths[widest] -= 1;
  }

  const truncate = (text, width) => {
    const value = String(text ?? '');
    if (value.length <= width) return value;
    return `${value.slice(0, Math.max(0, width - 1))}...`;
  };

  const lines = [];
  lines.push(
    color.bold(
      columns
        .map((column, index) => align(truncate(column.header, widths[index]), widths[index], column.align))
        .join(' | '),
    ),
  );
  lines.push(color.dim(widths.map((width) => '-'.repeat(width)).join('-+-')));

  for (const row of rows) {
    lines.push(
      columns
        .map((column, index) => align(truncate(cellValue(row, column), widths[index]), widths[index], column.align))
        .join(' | '),
    );
  }

  return lines.join('\n');
}

export function keyValue(pairs) {
  const width = pairs.reduce((max, [key]) => Math.max(max, key.length), 0);
  return pairs.map(([key, value]) => `${color.dim(key.padEnd(width))} : ${value}`).join('\n');
}

export function money(amount, currency = '') {
  const value = Number(amount || 0);
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}

export function dateTime(value) {
  if (!value) return color.dim('-');
  return String(value).replace('T', ' ').slice(0, 19);
}

export function sensitive(value, reveal = false) {
  if (value === undefined || value === null || String(value).trim() === '') return color.dim('-');
  return reveal ? String(value) : `${color.yellow('[private]')} ${color.dim('(restricted)')}`;
}

export function maskNote(value) {
  return value ? 'Yes' : 'No';
}
