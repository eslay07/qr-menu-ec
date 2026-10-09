// Generated from src/ by build.mjs; do not edit.
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var constants_exports = {};
__export(constants_exports, {
  default: () => constants_default
});
module.exports = __toCommonJS(constants_exports);
const constants = {
  MAX_LENGTH: 1e4,
  // Digits
  CHAR_0: "0",
  /* 0 */
  CHAR_9: "9",
  /* 9 */
  // Alphabet chars.
  CHAR_UPPERCASE_A: "A",
  /* A */
  CHAR_LOWERCASE_A: "a",
  /* a */
  CHAR_UPPERCASE_Z: "Z",
  /* Z */
  CHAR_LOWERCASE_Z: "z",
  /* z */
  CHAR_LEFT_PARENTHESES: "(",
  /* ( */
  CHAR_RIGHT_PARENTHESES: ")",
  /* ) */
  CHAR_ASTERISK: "*",
  /* * */
  // Non-alphabetic chars.
  CHAR_AMPERSAND: "&",
  /* & */
  CHAR_AT: "@",
  /* @ */
  CHAR_BACKSLASH: "\\",
  /* \ */
  CHAR_BACKTICK: "`",
  /* ` */
  CHAR_CARRIAGE_RETURN: "\r",
  /* \r */
  CHAR_CIRCUMFLEX_ACCENT: "^",
  /* ^ */
  CHAR_COLON: ":",
  /* : */
  CHAR_COMMA: ",",
  /* , */
  CHAR_DOLLAR: "$",
  /* . */
  CHAR_DOT: ".",
  /* . */
  CHAR_DOUBLE_QUOTE: '"',
  /* " */
  CHAR_EQUAL: "=",
  /* = */
  CHAR_EXCLAMATION_MARK: "!",
  /* ! */
  CHAR_FORM_FEED: "\f",
  /* \f */
  CHAR_FORWARD_SLASH: "/",
  /* / */
  CHAR_HASH: "#",
  /* # */
  CHAR_HYPHEN_MINUS: "-",
  /* - */
  CHAR_LEFT_ANGLE_BRACKET: "<",
  /* < */
  CHAR_LEFT_CURLY_BRACE: "{",
  /* { */
  CHAR_LEFT_SQUARE_BRACKET: "[",
  /* [ */
  CHAR_LINE_FEED: "\n",
  /* \n */
  CHAR_NO_BREAK_SPACE: "\xA0",
  /* \u00A0 */
  CHAR_PERCENT: "%",
  /* % */
  CHAR_PLUS: "+",
  /* + */
  CHAR_QUESTION_MARK: "?",
  /* ? */
  CHAR_RIGHT_ANGLE_BRACKET: ">",
  /* > */
  CHAR_RIGHT_CURLY_BRACE: "}",
  /* } */
  CHAR_RIGHT_SQUARE_BRACKET: "]",
  /* ] */
  CHAR_SEMICOLON: ";",
  /* ; */
  CHAR_SINGLE_QUOTE: "'",
  /* ' */
  CHAR_SPACE: " ",
  /*   */
  CHAR_TAB: "	",
  /* \t */
  CHAR_UNDERSCORE: "_",
  /* _ */
  CHAR_VERTICAL_LINE: "|",
  /* | */
  CHAR_ZERO_WIDTH_NOBREAK_SPACE: "\uFEFF"
  /* \uFEFF */
};
var constants_default = constants;

module.exports = module.exports.default;
