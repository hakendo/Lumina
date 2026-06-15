// Safe arithmetic expression evaluator — no eval, no Function().
// Supports: field references, numeric literals, +  -  *  /  (  )  unary minus.
// Field values are substituted before parsing; the resulting token stream
// contains only numbers and operators, so no user input reaches a code path.

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue; }
    if (/[+\-*/()]/.test(expr[i])) { tokens.push(expr[i++]); continue; }
    if (/[\d.]/.test(expr[i])) {
      let num = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) num += expr[i++];
      tokens.push(num);
      continue;
    }
    // Unexpected character — abort
    return null;
  }
  return tokens;
}

// Recursive descent: expr → term (('+' | '-') term)*
function parseExpr(tokens, pos) {
  let left = parseTerm(tokens, pos);
  if (left === null) return null;
  while (pos.i < tokens.length && (tokens[pos.i] === '+' || tokens[pos.i] === '-')) {
    const op = tokens[pos.i++];
    const right = parseTerm(tokens, pos);
    if (right === null) return null;
    left = op === '+' ? left + right : left - right;
  }
  return left;
}

// term → unary (('*' | '/') unary)*
function parseTerm(tokens, pos) {
  let left = parseUnary(tokens, pos);
  if (left === null) return null;
  while (pos.i < tokens.length && (tokens[pos.i] === '*' || tokens[pos.i] === '/')) {
    const op = tokens[pos.i++];
    const right = parseUnary(tokens, pos);
    if (right === null) return null;
    left = op === '*' ? left * right : right === 0 ? null : left / right;
  }
  return left;
}

// unary → '-' atom | atom
function parseUnary(tokens, pos) {
  if (tokens[pos.i] === '-') { pos.i++; const v = parseAtom(tokens, pos); return v === null ? null : -v; }
  return parseAtom(tokens, pos);
}

// atom → '(' expr ')' | number
function parseAtom(tokens, pos) {
  if (tokens[pos.i] === '(') {
    pos.i++;
    const val = parseExpr(tokens, pos);
    if (tokens[pos.i] !== ')') return null;
    pos.i++;
    return val;
  }
  const tok = tokens[pos.i++];
  if (tok === undefined || !/^-?\d*\.?\d+$/.test(tok)) return null;
  return Number(tok);
}

const FIELD_RE = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

/**
 * Safely evaluate a computed-column expression against a data row.
 * @param {string} expression  e.g. "precio * cantidad" or "(ventas - costos) / ventas"
 * @param {Record<string,unknown>} row  source row values
 * @returns {number|null}  computed value, or null on any error
 */
function evalExpression(expression, row) {
  if (typeof expression !== 'string' || expression.length > 500) return null;

  // Substitute known field names with their numeric values.
  const substituted = expression.replace(FIELD_RE, (_, field) => {
    const val = row[field];
    if (val === undefined || val === null || val === '') return '0';
    const num = Number(val);
    return isNaN(num) ? '0' : String(num);
  });

  // After substitution, reject anything that isn't a safe arithmetic expression.
  if (/[a-zA-Z_]/.test(substituted)) return null;

  const tokens = tokenize(substituted);
  if (!tokens) return null;

  const pos = { i: 0 };
  const result = parseExpr(tokens, pos);
  if (pos.i !== tokens.length) return null; // unconsumed tokens = malformed
  return result;
}

module.exports = { evalExpression };
