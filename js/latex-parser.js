/**
 * LaTeX to GLSL Compiler
 *
 * Converts mathematical equations written in LaTeX into valid GLSL expressions.
 * Exposes window.latexToGLSL(latexString) returning a GLSL expression, any helper
 * function definitions required by it, and a parse error if compilation fails.
 *
 * Supports:
 * - Functions: trig, inverse trig, hyperbolic, exp, log (natural, base 10, base n),
 *   sqrt / nth root, abs, floor, ceil, gcd, lcm, mod, sign, min, max.
 * - Operators: +, -, *, /, powers, fractions, subscripts, absolute values, equals.
 * - Implicit multiplication between adjacent tokens.
 * - Finite summations with scoped indices and nested or expression bounds.
 * - Auto-formatting all numbers as GLSL floats (e.g. 2 -> 2.0).
 * - Equations split as LHS - RHS: "((LHS) - (RHS))", or single expression if no '='.
 */

(function (global) {
  'use strict';

  // Mathematical Constants
  const PI_VAL = '3.14159265359';
  const E_VAL = '2.71828182846';
  const TAU_VAL = '6.28318530718';

  /**
   * Formats a raw number string or number into a valid GLSL float literal.
   * E.g. "2" -> "2.0", "1.5" -> "1.5", ".5" -> "0.5", "10" -> "10.0".
   * @param {string|number} raw
   * @returns {string}
   */
  function toGLSLFloat(raw) {
    let s = String(raw).trim();
    if (s.startsWith('.')) s = '0' + s;
    if (s.endsWith('.')) s = s + '0';
    const eIdx = s.search(/[eE]/);
    if (eIdx !== -1) {
      const mantissa = s.slice(0, eIdx);
      const exp = s.slice(eIdx);
      if (!mantissa.includes('.')) {
        s = mantissa + '.0' + exp;
      }
    } else if (!s.includes('.')) {
      s = s + '.0';
    }
    return s;
  }

  // =========================================================================
  // Tokenizer
  // =========================================================================

  /**
   * Scans a LaTeX string and produces a stream of tokens.
   * @param {string} rawLatex
   * @returns {Array<Object>} tokens
   */
  function tokenize(rawLatex) {
    // Strip LaTeX comments (% to end of line)
    const latex = rawLatex.replace(/%[^\r\n]*/g, '');
    const tokens = [];
    let i = 0;
    const n = latex.length;

    while (i < n) {
      const c = latex[i];

      // Skip whitespace
      if (/\s/.test(c)) {
        i++;
        continue;
      }

      // Skip LaTeX non-breaking space
      if (c === '~') {
        i++;
        continue;
      }

      // LaTeX command starting with '\'
      if (c === '\\') {
        i++;
        if (i >= n) break;

        // Spacing commands: \, \: \; \! \ 
        if (latex[i] === ',' || latex[i] === ':' || latex[i] === ';' || latex[i] === '!' || latex[i] === ' ') {
          i++;
          continue;
        }

        // Escaped delimiters
        if (latex[i] === '{') {
          tokens.push({ type: 'LBRACE', value: '{', pos: i - 1 });
          i++;
          continue;
        }
        if (latex[i] === '}') {
          tokens.push({ type: 'RBRACE', value: '}', pos: i - 1 });
          i++;
          continue;
        }
        if (latex[i] === '|') {
          tokens.push({ type: 'PIPE', value: '|', pos: i - 1 });
          i++;
          continue;
        }

        // Read command identifier
        const start = i;
        while (i < n && /[a-zA-Z]/.test(latex[i])) {
          i++;
        }
        const cmd = latex.substring(start, i);

        // Visual delimiters: \left, \right, \middle
        if (cmd === 'left' || cmd === 'right' || cmd === 'middle') {
          while (i < n && /\s/.test(latex[i])) i++;
          if (i < n && latex[i] === '.') {
            i++; // consume invisible delimiter '.'
          }
          continue;
        }

        // \operatorname{...} or \operatorname*{...}
        if (cmd === 'operatorname') {
          while (i < n && /\s/.test(latex[i])) i++;
          if (i < n && latex[i] === '*') i++;
          while (i < n && /\s/.test(latex[i])) i++;
          let opName = '';
          if (i < n && latex[i] === '{') {
            i++;
            const opStart = i;
            while (i < n && latex[i] !== '}') i++;
            opName = latex.substring(opStart, i).trim();
            if (i < n && latex[i] === '}') i++;
          } else {
            const opStart = i;
            while (i < n && /[a-zA-Z]/.test(latex[i])) i++;
            opName = latex.substring(opStart, i);
          }
          const norm = opName.toLowerCase();
          if (norm === 'mod') tokens.push({ type: 'FUNC', value: 'mod', pos: start });
          else if (norm === 'gcd') tokens.push({ type: 'FUNC', value: 'gcd', pos: start });
          else if (norm === 'lcm') tokens.push({ type: 'FUNC', value: 'lcm', pos: start });
          else if (norm === 'sign' || norm === 'sgn') tokens.push({ type: 'FUNC', value: 'sign', pos: start });
          else if (norm === 'min') tokens.push({ type: 'FUNC', value: 'min', pos: start });
          else if (norm === 'max') tokens.push({ type: 'FUNC', value: 'max', pos: start });
          else if (norm === 'floor') tokens.push({ type: 'FUNC', value: 'floor', pos: start });
          else if (norm === 'ceil') tokens.push({ type: 'FUNC', value: 'ceil', pos: start });
          else if (norm === 'abs') tokens.push({ type: 'FUNC', value: 'abs', pos: start });
          else if (norm === 'round') tokens.push({ type: 'FUNC', value: 'round', pos: start });
          else if (norm === 'clamp') tokens.push({ type: 'FUNC', value: 'clamp', pos: start });
          else if (norm) tokens.push({ type: 'FUNC', value: norm, pos: start });
          continue;
        }

        // Styling / sizing commands: skip them, leave their braces/contents intact
        if (['mathrm', 'mathbf', 'mathit', 'text', 'textbf', 'textit', 'bm', 'boldsymbol', 'displaystyle', 'textstyle'].includes(cmd)) {
          continue;
        }

        // Known LaTeX commands
        switch (cmd) {
          // Trig
          case 'sin':
          case 'cos':
          case 'tan':
          case 'sec':
          case 'csc':
          case 'cot':
            tokens.push({ type: 'FUNC', value: cmd, pos: start });
            break;
          case 'arcsin':
          case 'asin':
            tokens.push({ type: 'FUNC', value: 'arcsin', pos: start });
            break;
          case 'arccos':
          case 'acos':
            tokens.push({ type: 'FUNC', value: 'arccos', pos: start });
            break;
          case 'arctan':
          case 'atan':
            tokens.push({ type: 'FUNC', value: 'arctan', pos: start });
            break;

          // Hyperbolic
          case 'sinh':
          case 'cosh':
          case 'tanh':
          case 'sech':
          case 'csch':
          case 'coth':
            tokens.push({ type: 'FUNC', value: cmd, pos: start });
            break;
          case 'arsinh':
          case 'asinh':
            tokens.push({ type: 'FUNC', value: 'arsinh', pos: start });
            break;
          case 'arcosh':
          case 'acosh':
            tokens.push({ type: 'FUNC', value: 'arcosh', pos: start });
            break;
          case 'artanh':
          case 'atanh':
            tokens.push({ type: 'FUNC', value: 'artanh', pos: start });
            break;

          // Exp & Log
          case 'exp':
            tokens.push({ type: 'FUNC', value: 'exp', pos: start });
            break;
          case 'ln':
            tokens.push({ type: 'LN', value: 'ln', pos: start });
            break;
          case 'log':
            tokens.push({ type: 'LOG', value: 'log', pos: start });
            break;

          // Roots
          case 'sqrt':
            tokens.push({ type: 'SQRT', value: 'sqrt', pos: start });
            break;

          // Fractions
          case 'frac':
          case 'dfrac':
          case 'tfrac':
            tokens.push({ type: 'FRAC', value: 'frac', pos: start });
            break;

          // Absolute & Rounding
          case 'abs':
            tokens.push({ type: 'FUNC', value: 'abs', pos: start });
            break;
          case 'floor':
            tokens.push({ type: 'FUNC', value: 'floor', pos: start });
            break;
          case 'ceil':
            tokens.push({ type: 'FUNC', value: 'ceil', pos: start });
            break;
          case 'lfloor':
            tokens.push({ type: 'LFLOOR', value: 'lfloor', pos: start });
            break;
          case 'rfloor':
            tokens.push({ type: 'RFLOOR', value: 'rfloor', pos: start });
            break;
          case 'lceil':
            tokens.push({ type: 'LCEIL', value: 'lceil', pos: start });
            break;
          case 'rceil':
            tokens.push({ type: 'RCEIL', value: 'rceil', pos: start });
            break;

          // Delimiters
          case 'vert':
          case 'lvert':
          case 'rvert':
            tokens.push({ type: 'PIPE', value: '|', pos: start });
            break;

          // Math functions
          case 'gcd':
            tokens.push({ type: 'FUNC', value: 'gcd', pos: start });
            break;
          case 'lcm':
            tokens.push({ type: 'FUNC', value: 'lcm', pos: start });
            break;
          case 'mod':
          case 'bmod':
          case 'pmod':
            tokens.push({ type: 'FUNC', value: 'mod', pos: start });
            break;
          case 'sign':
          case 'sgn':
            tokens.push({ type: 'FUNC', value: 'sign', pos: start });
            break;
          case 'min':
            tokens.push({ type: 'FUNC', value: 'min', pos: start });
            break;
          case 'max':
            tokens.push({ type: 'FUNC', value: 'max', pos: start });
            break;
          case 'round':
            tokens.push({ type: 'FUNC', value: 'round', pos: start });
            break;
          case 'clamp':
            tokens.push({ type: 'FUNC', value: 'clamp', pos: start });
            break;

          // Constants
          case 'pi':
          case 'Pi':
            tokens.push({ type: 'CONST', value: PI_VAL, pos: start });
            break;
          case 'tau':
            tokens.push({ type: 'CONST', value: TAU_VAL, pos: start });
            break;

          // Operators
          case 'sum':
            tokens.push({ type: 'SUM', value: 'sum', pos: start });
            break;
          case 'limits':
          case 'nolimits':
            break;
          case 'cdot':
          case 'times':
          case 'ast':
            tokens.push({ type: 'TIMES', value: '*', pos: start });
            break;
          case 'div':
            tokens.push({ type: 'DIV', value: '/', pos: start });
            break;

          // Greek letters / coordinates
          case 'alpha':
          case 'beta':
          case 'gamma':
          case 'delta':
          case 'theta':
          case 'phi':
          case 'psi':
          case 'omega':
          case 'lambda':
          case 'mu':
            tokens.push({ type: 'VAR', value: cmd, pos: start });
            break;

          default:
            // Unknown LaTeX command: skip with warning, do not cause hard error
            if (typeof console !== 'undefined' && console.warn) {
              console.warn(`[latexToGLSL] Ignored unknown LaTeX command: \\${cmd}`);
            }
            break;
        }
        continue;
      }

      // Numbers: digits or leading decimal dot followed by digit
      if (/[0-9]/.test(c) || (c === '.' && i + 1 < n && /[0-9]/.test(latex[i + 1]))) {
        const start = i;
        let hasDot = (c === '.');
        i++;
        while (i < n && /[0-9]/.test(latex[i])) i++;
        if (!hasDot && i < n && latex[i] === '.') {
          hasDot = true;
          i++;
          while (i < n && /[0-9]/.test(latex[i])) i++;
        }
        // Scientific notation: e.g. 1e-5 or 2e4
        if (i < n && (latex[i] === 'e' || latex[i] === 'E')) {
          let eNext = i + 1;
          if (eNext < n && (latex[eNext] === '+' || latex[eNext] === '-')) {
            eNext++;
          }
          if (eNext < n && /[0-9]/.test(latex[eNext])) {
            i = eNext;
            while (i < n && /[0-9]/.test(latex[i])) i++;
          }
        }
        const numStr = latex.substring(start, i);
        tokens.push({ type: 'NUMBER', value: numStr, pos: start });
        continue;
      }

      // Identifiers / Variables / Functions without backslash
      if (/[a-zA-Z]/.test(c)) {
        const start = i;
        const sub = latex.substring(start);
        const knownFuncs = [
          'arcsin', 'arccos', 'arctan', 'asin', 'acos', 'atan',
          'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
          'arsinh', 'arcosh', 'artanh', 'asinh', 'acosh', 'atanh',
          'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
          'sqrt', 'floor', 'ceil', 'round', 'clamp',
          'sign', 'sgn', 'gcd', 'lcm', 'mod', 'min', 'max',
          'exp', 'log', 'ln', 'abs', 'pi', 'tau'
        ];
        let matchedFunc = null;
        for (const fn of knownFuncs) {
          if (sub.toLowerCase().startsWith(fn)) {
            const nextChar = sub[fn.length];
            if (!nextChar || !/[a-zA-Z]/.test(nextChar)) {
              matchedFunc = fn;
              break;
            }
          }
        }

        if (matchedFunc) {
          i += matchedFunc.length;
          const fnLower = matchedFunc.toLowerCase();
          if (fnLower === 'ln') tokens.push({ type: 'LN', value: 'ln', pos: start });
          else if (fnLower === 'log') tokens.push({ type: 'LOG', value: 'log', pos: start });
          else if (fnLower === 'sqrt') tokens.push({ type: 'SQRT', value: 'sqrt', pos: start });
          else if (fnLower === 'pi') tokens.push({ type: 'CONST', value: PI_VAL, pos: start });
          else if (fnLower === 'tau') tokens.push({ type: 'CONST', value: TAU_VAL, pos: start });
          else tokens.push({ type: 'FUNC', value: fnLower, pos: start });
          continue;
        }

        // Standalone 'e' or 'E'
        if (c === 'e' || c === 'E') {
          tokens.push({ type: 'CONST', value: E_VAL, pos: start });
          i++;
          continue;
        }

        // Single letter variable: x, y, z, etc.
        tokens.push({ type: 'VAR', value: c, pos: start });
        i++;
        continue;
      }

      // Operators and punctuation
      switch (c) {
        case '+':
          tokens.push({ type: 'PLUS', value: '+', pos: i });
          break;
        case '-':
          tokens.push({ type: 'MINUS', value: '-', pos: i });
          break;
        case '*':
          tokens.push({ type: 'TIMES', value: '*', pos: i });
          break;
        case '/':
          tokens.push({ type: 'DIV', value: '/', pos: i });
          break;
        case '^':
          tokens.push({ type: 'CARET', value: '^', pos: i });
          break;
        case '_':
          tokens.push({ type: 'UNDERSCORE', value: '_', pos: i });
          break;
        case '(':
          tokens.push({ type: 'LPAREN', value: '(', pos: i });
          break;
        case ')':
          tokens.push({ type: 'RPAREN', value: ')', pos: i });
          break;
        case '[':
          tokens.push({ type: 'LBRACKET', value: '[', pos: i });
          break;
        case ']':
          tokens.push({ type: 'RBRACKET', value: ']', pos: i });
          break;
        case '{':
          tokens.push({ type: 'LBRACE', value: '{', pos: i });
          break;
        case '}':
          tokens.push({ type: 'RBRACE', value: '}', pos: i });
          break;
        case '|':
          tokens.push({ type: 'PIPE', value: '|', pos: i });
          break;
        case ',':
          tokens.push({ type: 'COMMA', value: ',', pos: i });
          break;
        case '=':
          tokens.push({ type: 'EQUALS', value: '=', pos: i });
          break;
        default:
          // Skip unrecognized single characters
          break;
      }
      i++;
    }

    tokens.push({ type: 'EOF', value: '', pos: i });
    return tokens;
  }

  // =========================================================================
  // AST Node Definitions
  // =========================================================================

  class NumberNode {
    constructor(value) {
      this.type = 'Number';
      this.value = value;
    }
    toGLSL() {
      return toGLSLFloat(this.value);
    }
  }

  class VariableNode {
    constructor(name) {
      this.type = 'Variable';
      this.name = name;
    }
    toGLSL(context) {
      return context?.bindings.get(this.name) ?? this.name;
    }
  }

  class ConstantNode {
    constructor(value) {
      this.type = 'Constant';
      this.value = value;
    }
    toGLSL() {
      return this.value;
    }
  }

  class ParenNode {
    constructor(expr) {
      this.type = 'Paren';
      this.expr = expr;
    }
    toGLSL(context) {
      return `(${this.expr.toGLSL(context)})`;
    }
  }

  class AbsNode {
    constructor(expr) {
      this.type = 'Abs';
      this.expr = expr;
    }
    toGLSL(context) {
      return `abs(${this.expr.toGLSL(context)})`;
    }
  }

  class UnaryMinusNode {
    constructor(expr) {
      this.type = 'UnaryMinus';
      this.expr = expr;
    }
    toGLSL(context) {
      if (this.expr.type === 'Number') {
        return `-${toGLSLFloat(this.expr.value)}`;
      }
      if (this.expr.type === 'Paren') {
        return `-${this.expr.toGLSL(context)}`;
      }
      return `(-${this.expr.toGLSL(context)})`;
    }
  }

  class FracNode {
    constructor(num, den) {
      this.type = 'Frac';
      this.num = num;
      this.den = den;
    }
    toGLSL(context) {
      const numStr = (this.num.type === 'ExpressionChain') ? `(${this.num.toGLSL(context)})` : this.num.toGLSL(context);
      const denStr = (this.den.type === 'ExpressionChain') ? `(${this.den.toGLSL(context)})` : this.den.toGLSL(context);
      return `(${numStr} / ${denStr})`;
    }
  }

  class SqrtNode {
    constructor(arg, degree = null) {
      this.type = 'Sqrt';
      this.arg = arg;
      this.degree = degree;
    }
    toGLSL(context) {
      const argStr = this.arg.toGLSL(context);
      if (this.degree === null) {
        return `sqrt(${argStr})`;
      }
      const degStr = this.degree.toGLSL(context);
      if (this.degree.type === 'Number' || this.degree.type === 'Variable') {
        return `pow(${argStr}, (1.0 / ${degStr}))`;
      }
      return `pow(${argStr}, (1.0 / (${degStr})))`;
    }
  }

  class LogNode {
    constructor(arg, base = null, power = null) {
      this.type = 'Log';
      this.arg = arg;
      this.base = base;
      this.power = power;
    }
    toGLSL(context) {
      const argStr = this.arg.toGLSL(context);
      let res;
      if (this.base === null) {
        // Base 10 log
        res = `(log(${argStr}) / log(10.0))`;
      } else {
        // Base n log
        const baseStr = this.base.toGLSL(context);
        res = `(log(${argStr}) / log(${baseStr}))`;
      }
      if (this.power !== null) {
        res = `pow(${res}, ${this.power.toGLSL(context)})`;
      }
      return res;
    }
  }

  class FunctionCallNode {
    constructor(name, args, power = null) {
      this.type = 'FunctionCall';
      this.name = name;
      this.args = args;
      this.power = power;
    }
    toGLSL(context) {
      const name = this.name.toLowerCase();
      let callStr;

      // Special GLSL function names
      if (name === 'gcd') {
        const a = this.args[0] ? this.args[0].toGLSL(context) : '0.0';
        const b = this.args[1] ? this.args[1].toGLSL(context) : '0.0';
        callStr = `gcdFunc(${a}, ${b})`;
      } else if (name === 'lcm') {
        const a = this.args[0] ? this.args[0].toGLSL(context) : '0.0';
        const b = this.args[1] ? this.args[1].toGLSL(context) : '0.0';
        callStr = `lcmFunc(${a}, ${b})`;
      } else if (name === 'mod') {
        const a = this.args[0] ? this.args[0].toGLSL(context) : '0.0';
        const b = this.args[1] ? this.args[1].toGLSL(context) : '0.0';
        callStr = `modFunc(${a}, ${b})`;
      } else if (name === 'ln') {
        const a = this.args[0] ? this.args[0].toGLSL(context) : '0.0';
        callStr = `log(${a})`;
      } else if (name === 'arcsin' || name === 'asin') {
        const a = this.args[0] ? this.args[0].toGLSL(context) : '0.0';
        callStr = `asin(${a})`;
      } else if (name === 'arccos' || name === 'acos') {
        const a = this.args[0] ? this.args[0].toGLSL(context) : '0.0';
        callStr = `acos(${a})`;
      } else if (name === 'arctan' || name === 'atan') {
        const a = this.args[0] ? this.args[0].toGLSL(context) : '0.0';
        if (this.args.length > 1) {
          const b = this.args[1].toGLSL(context);
          callStr = `atan(${a}, ${b})`;
        } else {
          callStr = `atan(${a})`;
        }
      } else if (name === 'sign' || name === 'sgn') {
        const a = this.args[0] ? this.args[0].toGLSL(context) : '0.0';
        callStr = `sign(${a})`;
      } else {
        // Standard function
        const glslName = name;
        const argsStr = this.args.map(arg => arg.toGLSL(context)).join(', ');
        callStr = `${glslName}(${argsStr})`;
      }

      if (this.power !== null) {
        callStr = `pow(${callStr}, ${this.power.toGLSL(context)})`;
      }
      return callStr;
    }
  }

  class PowerNode {
    constructor(base, exp) {
      this.type = 'Power';
      this.base = base;
      this.exp = exp;
    }
    toGLSL(context) {
      let baseStr = this.base.toGLSL(context);
      if (this.base.type === 'TermChain' || this.base.type === 'ExpressionChain') {
        baseStr = `(${baseStr})`;
      }

      let expStr = this.exp.toGLSL(context);
      if (this.exp.type === 'TermChain' || this.exp.type === 'ExpressionChain') {
        expStr = `(${expStr})`;
      }

      return `pow(${baseStr}, ${expStr})`;
    }
  }

  class TermChainNode {
    constructor(factors) {
      this.type = 'TermChain';
      this.factors = factors; // [{ op: null|'*'|'/', factor: Node }]
    }
    toGLSL(context) {
      if (this.factors.length === 1) {
        return this.factors[0].factor.toGLSL(context);
      }
      let s = this.factors[0].factor.toGLSL(context);
      for (let i = 1; i < this.factors.length; i++) {
        const op = this.factors[i].op || '*';
        s += ` ${op} ${this.factors[i].factor.toGLSL(context)}`;
      }
      return s;
    }
  }

  class ExpressionChainNode {
    constructor(terms) {
      this.type = 'ExpressionChain';
      this.terms = terms; // [{ op: null|'+'|'-', term: Node }]
    }
    toGLSL(context) {
      if (this.terms.length === 1) {
        return this.terms[0].term.toGLSL(context);
      }
      let s = this.terms[0].term.toGLSL(context);
      for (let i = 1; i < this.terms.length; i++) {
        const op = this.terms[i].op || '+';
        s += ` ${op} ${this.terms[i].term.toGLSL(context)}`;
      }
      return s;
    }
  }

  class EquationNode {
    constructor(lhs, rhs = null) {
      this.type = 'Equation';
      this.lhs = lhs;
      this.rhs = rhs;
    }
    toGLSL(context) {
      const lhsGLSL = this.lhs.toGLSL(context);
      if (this.rhs === null) {
        return lhsGLSL;
      }
      const rhsGLSL = this.rhs.toGLSL(context);
      return `((${lhsGLSL}) - (${rhsGLSL}))`;
    }
  }

  class SumNode {
    constructor(index, lower, upper, body) {
      this.index = index;
      this.lower = lower;
      this.upper = upper;
      this.body = body;
    }

    toGLSL(context) {
      const id = context.nextSum.value++;
      const name = `latexSum${id}`;
      const index = `sumIndex${id}`;
      const parameters = ['x', 'y', 'z', ...context.bindings.values()];
      const lower = this.lower.toGLSL(context);
      const upper = this.upper.toGLSL(context);

      const bindings = new Map(context.bindings);
      bindings.set(this.index, index);
      const body = this.body.toGLSL({ ...context, bindings });
      // Emit inner helpers first so their definitions precede their callers.
      context.helpers.push(`float ${name}(${parameters.map(param => `float ${param}`).join(', ')}) {
    float first = ceil(${lower});
    float last = floor(${upper});
    if (isnan(first) || isnan(last) || isinf(first) || isinf(last)) {
        return uintBitsToFloat(0x7fc00000u);
    }
    if (first > last) return 0.0;
    // Every integer in this interval can be represented by a highp float.
    if (first < -16777216.0 || last > 16777216.0) {
        return uintBitsToFloat(0x7fc00000u);
    }
    float total = 0.0;
    for (float ${index} = first; ${index} <= last; ${index} += 1.0) {
        total += ${body};
        if (${index} == last) break;
    }
    return total;
}`);
      return `${name}(${parameters.join(', ')})`;
    }
  }

  // =========================================================================
  // Recursive Descent Parser
  // =========================================================================

  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.pos = 0;
      this.pipeDepth = 0;
    }

    peek() {
      return this.tokens[this.pos] || { type: 'EOF', value: '' };
    }

    consume(expectedType) {
      const token = this.peek();
      if (token.type === expectedType) {
        this.pos++;
        return token;
      }
      // Permissive: auto-close delimiters at EOF
      if (token.type === 'EOF') {
        if (expectedType === 'RPAREN' || expectedType === 'RBRACKET' ||
            expectedType === 'RBRACE' || expectedType === 'PIPE' ||
            expectedType === 'RFLOOR' || expectedType === 'RCEIL') {
          return { type: expectedType, value: '' };
        }
      }
      throw new Error(`Expected '${expectedType}' but found '${token.type}' at position ${token.pos || this.pos}`);
    }

    match(...types) {
      const token = this.peek();
      if (types.includes(token.type)) {
        this.pos++;
        return token;
      }
      return null;
    }

    canStartImplicitFactor() {
      const token = this.peek();
      if (!token || token.type === 'EOF') return false;

      // Inside an absolute value, PIPE closes the abs, so it does not start a new factor
      if (token.type === 'PIPE' && this.pipeDepth > 0) {
        return false;
      }

      switch (token.type) {
        case 'NUMBER':
        case 'VAR':
        case 'CONST':
        case 'FUNC':
        case 'LOG':
        case 'LN':
        case 'SUM':
        case 'FRAC':
        case 'SQRT':
        case 'LPAREN':
        case 'LBRACKET':
        case 'LBRACE':
        case 'PIPE':
        case 'LFLOOR':
        case 'LCEIL':
          return true;
        default:
          return false;
      }
    }

    // equation := expression (EQUALS expression)?
    parseEquation() {
      const lhs = this.parseExpression();
      if (this.match('EQUALS')) {
        // If RHS is empty, treat as 0
        if (this.peek().type === 'EOF') {
          return new EquationNode(lhs, new NumberNode('0'));
        }
        const rhs = this.parseExpression();
        return new EquationNode(lhs, rhs);
      }
      return new EquationNode(lhs, null);
    }

    // expression := term (('+' | '-') term)*
    parseExpression() {
      const firstTerm = this.parseTerm();
      const terms = [{ op: null, term: firstTerm }];

      while (true) {
        const opToken = this.match('PLUS', 'MINUS');
        if (!opToken) break;
        const nextTerm = this.parseTerm();
        terms.push({ op: opToken.value, term: nextTerm });
      }

      if (terms.length === 1) {
        return firstTerm;
      }
      return new ExpressionChainNode(terms);
    }

    // term := factor (('*' | '/' | implicit) factor)*
    parseTerm() {
      const firstFactor = this.parseFactor();
      const factors = [{ op: null, factor: firstFactor }];

      while (true) {
        const opToken = this.match('TIMES', 'DIV');
        if (opToken) {
          const nextFactor = this.parseFactor();
          factors.push({ op: opToken.value, factor: nextFactor });
        } else if (this.canStartImplicitFactor()) {
          const nextFactor = this.parseFactor();
          factors.push({ op: '*', factor: nextFactor });
        } else {
          break;
        }
      }

      if (factors.length === 1) {
        return firstFactor;
      }
      return new TermChainNode(factors);
    }

    // factor := ('+' | '-')* power
    parseFactor() {
      if (this.match('PLUS')) {
        return this.parseFactor(); // unary plus is a no-op
      }
      if (this.match('MINUS')) {
        const operand = this.parseFactor();
        return new UnaryMinusNode(operand);
      }
      return this.parsePower();
    }

    // power := postfix (CARET (LBRACE expression RBRACE | factor))?
    parsePower() {
      const base = this.parsePostfix();

      if (this.match('CARET')) {
        let exp;
        if (this.match('LBRACE')) {
          exp = this.parseExpression();
          this.consume('RBRACE');
        } else {
          exp = this.parseFactor(); // right-associative power
        }
        return new PowerNode(base, exp);
      }

      return base;
    }

    // postfix := atom
    parsePostfix() {
      return this.parseAtom();
    }

    // atom := NUMBER | VAR | CONST | FUNC | LOG | LN | SQRT | FRAC | SUM | LPAREN | LBRACKET | LBRACE | PIPE | LFLOOR | LCEIL
    parseAtom() {
      const token = this.peek();

      if (this.match('SUM')) {
        return this.parseSum();
      }

      // Number literal
      if (this.match('NUMBER')) {
        return new NumberNode(token.value);
      }

      // Variable (supports subscripts like x_1 or x_{1})
      if (this.match('VAR')) {
        let varName = token.value;
        if (this.match('UNDERSCORE')) {
          let subStr = '';
          if (this.match('LBRACE')) {
            const subExpr = this.parseExpression();
            this.consume('RBRACE');
            subStr = subExpr.toGLSL();
          } else {
            const subAtom = this.parseAtom();
            subStr = subAtom.toGLSL();
          }
          // Clean subscript for GLSL identifier
          subStr = subStr.replace(/[^a-zA-Z0-9_]/g, '');
          varName = `${varName}_${subStr}`;
        }
        return new VariableNode(varName);
      }

      // Constant: \pi, e, \tau
      if (this.match('CONST')) {
        return new ConstantNode(token.value);
      }

      // Parentheses: ( expr )
      if (this.match('LPAREN')) {
        const expr = this.parseExpression();
        this.consume('RPAREN');
        return new ParenNode(expr);
      }

      // Square brackets: [ expr ]
      if (this.match('LBRACKET')) {
        const expr = this.parseExpression();
        this.consume('RBRACKET');
        return new ParenNode(expr);
      }

      // Grouping braces: { expr }
      if (this.match('LBRACE')) {
        const expr = this.parseExpression();
        this.consume('RBRACE');
        return expr;
      }

      // Absolute value: | expr |
      if (this.match('PIPE')) {
        this.pipeDepth++;
        const expr = this.parseExpression();
        this.consume('PIPE');
        this.pipeDepth--;
        return new AbsNode(expr);
      }

      // Floor: \lfloor expr \rfloor
      if (this.match('LFLOOR')) {
        const expr = this.parseExpression();
        this.consume('RFLOOR');
        return new FunctionCallNode('floor', [expr]);
      }

      // Ceil: \lceil expr \rceil
      if (this.match('LCEIL')) {
        const expr = this.parseExpression();
        this.consume('RCEIL');
        return new FunctionCallNode('ceil', [expr]);
      }

      // Fraction: \frac{num}{den}
      if (this.match('FRAC')) {
        let num;
        if (this.match('LBRACE')) {
          num = this.parseExpression();
          this.consume('RBRACE');
        } else {
          num = this.parseAtom();
        }

        let den;
        if (this.match('LBRACE')) {
          den = this.parseExpression();
          this.consume('RBRACE');
        } else {
          den = this.parseAtom();
        }

        return new FracNode(num, den);
      }

      // Square root: \sqrt{x} or \sqrt[n]{x}
      if (this.match('SQRT')) {
        let degree = null;
        if (this.match('LBRACKET')) {
          degree = this.parseExpression();
          this.consume('RBRACKET');
        }

        let arg;
        if (this.match('LBRACE')) {
          arg = this.parseExpression();
          this.consume('RBRACE');
        } else if (this.match('LPAREN')) {
          arg = this.parseExpression();
          this.consume('RPAREN');
        } else {
          arg = this.parseAtom();
        }

        return new SqrtNode(arg, degree);
      }

      // Log: \log or \log_{b}(x) or \log^{p}(x)
      if (this.match('LOG')) {
        let base = null;
        let power = null;

        // Check for base subscript _b
        if (this.match('UNDERSCORE')) {
          if (this.match('LBRACE')) {
            base = this.parseExpression();
            this.consume('RBRACE');
          } else {
            base = this.parseAtom();
          }
        }

        // Check for power exponent ^p
        if (this.match('CARET')) {
          if (this.match('LBRACE')) {
            power = this.parseExpression();
            this.consume('RBRACE');
          } else {
            power = this.parseFactor();
          }
        }

        // Parse log argument
        const args = this.parseFunctionArgs();
        return new LogNode(args[0], base, power);
      }

      // Natural log: \ln(x)
      if (this.match('LN')) {
        let power = null;
        if (this.match('CARET')) {
          if (this.match('LBRACE')) {
            power = this.parseExpression();
            this.consume('RBRACE');
          } else {
            power = this.parseFactor();
          }
        }
        const args = this.parseFunctionArgs();
        return new FunctionCallNode('ln', args, power);
      }

      // General function application: \sin, \cos, \gcd, \mod, etc.
      if (this.match('FUNC')) {
        const fnName = token.value;
        let power = null;

        // Check for attached power: e.g. \sin^2(x) or \cos^{2}(x)
        if (this.match('CARET')) {
          if (this.match('LBRACE')) {
            power = this.parseExpression();
            this.consume('RBRACE');
          } else {
            power = this.parseFactor();
          }
        }

        const args = this.parseFunctionArgs();
        return new FunctionCallNode(fnName, args, power);
      }

      // If unexpected token at end or empty
      if (token.type === 'EOF') {
        throw new Error('Unexpected end of LaTeX expression');
      }

      throw new Error(`Unexpected token '${token.value || token.type}' at position ${token.pos || this.pos}`);
    }

    parseSum() {
      const upperFirst = this.match('CARET');
      const readUpper = () => {
        if (!this.match('LBRACE')) return this.parseAtom();
        const upper = this.parseExpression();
        this.consume('RBRACE');
        return upper;
      };
      let upper = upperFirst ? readUpper() : null;
      this.consume('UNDERSCORE');
      this.consume('LBRACE');
      const index = this.parseAtom();
      if (index.type !== 'Variable') {
        throw new Error('Expected a summation index variable');
      }
      this.consume('EQUALS');
      const lower = this.parseExpression();
      this.consume('RBRACE');
      if (!upperFirst) {
        this.consume('CARET');
        upper = readUpper();
      }

      // Products belong to the summand. Addition, equality, and closing
      // delimiters end it unless enclosed in a group inside the summand.
      return new SumNode(index.name, lower, upper, this.parseTerm());
    }

    /**
     * Parses arguments for a function:
     * - (arg1, arg2, ...)
     * - [arg1, arg2, ...]
     * - {arg}
     * - single atom (e.g. \sin x)
     */
    parseFunctionArgs() {
      if (this.match('LPAREN')) {
        const args = [this.parseExpression()];
        while (this.match('COMMA')) {
          args.push(this.parseExpression());
        }
        this.consume('RPAREN');
        return args;
      }

      if (this.match('LBRACKET')) {
        const args = [this.parseExpression()];
        while (this.match('COMMA')) {
          args.push(this.parseExpression());
        }
        this.consume('RBRACKET');
        return args;
      }

      if (this.match('LBRACE')) {
        const args = [this.parseExpression()];
        while (this.match('COMMA')) {
          args.push(this.parseExpression());
        }
        this.consume('RBRACE');
        return args;
      }

      // Single atom as argument
      const atom = this.parseAtom();
      return [atom];
    }
  }

  // =========================================================================
  // Public Compiler API
  // =========================================================================

  /**
   * Compiles a LaTeX mathematical equation into a GLSL expression.
   *
   * @param {string} latexString The equation string to compile.
   * @returns {{ glsl: string|null, helpers?: string, error: string|null }}
   */
  function latexToGLSL(latexString) {
    if (typeof latexString !== 'string') {
      return { glsl: null, error: 'Input must be a string' };
    }

    const trimmed = latexString.trim();
    if (trimmed.length === 0) {
      return { glsl: null, error: 'Empty LaTeX equation' };
    }

    try {
      const tokens = tokenize(trimmed);
      const parser = new Parser(tokens);
      const ast = parser.parseEquation();

      // Ensure no trailing tokens exist
      const remaining = parser.peek();
      if (remaining.type !== 'EOF') {
        throw new Error(`Unexpected token '${remaining.value || remaining.type}' at position ${remaining.pos}`);
      }

      const context = { bindings: new Map(), helpers: [], nextSum: { value: 0 } };
      const glsl = ast.toGLSL(context);
      const helpers = context.helpers.join('\n\n');
      return helpers ? { glsl, helpers, error: null } : { glsl, error: null };
    } catch (err) {
      return {
        glsl: null,
        error: err && err.message ? err.message : String(err)
      };
    }
  }

  // Export to global environment
  if (typeof window !== 'undefined') {
    window.latexToGLSL = latexToGLSL;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.latexToGLSL = latexToGLSL;
  }
  if (typeof root !== 'undefined') {
    root.latexToGLSL = latexToGLSL;
  }

  // CommonJS export for Node.js test environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { latexToGLSL };
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
