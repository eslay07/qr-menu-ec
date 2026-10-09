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
var expand_exports = {};
__export(expand_exports, {
  default: () => expand_default
});
module.exports = __toCommonJS(expand_exports);
var import_fill_range = __toESM(require("fill-range"), 1);
var import_stringify = __toESM(require("./stringify.js"), 1);
var import_utils = __toESM(require("./utils.js"), 1);
const append = (queue = "", stash = "", enclose = false) => {
  const result = [];
  queue = [].concat(queue);
  stash = [].concat(stash);
  if (!stash.length) return queue;
  if (!queue.length) {
    return enclose ? import_utils.default.flatten(stash).map((ele) => `{${ele}}`) : stash;
  }
  for (const item of queue) {
    if (Array.isArray(item)) {
      for (const value of item) {
        result.push(append(value, stash, enclose));
      }
    } else {
      for (let ele of stash) {
        if (enclose === true && typeof ele === "string") ele = `{${ele}}`;
        result.push(Array.isArray(ele) ? append(item, ele, enclose) : item + ele);
      }
    }
  }
  return import_utils.default.flatten(result);
};
const expand = (ast, options = {}) => {
  const rangeLimit = options.rangeLimit === void 0 ? 1e3 : options.rangeLimit;
  const walk = (node, parent = {}) => {
    node.queue = [];
    let p = parent;
    let q = parent.queue;
    while (p.type !== "brace" && p.type !== "root" && p.parent) {
      p = p.parent;
      q = p.queue;
    }
    if (node.invalid || node.dollar) {
      q.push(append(q.pop(), (0, import_stringify.default)(node, options)));
      return;
    }
    if (node.type === "brace" && node.invalid !== true && node.nodes.length === 2) {
      q.push(append(q.pop(), ["{}"]));
      return;
    }
    if (node.nodes && node.ranges > 0) {
      const args = import_utils.default.reduce(node.nodes);
      if (import_utils.default.exceedsLimit(...args, options.step, rangeLimit)) {
        throw new RangeError("expanded array length exceeds range limit. Use options.rangeLimit to increase or disable the limit.");
      }
      let range = (0, import_fill_range.default)(...args, options);
      if (range.length === 0) {
        range = (0, import_stringify.default)(node, options);
      }
      q.push(append(q.pop(), range));
      node.nodes = [];
      return;
    }
    const enclose = import_utils.default.encloseBrace(node);
    let queue = node.queue;
    let block = node;
    while (block.type !== "brace" && block.type !== "root" && block.parent) {
      block = block.parent;
      queue = block.queue;
    }
    for (let i = 0; i < node.nodes.length; i++) {
      const child = node.nodes[i];
      if (child.type === "comma" && node.type === "brace") {
        if (i === 1) queue.push("");
        queue.push("");
        continue;
      }
      if (child.type === "close") {
        q.push(append(q.pop(), queue, enclose));
        continue;
      }
      if (child.value && child.type !== "open") {
        queue.push(append(queue.pop(), child.value));
        continue;
      }
      if (child.nodes) {
        walk(child, node);
      }
    }
    return queue;
  };
  return import_utils.default.flatten(walk(ast));
};
var expand_default = expand;

module.exports = module.exports.default;
