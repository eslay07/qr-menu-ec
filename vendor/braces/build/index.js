// Generated from src/ by build.mjs; do not edit.
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_stringify = __toESM(require("./lib/stringify.js"), 1);
var import_compile = __toESM(require("./lib/compile.js"), 1);
var import_expand = __toESM(require("./lib/expand.js"), 1);
var import_parse = __toESM(require("./lib/parse.js"), 1);
const braces = (input, options = {}) => {
  let output = [];
  if (Array.isArray(input)) {
    for (const pattern of input) {
      const result = braces.create(pattern, options);
      if (Array.isArray(result)) {
        output.push(...result);
      } else {
        output.push(result);
      }
    }
  } else {
    output = [].concat(braces.create(input, options));
  }
  if (options && options.expand === true && options.nodupes === true) {
    output = [...new Set(output)];
  }
  return output;
};
braces.parse = (input, options = {}) => (0, import_parse.default)(input, options);
braces.stringify = (input, options = {}) => {
  if (typeof input === "string") {
    return (0, import_stringify.default)(braces.parse(input, options), options);
  }
  return (0, import_stringify.default)(input, options);
};
braces.compile = (input, options = {}) => {
  if (typeof input === "string") {
    input = braces.parse(input, options);
  }
  return (0, import_compile.default)(input, options);
};
braces.expand = (input, options = {}) => {
  if (typeof input === "string") {
    input = braces.parse(input, options);
  }
  let result = (0, import_expand.default)(input, options);
  if (options.noempty === true) {
    result = result.filter(Boolean);
  }
  if (options.nodupes === true) {
    result = [...new Set(result)];
  }
  return result;
};
braces.create = (input, options = {}) => {
  if (input === "" || input.length < 3) {
    return [input];
  }
  return options.expand !== true ? braces.compile(input, options) : braces.expand(input, options);
};
var index_default = braces;

module.exports = module.exports.default;
