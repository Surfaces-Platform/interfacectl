import AjvModule from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import bundledSchema from "./schema/web.surface.contract.schema.json" with {
    type: "json"
};
import { normalizeColorValue } from "./color-policy.js";
const frozenBundledSchema = Object.freeze(bundledSchema);
export function getBundledContractSchema() {
    return frozenBundledSchema;
}
export function validateContractStructure(contractData, schema) {
    const ajv = new AjvModule({
        allErrors: true,
        strict: false,
    });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = validate(contractData);
    if (!valid) {
        return {
            ok: false,
            errors: formatAjvErrors(validate.errors),
        };
    }
    return {
        ok: true,
        errors: [],
        contract: contractData,
    };
}
function validateColorPolicy(contract, descriptor, violations) {
    const colorPolicy = contract.color;
    if (!colorPolicy || colorPolicy.policy === "off") {
        return;
    }
    const allowedValues = new Set(colorPolicy.allowedValues.map(normalizeColorValue));
    for (const color of descriptor.colors) {
        const normalizedColorValue = normalizeColorValue(color.value);
        if (allowedValues.has(normalizedColorValue)) {
            continue;
        }
        violations.push({
            surfaceId: descriptor.surfaceId,
            type: "color-not-allowed",
            message: `Color "${normalizedColorValue}" is not allowed for surface "${descriptor.surfaceId}".`,
            details: {
                color: normalizedColorValue,
                source: color.source,
                allowedValues: [...allowedValues],
                policy: colorPolicy.policy,
                jsonPointer: "/color/allowedValues",
            },
        });
    }
}
function validateIconPolicy(surface, descriptor, violations) {
    const iconPolicy = surface.icons;
    if (surface.type !== "web" || !iconPolicy || iconPolicy.policy === "off") {
        return;
    }
    const allowedSources = new Set(iconPolicy.allowedSources);
    const seenSources = new Set();
    for (const icon of descriptor.icons ?? []) {
        const iconSource = icon.value.trim();
        if (!iconSource || seenSources.has(iconSource)) {
            continue;
        }
        seenSources.add(iconSource);
        if (allowedSources.has(iconSource)) {
            continue;
        }
        violations.push({
            surfaceId: descriptor.surfaceId,
            type: "icon-source-not-allowed",
            message: `Icon source "${iconSource}" is not allowed for surface "${descriptor.surfaceId}".`,
            details: {
                iconSource,
                source: icon.source,
                allowedSources: [...allowedSources],
                policy: iconPolicy.policy,
                jsonPointer: `/surfaces/${descriptor.surfaceId}/icons/allowedSources`,
            },
        });
    }
}
function validateFlowPolicy(surface, descriptor, violations) {
    const flowPolicy = surface.flows;
    if (!flowPolicy || flowPolicy.policy === "off") {
        return;
    }
    const policy = flowPolicy.policy;
    const requirements = flowPolicy.requirements ?? [];
    const descriptorFlows = descriptor.flows;
    const defaultSource = descriptor.flowDescriptorPath;
    if (!Array.isArray(descriptorFlows)) {
        violations.push({
            surfaceId: descriptor.surfaceId,
            type: "descriptor-flows-missing",
            message: `Flow descriptor is missing for surface "${descriptor.surfaceId}" while flow policy is "${policy}".`,
            details: {
                policy,
                source: defaultSource,
                flowDescriptorPath: defaultSource,
                requiredFlowIds: requirements.map((requirement) => requirement.flowId),
            },
        });
        return;
    }
    const flowMap = new Map(descriptorFlows
        .map((flow) => [flow.flowId?.trim(), flow])
        .filter(([flowId]) => typeof flowId === "string" && flowId.length > 0));
    for (const requirement of requirements) {
        const requirementSource = defaultSource;
        const flowId = requirement.flowId;
        const descriptorFlow = flowMap.get(flowId);
        if (!descriptorFlow) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "flow-required-missing",
                message: `Required flow "${flowId}" is missing for surface "${descriptor.surfaceId}".`,
                details: {
                    flowId,
                    policy,
                    source: requirementSource,
                    flowDescriptorPath: defaultSource,
                },
            });
            continue;
        }
        const flowSource = descriptorFlow.source ?? defaultSource;
        const stepIds = new Set((descriptorFlow.steps ?? [])
            .map((step) => step.id?.trim())
            .filter((stepId) => Boolean(stepId)));
        if (typeof requirement.minSteps === "number" &&
            stepIds.size < requirement.minSteps) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "flow-steps-min",
                message: `Flow "${flowId}" has ${stepIds.size} step(s); minimum is ${requirement.minSteps}.`,
                details: {
                    flowId,
                    minSteps: requirement.minSteps,
                    actualStepCount: stepIds.size,
                    stepIds: [...stepIds],
                    policy,
                    source: flowSource,
                },
            });
        }
        const requiredSteps = requirement.requiredSteps ?? [];
        const missingRequiredSteps = requiredSteps.filter((stepId) => !stepIds.has(stepId));
        if (missingRequiredSteps.length > 0) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "flow-steps-required",
                message: `Flow "${flowId}" is missing required step(s): ${missingRequiredSteps.join(", ")}.`,
                details: {
                    flowId,
                    requiredSteps,
                    missingRequiredSteps,
                    policy,
                    source: flowSource,
                },
            });
        }
        const transitionList = (descriptorFlow.transitions ?? [])
            .map((transition) => ({
            from: transition.from?.trim(),
            to: transition.to?.trim(),
        }))
            .filter((transition) => Boolean(transition.from && transition.to));
        const transitionKeys = new Set(transitionList.map((transition) => `${transition.from}->${transition.to}`));
        const requiredTransitions = requirement.requiredTransitions ?? [];
        const missingRequiredTransitions = requiredTransitions.filter((transition) => !transitionKeys.has(`${transition.from}->${transition.to}`));
        if (missingRequiredTransitions.length > 0) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "flow-transition-required",
                message: `Flow "${flowId}" is missing required transition(s).`,
                details: {
                    flowId,
                    requiredTransitions,
                    missingRequiredTransitions,
                    policy,
                    source: flowSource,
                },
            });
        }
        const terminalSteps = requirement.terminalSteps ?? [];
        const invalidTerminalTransitions = transitionList.filter((transition) => terminalSteps.includes(transition.from));
        if (invalidTerminalTransitions.length > 0) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "flow-terminal-invalid",
                message: `Flow "${flowId}" has outgoing transition(s) from terminal step(s).`,
                details: {
                    flowId,
                    terminalSteps,
                    invalidTransitions: invalidTerminalTransitions,
                    policy,
                    source: flowSource,
                },
            });
        }
    }
}
export function evaluateSurfaceCompliance(contract, descriptor) {
    const surface = findSurface(contract.surfaces, descriptor.surfaceId);
    const violations = [];
    if (!surface) {
        violations.push({
            surfaceId: descriptor.surfaceId,
            type: "unknown-surface",
            message: `Surface "${descriptor.surfaceId}" is not defined in the contract.`,
        });
        return {
            surfaceId: descriptor.surfaceId,
            violations,
        };
    }
    const contractSections = buildSectionIndex(contract.sections);
    const descriptorSectionIds = new Set(descriptor.sections.map((section) => section.id));
    for (const requiredSection of surface.requiredSections) {
        if (!descriptorSectionIds.has(requiredSection)) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "missing-section",
                message: `Required section "${requiredSection}" is missing for surface "${descriptor.surfaceId}".`,
                details: {
                    sectionId: requiredSection,
                    requiredSections: surface.requiredSections,
                },
            });
        }
    }
    for (const section of descriptor.sections) {
        if (!contractSections.has(section.id)) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "unknown-section",
                message: `Section "${section.id}" implemented by surface "${descriptor.surfaceId}" is not present in the contract.`,
                details: { sectionId: section.id, source: section.source },
            });
        }
    }
    const allowedFonts = new Set(surface.allowedFonts);
    for (const font of descriptor.fonts) {
        if (!allowedFonts.has(font.value)) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "font-not-allowed",
                message: `Font "${font.value}" is not allowed for surface "${descriptor.surfaceId}".`,
                details: {
                    font: font.value,
                    source: font.source,
                    allowedFonts: [...allowedFonts],
                },
            });
        }
    }
    // Shell-owned primitives check
    const normalizeRole = (role) => {
        if (!role)
            return undefined;
        const r = role.toLowerCase();
        if (r === "nav")
            return "navigation";
        if (r === "navigation")
            return "navigation";
        if (r === "auth" || r === "auth-shell" || r === "authwrapper")
            return "auth-shell";
        if (r === "header")
            return "header";
        if (r === "footer")
            return "footer";
        if (r === "sidebar")
            return "sidebar";
        return r;
    };
    const wildcardToRegex = (pattern) => {
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        const regexSource = escaped
            .replace(/\*\*/g, "::DOUBLE_STAR::")
            .replace(/\*/g, "[^/]*")
            .replace(/::DOUBLE_STAR::/g, ".*");
        return new RegExp(`^${regexSource}$`);
    };
    const sourceMatchesPattern = (source, pattern) => {
        if (!pattern.includes("*")) {
            return source === pattern;
        }
        return wildcardToRegex(pattern).test(source);
    };
    const sourceAllowed = (source, allowPatterns) => allowPatterns.some((pattern) => sourceMatchesPattern(source, pattern));
    const banList = new Set((surface.mustNotEmit && surface.mustNotEmit.length > 0
        ? surface.mustNotEmit
        : contract.shell?.owns ?? []).map(normalizeRole).filter(Boolean));
    const allowSources = surface.shellOwnedPrimitiveAllowSources ?? [];
    if (banList.size > 0 && descriptor.primitives) {
        for (const primitive of descriptor.primitives) {
            const role = normalizeRole(primitive.role);
            const primitiveSources = primitive.sources ?? [];
            const disallowedSources = primitiveSources.filter((source) => !sourceAllowed(source, allowSources));
            const shouldReport = role &&
                banList.has(role) &&
                primitive.count > 0 &&
                (primitiveSources.length === 0 || disallowedSources.length > 0);
            if (shouldReport) {
                violations.push({
                    surfaceId: descriptor.surfaceId,
                    type: "shell-owned-primitive-emitted",
                    message: `Primitive "${primitive.role}" is shell-owned and must not be emitted. Count: ${primitive.count}.`,
                    details: {
                        role,
                        count: primitive.count,
                        sources: primitive.sources,
                        disallowedSources,
                        allowSources,
                        banList: [...banList],
                        jsonPointer: "/shell/owns",
                    },
                });
            }
        }
    }
    validateColorPolicy(contract, descriptor, violations);
    validateIconPolicy(surface, descriptor, violations);
    validateFlowPolicy(surface, descriptor, violations);
    const reportedWidth = descriptor.layout.maxContentWidth;
    if (reportedWidth === null || reportedWidth === undefined) {
        violations.push({
            surfaceId: descriptor.surfaceId,
            type: "layout-width-undetermined",
            message: `Max content width is not provided for surface "${descriptor.surfaceId}".`,
            details: {
                expectedMaxWidth: surface.layout.maxContentWidth,
                source: descriptor.layout.source,
            },
        });
    }
    else if (reportedWidth > surface.layout.maxContentWidth) {
        violations.push({
            surfaceId: descriptor.surfaceId,
            type: "layout-width-exceeded",
            message: `Max content width ${reportedWidth}px exceeds the contract limit of ${surface.layout.maxContentWidth}px for surface "${descriptor.surfaceId}".`,
            details: {
                reportedWidth,
                allowedWidth: surface.layout.maxContentWidth,
                source: descriptor.layout.source,
            },
        });
    }
    const configuredContainers = surface.layout.requiredContainers;
    const requiredContainers = configuredContainers === undefined
        ? ["contract-container"]
        : configuredContainers;
    if (requiredContainers.length > 0) {
        const descriptorContainers = new Set(descriptor.layout.containers ?? []);
        const missingContainers = requiredContainers.filter((container) => !descriptorContainers.has(container));
        if (missingContainers.length > 0) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "layout-container-missing",
                message: `Surface "${descriptor.surfaceId}" is missing required container(s): ${missingContainers
                    .map((container) => `"${container}"`)
                    .join(", ")}.`,
                details: {
                    requiredContainers,
                    missingContainers,
                    containerSources: descriptor.layout.containerSources ?? [],
                },
            });
        }
    }
    const allowedDurations = new Set(contract.constraints.motion.allowedDurationsMs);
    const allowedTimingFunctions = new Set(contract.constraints.motion.allowedTimingFunctions);
    for (const motion of descriptor.motion) {
        if (!allowedDurations.has(motion.durationMs)) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "motion-duration-not-allowed",
                message: `Motion duration ${motion.durationMs}ms is not allowed for surface "${descriptor.surfaceId}".`,
                details: {
                    durationMs: motion.durationMs,
                    allowedDurations: [...allowedDurations],
                    source: motion.source,
                },
            });
        }
        if (!allowedTimingFunctions.has(motion.timingFunction)) {
            violations.push({
                surfaceId: descriptor.surfaceId,
                type: "motion-timing-not-allowed",
                message: `Motion timing function "${motion.timingFunction}" is not allowed for surface "${descriptor.surfaceId}".`,
                details: {
                    timingFunction: motion.timingFunction,
                    allowedTimingFunctions: [...allowedTimingFunctions],
                    source: motion.source,
                },
            });
        }
    }
    // Validate pageFrame layout if contract defines it
    if (surface.layout.pageFrame) {
        const pageFrameContract = surface.layout.pageFrame;
        const pageFrameDescriptor = descriptor.layout.pageFrame ?? {
            containerSelector: pageFrameContract.containerSelector,
            maxWidthPx: null,
            minWidthPx: null,
            paddingLeftPx: null,
            paddingRightPx: null,
        };
        const enforcement = pageFrameContract.enforcement ?? "strict";
        // Check if selector is supported
        const containerSelector = pageFrameContract.containerSelector;
        const isSupportedSelector = containerSelector === '[data-contract="page-container"]' ||
            containerSelector === "[data-contract='page-container']" ||
            containerSelector === '[data-contract={page-container}]';
        if (!isSupportedSelector) {
            const violation = {
                surfaceId: descriptor.surfaceId,
                type: "layout-pageframe-selector-unsupported",
                message: `Page frame container selector "${containerSelector}" is not supported in static analysis. Use '[data-contract="page-container"]' instead.`,
                details: {
                    selector: containerSelector,
                    supportedSelectors: ['[data-contract="page-container"]'],
                },
            };
            violations.push(violation);
        }
        else {
            // Validate container exists
            if (pageFrameDescriptor.maxWidthPx === null &&
                pageFrameDescriptor.paddingLeftPx === null &&
                pageFrameDescriptor.paddingRightPx === null) {
                violations.push({
                    surfaceId: descriptor.surfaceId,
                    type: "layout-pageframe-container-not-found",
                    message: `Page container with data-contract="page-container" not found for surface "${descriptor.surfaceId}".`,
                    details: {
                        selector: containerSelector,
                        source: pageFrameDescriptor.source,
                    },
                });
            }
            else {
                // Validate max-width
                const expectedMaxWidth = pageFrameContract.containerMaxWidthPx;
                const actualMaxWidth = pageFrameDescriptor.maxWidthPx;
                if (actualMaxWidth === null) {
                    // Check if clamp/calc was detected
                    if (pageFrameDescriptor.maxWidthHasClampCalc) {
                        violations.push({
                            surfaceId: descriptor.surfaceId,
                            type: "layout-pageframe-non-deterministic-value",
                            message: `Page frame max-width uses non-deterministic expression (clamp/calc) for surface "${descriptor.surfaceId}". Expected ${expectedMaxWidth}px. Static analysis requires deterministic px values. Use fixed px values in inline styles or CSS rules targeting [data-contract="page-container"].`,
                            details: {
                                property: "max-width",
                                expected: expectedMaxWidth,
                                actual: null,
                                selector: containerSelector,
                                source: pageFrameDescriptor.source,
                            },
                        });
                    }
                    else {
                        violations.push({
                            surfaceId: descriptor.surfaceId,
                            type: "layout-pageframe-unextractable-value",
                            message: `Page frame max-width could not be extracted for surface "${descriptor.surfaceId}". Expected ${expectedMaxWidth}px. Use inline styles, CSS rules targeting [data-contract="page-container"], or Tailwind bracket classes (max-w-[${expectedMaxWidth}px]).`,
                            details: {
                                property: "max-width",
                                expected: expectedMaxWidth,
                                actual: null,
                                selector: containerSelector,
                                source: pageFrameDescriptor.source,
                            },
                        });
                    }
                }
                else if (actualMaxWidth !== expectedMaxWidth) {
                    violations.push({
                        surfaceId: descriptor.surfaceId,
                        type: "layout-pageframe-maxwidth-mismatch",
                        message: `Page frame max-width mismatch for surface "${descriptor.surfaceId}": expected ${expectedMaxWidth}px, found ${actualMaxWidth}px.`,
                        details: {
                            expected: expectedMaxWidth,
                            actual: actualMaxWidth,
                            selector: containerSelector,
                            source: pageFrameDescriptor.source,
                        },
                    });
                }
                // Validate min-width (optional)
                const expectedMinWidth = pageFrameContract.containerMinWidthPx;
                if (expectedMinWidth !== undefined) {
                    const actualMinWidth = pageFrameDescriptor.minWidthPx ?? null;
                    if (actualMinWidth === null) {
                        if (pageFrameDescriptor.minWidthHasClampCalc) {
                            violations.push({
                                surfaceId: descriptor.surfaceId,
                                type: "layout-pageframe-non-deterministic-value",
                                message: `Page frame min-width uses non-deterministic expression (clamp/calc) for surface "${descriptor.surfaceId}". Expected ${expectedMinWidth}px. Static analysis requires deterministic px values. Use fixed px values in inline styles or CSS rules targeting [data-contract="page-container"].`,
                                details: {
                                    property: "min-width",
                                    expected: expectedMinWidth,
                                    actual: null,
                                    selector: containerSelector,
                                    source: pageFrameDescriptor.source,
                                },
                            });
                        }
                        else {
                            violations.push({
                                surfaceId: descriptor.surfaceId,
                                type: "layout-pageframe-unextractable-value",
                                message: `Page frame min-width could not be extracted for surface "${descriptor.surfaceId}". Expected ${expectedMinWidth}px. Use inline styles, CSS rules targeting [data-contract="page-container"], or Tailwind bracket classes (min-w-[${expectedMinWidth}px]).`,
                                details: {
                                    property: "min-width",
                                    expected: expectedMinWidth,
                                    actual: null,
                                    selector: containerSelector,
                                    source: pageFrameDescriptor.source,
                                },
                            });
                        }
                    }
                    else if (actualMinWidth !== expectedMinWidth) {
                        violations.push({
                            surfaceId: descriptor.surfaceId,
                            type: "layout-pageframe-minwidth-mismatch",
                            message: `Page frame min-width mismatch for surface "${descriptor.surfaceId}": expected ${expectedMinWidth}px, found ${actualMinWidth}px.`,
                            details: {
                                expected: expectedMinWidth,
                                actual: actualMinWidth,
                                selector: containerSelector,
                                source: pageFrameDescriptor.source,
                            },
                        });
                    }
                }
                // Validate padding
                const expectedPadding = pageFrameContract.paddingXpx;
                const actualPaddingLeft = pageFrameDescriptor.paddingLeftPx;
                const actualPaddingRight = pageFrameDescriptor.paddingRightPx;
                if (actualPaddingLeft === null || actualPaddingRight === null) {
                    // Check if clamp/calc was detected
                    if (pageFrameDescriptor.paddingHasClampCalc) {
                        violations.push({
                            surfaceId: descriptor.surfaceId,
                            type: "layout-pageframe-non-deterministic-value",
                            message: `Page frame padding uses non-deterministic expression (clamp/calc) for surface "${descriptor.surfaceId}". Expected ${expectedPadding}px. Static analysis requires deterministic px values. Use fixed px values in inline styles or CSS rules targeting [data-contract="page-container"].`,
                            details: {
                                property: "padding",
                                expected: expectedPadding,
                                actualLeft: actualPaddingLeft,
                                actualRight: actualPaddingRight,
                                selector: containerSelector,
                                source: pageFrameDescriptor.source,
                            },
                        });
                    }
                    else {
                        violations.push({
                            surfaceId: descriptor.surfaceId,
                            type: "layout-pageframe-unextractable-value",
                            message: `Page frame padding could not be extracted for surface "${descriptor.surfaceId}". Expected ${expectedPadding}px. Static analysis requires deterministic px values. Use inline styles, CSS rules targeting [data-contract="page-container"], or Tailwind bracket classes (px-[${expectedPadding}px]).`,
                            details: {
                                property: "padding",
                                expected: expectedPadding,
                                actualLeft: actualPaddingLeft,
                                actualRight: actualPaddingRight,
                                selector: containerSelector,
                                source: pageFrameDescriptor.source,
                            },
                        });
                    }
                }
                else if (actualPaddingLeft !== expectedPadding ||
                    actualPaddingRight !== expectedPadding) {
                    violations.push({
                        surfaceId: descriptor.surfaceId,
                        type: "layout-pageframe-padding-mismatch",
                        message: `Page frame padding mismatch for surface "${descriptor.surfaceId}": expected ${expectedPadding}px on both sides, found left=${actualPaddingLeft}px right=${actualPaddingRight}px.`,
                        details: {
                            expected: expectedPadding,
                            actualLeft: actualPaddingLeft,
                            actualRight: actualPaddingRight,
                            selector: containerSelector,
                            source: pageFrameDescriptor.source,
                        },
                    });
                }
            }
        }
        // Apply enforcement mode: warn mode violations don't affect exit code
        // This is handled at the CLI level by checking violation severity
    }
    return {
        surfaceId: descriptor.surfaceId,
        violations,
    };
}
export function evaluateContractCompliance(contract, descriptors) {
    const descriptorMap = new Map(descriptors.map((descriptor) => [descriptor.surfaceId, descriptor]));
    const reports = contract.surfaces.map((surface) => {
        const descriptor = descriptorMap.get(surface.id);
        if (!descriptor) {
            return {
                surfaceId: surface.id,
                violations: [
                    {
                        surfaceId: surface.id,
                        type: "descriptor-missing",
                        message: `No descriptor provided for surface "${surface.id}".`,
                        details: { requiredSections: surface.requiredSections },
                    },
                ],
            };
        }
        return evaluateSurfaceCompliance(contract, descriptor);
    });
    for (const descriptor of descriptors) {
        const definedSurface = contract.surfaces.some((surface) => surface.id === descriptor.surfaceId);
        if (!definedSurface) {
            reports.push({
                surfaceId: descriptor.surfaceId,
                violations: [
                    {
                        surfaceId: descriptor.surfaceId,
                        type: "descriptor-unused",
                        message: `Descriptor provided for surface "${descriptor.surfaceId}" which is not present in the contract.`,
                    },
                ],
            });
        }
    }
    return {
        contract,
        surfaceReports: reports,
    };
}
function formatAjvErrors(errors) {
    if (!errors) {
        return [];
    }
    return errors.map((error) => {
        const dataPath = error.instancePath || error.schemaPath;
        const baseMessage = error.message ?? "Validation error";
        // Enhance error messages for common schema issues
        let enhancedMessage = baseMessage;
        if (error.keyword === "additionalProperties" && error.params?.additionalProperty) {
            const prop = error.params.additionalProperty;
            enhancedMessage = `Additional property "${prop}" is not allowed. This may indicate a capability gap - the field is not supported by the current schema version.`;
        }
        else if (error.keyword === "required" && error.params?.missingProperty) {
            const prop = error.params.missingProperty;
            enhancedMessage = `Required property "${prop}" is missing.`;
        }
        if (error.params && Object.keys(error.params).length > 0) {
            return `${dataPath}: ${enhancedMessage} (${JSON.stringify(error.params)})`;
        }
        return `${dataPath}: ${enhancedMessage}`;
    });
}
function buildSectionIndex(sections) {
    return new Set(sections.map((section) => section.id));
}
function findSurface(surfaces, surfaceId) {
    return surfaces.find((surface) => surface.id === surfaceId);
}
export { getBundledDiffSchema, getBundledPolicySchema, getBundledFixSummarySchema, validateDiffOutput, validatePolicy, validateFixSummary, } from "./schema-validate.js";
export { normalizeColorValue, normalizeColorValues, } from "./color-policy.js";
