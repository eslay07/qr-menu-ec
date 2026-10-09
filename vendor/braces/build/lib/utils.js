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
var utils_exports = {};
__export(utils_exports, {
  default: () => utils_default
});
module.exports = __toCommonJS(utils_exports);
const utils = {};
utils.isInteger = (num) => {
  if (typeof num === "number") {
    return Number.isInteger(num);
  }
  if (typeof num === "string" && num.trim() !== "") {
    return Number.isInteger(Number(num));
  }
  return false;
};
utils.find = (node, type) => node.nodes.find((node2) => node2.type === type);
utils.exceedsLimit = (min, max, step = 1, limit) => {
  if (limit === false) return false;
  if (!utils.isInteger(min) || !utils.isInteger(max)) return false;
  return (Number(max) - Number(min)) / Number(step) >= limit;
};
utils.escapeNode = (block, n = 0, type) => {
  const node = block.nodes[n];
  if (!node) return;
  if (type && node.type === type || node.type === "open" || node.type === "close") {
    if (node.escaped !== true) {
      node.value = "\\" + node.value;
      node.escaped = true;
    }
  }
};
utils.encloseBrace = (node) => {
  if (node.type !== "brace") return false;
  if (node.commas >> 0 + node.ranges >> 0 === 0) {
    node.invalid = true;
    return true;
  }
  return false;
};
utils.isInvalidBrace = (block) => {
  if (block.type !== "brace") return false;
  if (block.invalid === true || block.dollar) return true;
  if (block.commas >> 0 + block.ranges >> 0 === 0) {
    block.invalid = true;
    return true;
  }
  if (block.open !== true || block.close !== true) {
    block.invalid = true;
    return true;
  }
  return false;
};
utils.isOpenOrClose = (node) => {
  if (node.type === "open" || node.type === "close") {
    return true;
  }
  return node.open === true || node.close === true;
};
utils.reduce = (nodes) => nodes.reduce((acc, node) => {
  if (node.type === "text") acc.push(node.value);
  if (node.type === "range") node.type = "text";
  return acc;
}, []);
utils.flatten = (...args) => {
  const result = [];
  const flat = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const ele = arr[i];
      if (Array.isArray(ele)) {
        flat(ele);
        continue;
      }
      if (ele !== void 0) {
        result.push(ele);
      }
    }
    return result;
  };
  flat(args);
  return result;
};
var utils_default = utils;

module.exports = module.exports.default;
