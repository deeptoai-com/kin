/**
 * Extract variable names from a template string.
 *
 * Supports two syntaxes:
 * 1. Simple: {{variable}}
 * 2. Conditional: {{variable==value ? "yes" : "no"}}
 *
 * For conditional expressions, only the variable name (before ==) is extracted.
 */
export const extractVariables = (template: string): string[] => {
  const variables = new Set<string>();
  const regex = /\{\{\s*([^}]+?)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    // Check for conditional expression: variable==value ? ... : ...
    // Pattern: identifier (optionally with ==, !=, ===, !==) followed by ? and :
    const conditionalMatch = raw.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:===?|!==?)/);
    if (conditionalMatch) {
      // Extract only the variable name from conditional expression
      variables.add(conditionalMatch[1]);
    } else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw)) {
      // Simple variable name (valid identifier)
      variables.add(raw);
    }
    // Ignore complex expressions that don't match either pattern
  }
  return Array.from(variables);
};

/**
 * Apply template substitution.
 *
 * Supports two syntaxes:
 * 1. Simple: {{variable}} -> replaced with values[variable]
 * 2. Conditional: {{variable==value ? "yes" : "no"}} -> evaluates condition
 *
 * For conditionals:
 * - Supports ==, !=, ===, !== operators
 * - Values can be: true, false, quoted strings, or identifiers
 * - If variable value matches, returns the "yes" branch, otherwise "no" branch
 */
export const applyTemplate = (
  template: string,
  values: Record<string, string | boolean>
): string => {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (full, key) => {
    const raw = String(key ?? '').trim();

    // Check for conditional expression
    // Pattern: variable (==|!=|===|!==) value ? "trueResult" : "falseResult"
    const conditionalMatch = raw.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(===?|!==?)\s*(.+?)\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"$/
    );

    if (conditionalMatch) {
      const [, varName, operator, compareValue, trueResult, falseResult] = conditionalMatch;
      const actualValue = values[varName];

      // Parse the compare value
      let parsedCompare: string | boolean = compareValue.trim();
      if (parsedCompare === 'true') {
        parsedCompare = true;
      } else if (parsedCompare === 'false') {
        parsedCompare = false;
      } else if (parsedCompare.startsWith('"') && parsedCompare.endsWith('"')) {
        parsedCompare = parsedCompare.slice(1, -1);
      }

      // Evaluate the condition
      let conditionMet = false;
      if (operator === '==' || operator === '===') {
        conditionMet = actualValue === parsedCompare || String(actualValue) === String(parsedCompare);
      } else if (operator === '!=' || operator === '!==') {
        conditionMet = actualValue !== parsedCompare && String(actualValue) !== String(parsedCompare);
      }

      return conditionMet ? trueResult : falseResult;
    }

    // Simple variable substitution
    const value = values[raw];
    if (value === undefined || value === null) {
      return full; // Keep original if no value
    }
    return String(value);
  });
};
