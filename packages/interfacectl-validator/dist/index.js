import AjvModule from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import bundledSchema from "./schema/web.surface.contract.schema.json" with {
    type: "json"
};
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
    if (!colorPolicy) {
        return;
    }
    // Validate raw color literals
    if (colorPolicy.rawValues) {
        const policy = colorPolicy.rawValues.policy;
        const allowlist = new Set(colorPolicy.rawValues.allowlist ?? []);
        const denylist = new Set(colorPolicy.rawValues.denylist ?? []);
        for (const color of descriptor.colors) {
            const colorValue = color.value;
            // Skip CSS variables
            if (colorValue.startsWith("var(")) {
                continue;
            }
            // Check if it's a raw color literal (hex, rgb, hsl)
            const isRawLiteral = isRawColorLiteral(colorValue);
            if (!isRawLiteral) {
                continue;
            }
            // Check denylist first (denylist takes precedence, even when policy is "off")
            if (denylist.has(colorValue)) {
                violations.push({
                    surfaceId: descriptor.surfaceId,
                    type: "color-raw-value-used",
                    message: `Raw color literal "${colorValue}" is not allowed (denylist). Use design tokens instead.`,
                    details: {
                        colorValue,
                        source: color.source,
                        policy: policy ?? "off",
                        jsonPointer: "/color/rawValues",
                    },
                });
                continue;
            }
            // Only check allowlist and policy violations when policy is not "off"
            if (policy !== "off") {
                // Check allowlist
                if (allowlist.has(colorValue)) {
                    continue; // Allowlisted, skip
                }
                // Emit violation based on policy
                if (policy === "warn" || policy === "strict") {
                    violations.push({
                        surfaceId: descriptor.surfaceId,
                        type: "color-raw-value-used",
                        message: `Raw color literal "${colorValue}" detected. Use design tokens instead.`,
                        details: {
                            colorValue,
                            source: color.source,
                            policy,
                            jsonPointer: "/color/rawValues",
                        },
                    });
                }
            }
        }
    }
    // Validate token namespaces
    if (colorPolicy.sourceOfTruth &&
        colorPolicy.sourceOfTruth.type === "tokens" &&
        colorPolicy.sourceOfTruth.tokenNamespaces) {
        const allowedNamespaces = colorPolicy.sourceOfTruth.tokenNamespaces;
        for (const color of descriptor.colors) {
            const colorValue = color.value;
            // Only check CSS variables
            if (!colorValue.startsWith("var(")) {
                continue;
            }
            // Extract variable name from var(--name)
            const varMatch = colorValue.match(/var\((--[^)]+)\)/);
            if (!varMatch) {
                continue;
            }
            const varName = varMatch[1];
            // Check if variable name starts with any allowed namespace
            const hasAllowedNamespace = allowedNamespaces.some((namespace) => varName.startsWith(namespace));
            if (!hasAllowedNamespace) {
                violations.push({
                    surfaceId: descriptor.surfaceId,
                    type: "color-token-namespace-violation",
                    message: `Color token "${varName}" does not start with any allowed namespace. Allowed namespaces: ${allowedNamespaces.join(", ")}.`,
                    details: {
                        tokenName: varName,
                        allowedNamespaces,
                        source: color.source,
                        jsonPointer: "/color/sourceOfTruth/tokenNamespaces",
                    },
                });
            }
        }
    }
}
function isRawColorLiteral(value) {
    const trimmed = value.trim().toLowerCase();
    // Hex colors (#rgb, #rrggbb, #rrggbbaa)
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) {
        return true;
    }
    // rgb/rgba colors
    if (/^rgba?\s*\(/.test(trimmed)) {
        return true;
    }
    // hsl/hsla colors
    if (/^hsla?\s*\(/.test(trimmed)) {
        return true;
    }
    return false;
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
    // Legacy allowedColors check (deprecated)
    if (surface.allowedColors) {
        const allowedColors = new Set(surface.allowedColors);
        for (const color of descriptor.colors) {
            if (!allowedColors.has(color.value)) {
                violations.push({
                    surfaceId: descriptor.surfaceId,
                    type: "color-not-allowed",
                    message: `Color "${color.value}" is not allowed for surface "${descriptor.surfaceId}".`,
                    details: {
                        color: color.value,
                        source: color.source,
                        allowedColors: [...allowedColors],
                    },
                });
            }
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
    // New color policy validation
    if (contract.color) {
        validateColorPolicy(contract, descriptor, violations);
    }
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
    if (surface.layout.pageFrame && descriptor.layout.pageFrame) {
        const pageFrameContract = surface.layout.pageFrame;
        const pageFrameDescriptor = descriptor.layout.pageFrame;
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
