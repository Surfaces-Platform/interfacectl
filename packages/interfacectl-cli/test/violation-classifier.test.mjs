import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyViolationType,
  getExitCodeForCategory,
  getMaxSeverity,
} from "../dist/utils/violation-classifier.js";

test("classifyViolationType: E1 violations", () => {
  assert.equal(classifyViolationType("font-not-allowed"), "E1");
  assert.equal(classifyViolationType("color-not-allowed"), "E1");
  assert.equal(classifyViolationType("icon-source-not-allowed"), "E1");
  assert.equal(classifyViolationType("motion-duration-not-allowed"), "E1");
  assert.equal(classifyViolationType("motion-timing-not-allowed"), "E1");
});

test("classifyViolationType: E2 violations", () => {
  assert.equal(classifyViolationType("layout-width-exceeded"), "E2");
  assert.equal(classifyViolationType("layout-width-undetermined"), "E2");
  assert.equal(classifyViolationType("layout-container-missing"), "E2");
  assert.equal(classifyViolationType("layout-pageframe-minwidth-mismatch"), "E2");
  assert.equal(classifyViolationType("missing-section"), "E2");
  assert.equal(classifyViolationType("unknown-section"), "E2");
  assert.equal(classifyViolationType("unknown-surface"), "E2");
  assert.equal(classifyViolationType("descriptor-missing"), "E2");
  assert.equal(classifyViolationType("descriptor-unused"), "E2");
  assert.equal(classifyViolationType("descriptor-flows-missing"), "E2");
  assert.equal(classifyViolationType("flow-required-missing"), "E2");
  assert.equal(classifyViolationType("flow-steps-min"), "E2");
  assert.equal(classifyViolationType("flow-steps-required"), "E2");
  assert.equal(classifyViolationType("flow-transition-required"), "E2");
  assert.equal(classifyViolationType("flow-terminal-invalid"), "E2");
});

test("getExitCodeForCategory: v2 exit codes", () => {
  assert.equal(getExitCodeForCategory("E0", "v2"), 10);
  assert.equal(getExitCodeForCategory("E1", "v2"), 20);
  assert.equal(getExitCodeForCategory("E2", "v2"), 30);
  assert.equal(getExitCodeForCategory("E3", "v2"), 40);
});

test("getExitCodeForCategory: v1 exit codes", () => {
  assert.equal(getExitCodeForCategory("E0", "v1"), 2);
  assert.equal(getExitCodeForCategory("E1", "v1"), 1);
  assert.equal(getExitCodeForCategory("E2", "v1"), 1);
  assert.equal(getExitCodeForCategory("E3", "v1"), 1);
});

test("getMaxSeverity: empty array returns null", () => {
  assert.equal(getMaxSeverity([]), null);
});

test("getMaxSeverity: returns highest severity", () => {
  const entries = [
    { severity: "info", path: "test1", type: "modified" },
    { severity: "warning", path: "test2", type: "added" },
    { severity: "error", path: "test3", type: "removed" },
  ];
  assert.equal(getMaxSeverity(entries), "error");
});

test("getMaxSeverity: returns info when all are info", () => {
  const entries = [
    { severity: "info", path: "test1", type: "modified" },
    { severity: "info", path: "test2", type: "added" },
  ];
  assert.equal(getMaxSeverity(entries), "info");
});

test("getMaxSeverity: returns warning when highest is warning", () => {
  const entries = [
    { severity: "info", path: "test1", type: "modified" },
    { severity: "warning", path: "test2", type: "added" },
  ];
  assert.equal(getMaxSeverity(entries), "warning");
});
