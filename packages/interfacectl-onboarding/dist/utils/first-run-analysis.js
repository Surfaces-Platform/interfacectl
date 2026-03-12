import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractContractFromNextApp, stableStringify, } from "@surfaces/interfacectl-extractor";
import { normalizeColorValues, } from "@surfaces/interfacectl-validator";
import { collectSurfaceDescriptors } from "../descriptors/static-analysis.js";
import { collectTokenDefinitionsFromContent, normalizeObservedTokens, } from "./token-normalization.js";
import { redactSensitiveUrl } from "./redaction.js";
import { seedChromePolicyFromObservedDescriptors } from "./chrome-policy-seeding.js";
import { seedColorPolicyFromObservedDescriptors } from "./color-policy-seeding.js";
import { seedIconPolicyFromObservedDescriptors } from "./icon-policy-seeding.js";
import { seedObservedUiContract, } from "./observed-ui-seeding.js";
import { observeRemotePage, } from "./browser-session.js";
const DEFAULT_ANALYSIS_SCHEMA_VERSION = 1;
const DEFAULT_CONTRACT_VERSION = "0.1.0";
const PLACEHOLDER_SECTION_ID = "extracted.placeholder";
const AUTH_ROUTE_SET = new Set([
    "/auth/login",
    "/auth/callback",
    "/auth/session",
    "/auth/logout",
]);
const APPLICATION_ROUTE_HINT = /(account|settings|workspace|dashboard|admin|billing|projects|tasks|team|users)/i;
const AUTH_ROUTE_HINT = /(login|logout|signin|signout|session|register|auth)/i;
const CTA_TEXT_HINT = /\b(get started|learn more|request demo|contact sales|sign up|start now|try now|book demo|download|install)\b/i;
const STYLESHEET_LINK_REGEX = /<link\b[^>]*rel=(?:"[^"]*stylesheet[^"]*"|'[^']*stylesheet[^']*')[^>]*href=(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
const INLINE_STYLE_BLOCK_REGEX = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const HREF_REGEX = /\bhref=(?:"([^"]+)"|'([^']+)')/gi;
const FONT_FAMILY_REGEX = /font-family\s*:\s*([^;]+);/gi;
const COLOR_DECL_REGEX = /(?:color|background-color|background|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|outline-color|text-decoration-color|caret-color|column-rule-color)\s*:\s*([^;]+);/gi;
const DURATION_DECL_REGEX = /(animation|transition)-duration\s*:\s*([^;]+);/gi;
const TIMING_DECL_REGEX = /(animation|transition)-timing-function\s*:\s*([^;]+);/gi;
const TRANSITION_DECL_REGEX = /transition[^:]*:\s*([^;]+);/gi;
const MAX_WIDTH_REGEX = /max-width\s*:\s*([0-9.]+)\s*(px|rem|em)/gi;
const BORDER_RADIUS_REGEX = /border-radius\s*:\s*([0-9.]+)\s*(px|rem|em)/gi;
const BOX_SHADOW_REGEX = /box-shadow\s*:\s*([^;]+);/gi;
const TAG_REGEX = /<\/?([A-Za-z][\w.:-]*)\b[^>]*>/g;
const COPY_ROLE_REGEX = /data-contract-copy-role\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
const SECTION_ATTRIBUTE_REGEX = /data-(?:contract-)?section\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`}|{\s*["'`]([^"'`]+)["'`]\s*})/g;
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function uniqueSortedNumbers(values) {
    return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
}
function uniquePositiveSortedNumbers(values) {
    return [...new Set(values.filter((value) => Number.isFinite(value) && value >= 1))].sort((a, b) => a - b);
}
function toStableSourcePath(root, candidate) {
    if (!root) {
        return candidate;
    }
    return path.relative(root, candidate) || ".";
}
function countByValue(values) {
    const counts = new Map();
    for (const entry of values) {
        const normalized = entry.value.trim();
        if (!normalized) {
            continue;
        }
        const bucket = counts.get(normalized) ?? { count: 0, sources: new Set() };
        bucket.count += 1;
        if (entry.source) {
            bucket.sources.add(entry.source);
        }
        counts.set(normalized, bucket);
    }
    return [...counts.entries()]
        .map(([value, bucket]) => ({
        value,
        count: bucket.count,
        sources: [...bucket.sources].sort((a, b) => a.localeCompare(b)),
    }))
        .sort((a, b) => a.value.localeCompare(b.value));
}
function parseLengthToPx(rawValue) {
    if (!rawValue)
        return null;
    const normalized = rawValue.trim();
    const pxMatch = normalized.match(/^([0-9.]+)\s*px$/i);
    if (pxMatch) {
        return Number.parseFloat(pxMatch[1]);
    }
    const remMatch = normalized.match(/^([0-9.]+)\s*rem$/i);
    if (remMatch) {
        return Number.parseFloat(remMatch[1]) * 16;
    }
    const emMatch = normalized.match(/^([0-9.]+)\s*em$/i);
    if (emMatch) {
        return Number.parseFloat(emMatch[1]) * 16;
    }
    const numberMatch = normalized.match(/^([0-9.]+)$/);
    if (numberMatch) {
        return Number.parseFloat(numberMatch[1]);
    }
    return null;
}
function parseDurationToMs(rawValue) {
    if (!rawValue)
        return null;
    const normalized = rawValue.trim();
    const msMatch = normalized.match(/^([0-9.]+)\s*ms$/i);
    if (msMatch) {
        return Number.parseFloat(msMatch[1]);
    }
    const secMatch = normalized.match(/^([0-9.]+)\s*s$/i);
    if (secMatch) {
        return Number.parseFloat(secMatch[1]) * 1000;
    }
    return null;
}
function classifyShadow(rawValue) {
    if (!rawValue)
        return null;
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === "none" || normalized === "0" || normalized === "0px") {
        return "none";
    }
    const inset = /\binset\b/.test(normalized);
    const hasContent = normalized.length > 0;
    if (!hasContent)
        return null;
    if (inset)
        return "inset";
    return "outer";
}
function inferIntentFromSectionId(sectionId) {
    const tokens = sectionId.split(".");
    return tokens[tokens.length - 1] || "section";
}
function defaultDescriptionFromSection(sectionId) {
    return `Observed section for ${sectionId}.`;
}
function buildDescriptorSeedContract(surfaceId, surfaceName) {
    return {
        contractId: `${surfaceId}.analysis`,
        version: DEFAULT_CONTRACT_VERSION,
        description: "Temporary analysis contract for descriptor collection.",
        surfaces: [
            {
                id: surfaceId,
                displayName: surfaceName,
                type: "web",
                requiredSections: [PLACEHOLDER_SECTION_ID],
                allowedFonts: ["sans-serif"],
                layout: {
                    maxContentWidth: 1120,
                    landingPattern: {
                        policy: "warn",
                    },
                },
            },
        ],
        sections: [
            {
                id: PLACEHOLDER_SECTION_ID,
                intent: "placeholder",
                description: "Placeholder section for analysis.",
            },
        ],
        constraints: {
            motion: {
                allowedDurationsMs: [120],
                allowedTimingFunctions: ["linear"],
            },
        },
        color: {
            policy: "warn",
            allowedValues: [],
        },
    };
}
function metadataFromPolicy(policy) {
    return [...(policy?.tokenMetadata ?? [])].sort((a, b) => a.token.localeCompare(b.token));
}
function summarizeFonts(descriptor) {
    return descriptor.fonts
        .map((font) => ({
        value: font.value,
        count: 1,
        sources: font.source ? [font.source] : [],
    }))
        .sort((a, b) => a.value.localeCompare(b.value));
}
function summarizeColors(descriptor) {
    return descriptor.colors
        .map((color) => ({
        canonical: normalizeColorValues([color.value])[0] ?? color.value,
        count: 1,
        sources: color.source ? [color.source] : [],
    }))
        .sort((a, b) => a.canonical.localeCompare(b.canonical));
}
function summarizeMotion(descriptor) {
    return descriptor.motion
        .map((motion) => ({
        durationMs: motion.durationMs,
        timingFunction: motion.timingFunction,
        count: 1,
        sources: motion.source ? [motion.source] : [],
    }))
        .sort((a, b) => a.durationMs === b.durationMs
        ? a.timingFunction.localeCompare(b.timingFunction)
        : a.durationMs - b.durationMs);
}
function summarizeIcons(descriptor) {
    return (descriptor.icons ?? [])
        .map((icon) => ({
        value: icon.value,
        count: 1,
        sources: icon.source ? [icon.source] : [],
    }))
        .sort((a, b) => a.value.localeCompare(b.value));
}
function summarizeRemoteFontsFromRenderedStyles(source, renderedStyles) {
    return countByValue(renderedStyles.fonts.map((value) => ({ value, source })))
        .map((entry) => ({
        value: entry.value,
        count: entry.count,
        sources: entry.sources,
    }));
}
function summarizeRemoteColorsFromRenderedStyles(source, renderedStyles) {
    return countByValue(renderedStyles.colors.flatMap((value) => normalizeColorValues([value]).map((canonical) => ({ value: canonical, source })))).map((entry) => ({
        canonical: entry.value,
        count: entry.count,
        sources: entry.sources,
    }));
}
function summarizeRemoteMotionFromRenderedStyles(source, renderedStyles) {
    return countByValue(renderedStyles.motions.map((entry) => ({
        value: `${entry.durationMs}::${entry.timingFunction}`,
        source,
    })))
        .map((entry) => {
        const [durationPart, timingFunction] = entry.value.split("::");
        return {
            durationMs: Number.parseFloat(durationPart),
            timingFunction,
            count: entry.count,
            sources: entry.sources,
        };
    })
        .filter((entry) => entry.durationMs > 0 || entry.timingFunction.length > 0);
}
function collectRemoteFontsFromCss(cssContents) {
    return countByValue(cssContents.flatMap(({ source, content }) => {
        const families = [];
        FONT_FAMILY_REGEX.lastIndex = 0;
        let match;
        while ((match = FONT_FAMILY_REGEX.exec(content)) !== null) {
            for (const token of match[1].split(",")) {
                const value = token.trim().replace(/^["']|["']$/g, "");
                if (value) {
                    families.push({ value, source });
                }
            }
        }
        return families;
    })).map((entry) => ({
        value: entry.value,
        count: entry.count,
        sources: entry.sources,
    }));
}
function collectRemoteColorsFromCss(cssContents) {
    return countByValue(cssContents.flatMap(({ source, content }) => {
        const values = [];
        COLOR_DECL_REGEX.lastIndex = 0;
        let match;
        while ((match = COLOR_DECL_REGEX.exec(content)) !== null) {
            const rawValue = match[1]?.trim();
            if (!rawValue)
                continue;
            for (const color of normalizeColorValues([rawValue])) {
                values.push({ value: color, source });
            }
        }
        return values;
    })).map((entry) => ({
        canonical: entry.value,
        count: entry.count,
        sources: entry.sources,
    }));
}
function collectRemoteMotionFromCss(cssContents) {
    return countByValue(cssContents.flatMap(({ source, content }) => {
        const values = [];
        DURATION_DECL_REGEX.lastIndex = 0;
        let match;
        while ((match = DURATION_DECL_REGEX.exec(content)) !== null) {
            const duration = parseDurationToMs(match[2]);
            if (duration !== null) {
                values.push({ value: `${duration}::linear`, source });
            }
        }
        TRANSITION_DECL_REGEX.lastIndex = 0;
        while ((match = TRANSITION_DECL_REGEX.exec(content)) !== null) {
            const text = match[1];
            const durationMatch = text.match(/([0-9.]+\s*(?:ms|s))/i);
            const timingMatch = text.match(/\b(linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\([^)]*\))\b/i);
            const duration = parseDurationToMs(durationMatch?.[1]);
            if (duration !== null) {
                values.push({ value: `${duration}::${(timingMatch?.[1] ?? "linear").trim()}`, source });
            }
        }
        TIMING_DECL_REGEX.lastIndex = 0;
        while ((match = TIMING_DECL_REGEX.exec(content)) !== null) {
            const timing = match[2]?.trim();
            if (timing) {
                values.push({ value: `0::${timing}`, source });
            }
        }
        return values;
    }))
        .map((entry) => {
        const [durationPart, timingFunction] = entry.value.split("::");
        return {
            durationMs: Number.parseFloat(durationPart),
            timingFunction,
            count: entry.count,
            sources: entry.sources,
        };
    })
        .filter((entry) => entry.durationMs > 0 || entry.timingFunction.length > 0);
}
function buildPhase0Seed(observation) {
    const routes = new Set(observation.routes);
    const hasAllAuthRoutes = [...AUTH_ROUTE_SET].every((route) => routes.has(route));
    const authPosture = hasAllAuthRoutes ? "auth-first" : observation.authAware ? "auth-aware" : "public";
    return {
        authPosture,
        requiresShell: observation.hasShell,
        expectsAuthRoutes: hasAllAuthRoutes,
        expectsDesignSystem: observation.designSystemComponents.length > 0,
    };
}
function countAliases(metadata) {
    return metadata
        .flatMap((entry) => entry.aliases)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}
function buildFindings(observation) {
    const findings = [];
    const fonts = observation.descriptor.fonts.map((font) => font.value);
    if (fonts.length > 2) {
        findings.push({
            code: "typography.multiple-families",
            severity: "warning",
            category: "typography",
            message: `Detected ${fonts.length} font families; review whether all are intentional system choices.`,
        });
    }
    const motionDurations = uniqueSortedNumbers(observation.descriptor.motion.map((motion) => motion.durationMs));
    if (motionDurations.length > 2) {
        findings.push({
            code: "motion.multiple-durations",
            severity: "warning",
            category: "motion",
            message: `Detected ${motionDurations.length} distinct motion durations; consolidate repeated timing choices.`,
        });
    }
    const colorValues = observation.descriptor.colors.map((color) => color.value);
    const rawColorCount = colorValues.filter((value) => !value.startsWith("var(")).length;
    if (rawColorCount > 3) {
        findings.push({
            code: "color.raw-literals-heavy",
            severity: "warning",
            category: "color",
            message: `Detected ${rawColorCount} raw color literals; consider canonicalizing them into stable tokens or approved values.`,
        });
    }
    const shadowKinds = observation.descriptor.layout.chrome?.shadowKinds ?? [];
    if (shadowKinds.includes("outer")) {
        findings.push({
            code: "layout.outer-shadow-present",
            severity: "info",
            category: "layout",
            message: "Observed outer shadows on layout chrome; decide whether they belong in the draft system or should remain exceptions.",
        });
    }
    if (observation.descriptor.sections.length === 0) {
        findings.push({
            code: "structure.sections-missing",
            severity: "warning",
            category: "structure",
            message: "No explicit contract sections were detected; contract seeding will fall back to a placeholder section.",
        });
    }
    return findings.sort((a, b) => a.code.localeCompare(b.code));
}
function calculateExistingSystem(observation, findings) {
    let score = 0;
    const reasons = [];
    const tokenCount = metadataFromPolicy(observation.tokenPolicies.typography).length +
        metadataFromPolicy(observation.tokenPolicies.layout).length +
        metadataFromPolicy(observation.tokenPolicies.motion).length;
    if (tokenCount >= 3) {
        score += 0.35;
        reasons.push("Repeated token references were detected across multiple UI categories.");
    }
    if (observation.designSystemComponents.length > 0) {
        score += 0.2;
        reasons.push("Shared design-system component imports were detected.");
    }
    if (observation.colorAllowedValues.some((value) => value.startsWith("var("))) {
        score += 0.15;
        reasons.push("Color usage already includes reusable variable-based values.");
    }
    if ((observation.surfaceIcons?.allowedSources?.length ?? 0) === 1) {
        score += 0.1;
        reasons.push("Icon usage is already consistent around one source library.");
    }
    if (findings.length <= 2) {
        score += 0.2;
        reasons.push("The observed system has a low inconsistency count.");
    }
    const normalizedScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
    return {
        score: normalizedScore,
        mode: normalizedScore >= 0.55 ? "adopt" : "synthesize",
        reasons,
    };
}
function buildClassification(observation) {
    const marketing = [];
    const application = [];
    const routeCount = observation.routes.length;
    const primitiveCounts = new Map((observation.descriptor.primitives ?? []).map((entry) => [entry.role, entry.count]));
    const landing = observation.descriptor.layout.landingPattern;
    const copyRoleCount = observation.copyRoleCount;
    if (routeCount <= 4) {
        marketing.push({
            key: "route.low-complexity",
            label: "Low route complexity",
            weight: 2,
            supports: "marketing",
            value: String(routeCount),
            message: `Only ${routeCount} routes were detected.`,
        });
    }
    if (routeCount >= 6) {
        application.push({
            key: "route.multi-page",
            label: "Multi-route structure",
            weight: 2,
            supports: "application",
            value: String(routeCount),
            message: `Detected ${routeCount} routes, suggesting task-oriented application structure.`,
        });
    }
    if (!observation.authAware) {
        marketing.push({
            key: "auth.none",
            label: "No auth routes",
            weight: 1,
            supports: "marketing",
            value: "false",
            message: "No auth route family was detected.",
        });
    }
    else {
        application.push({
            key: "auth.present",
            label: "Auth routes present",
            weight: 3,
            supports: "application",
            value: "true",
            message: "Auth-aware routing was detected.",
        });
    }
    if (primitiveCounts.get("sidebar")) {
        application.push({
            key: "primitive.sidebar",
            label: "Sidebar primitive",
            weight: 3,
            supports: "application",
            value: String(primitiveCounts.get("sidebar")),
            message: "Sidebar primitives strongly suggest an application surface.",
        });
    }
    if (primitiveCounts.get("auth-shell")) {
        application.push({
            key: "primitive.auth-shell",
            label: "Auth shell",
            weight: 3,
            supports: "application",
            value: String(primitiveCounts.get("auth-shell")),
            message: "Auth-shell primitives were detected.",
        });
    }
    if (landing && landing.topLevelSections.length >= 3) {
        marketing.push({
            key: "landing.top-level",
            label: "Landing section structure",
            weight: 2,
            supports: "marketing",
            value: landing.topLevelSections.join(", "),
            message: "Top-level landing-style sections were detected.",
        });
    }
    if (copyRoleCount >= 3) {
        marketing.push({
            key: "copy-role.dense",
            label: "Copy-role density",
            weight: 2,
            supports: "marketing",
            value: String(copyRoleCount),
            message: "Copy-role markers suggest a marketing-oriented page structure.",
        });
    }
    if (observation.ctaCount >= 2) {
        marketing.push({
            key: "cta.present",
            label: "CTA-oriented structure",
            weight: 2,
            supports: "marketing",
            value: String(observation.ctaCount),
            message: "Repeated CTA signals suggest a marketing-oriented conversion flow.",
        });
    }
    if (observation.heroSignal) {
        marketing.push({
            key: "hero.present",
            label: "Hero signal",
            weight: 1,
            supports: "marketing",
            value: "true",
            message: "A likely hero pattern was detected near the top of the surface.",
        });
    }
    if (observation.routes.some((route) => APPLICATION_ROUTE_HINT.test(route))) {
        application.push({
            key: "route.application-family",
            label: "Application route families",
            weight: 2,
            supports: "application",
            value: observation.routes.filter((route) => APPLICATION_ROUTE_HINT.test(route)).join(", "),
            message: "Detected account/settings/workspace-style routes.",
        });
    }
    if (observation.routes.some((route) => AUTH_ROUTE_HINT.test(route))) {
        application.push({
            key: "route.auth-hint",
            label: "Auth route hint",
            weight: 1,
            supports: "application",
            value: observation.routes.filter((route) => AUTH_ROUTE_HINT.test(route)).join(", "),
            message: "Detected auth-oriented route names.",
        });
    }
    if ((primitiveCounts.get("navigation") ?? 0) > 0 && (primitiveCounts.get("sidebar") ?? 0) === 0 && !observation.authAware) {
        marketing.push({
            key: "primitive.top-nav-only",
            label: "Top-nav without app shell",
            weight: 1,
            supports: "marketing",
            value: String(primitiveCounts.get("navigation") ?? 0),
            message: "Navigation appears without stronger application-shell signals.",
        });
    }
    const marketingScore = marketing.reduce((total, entry) => total + entry.weight, 0);
    const applicationScore = application.reduce((total, entry) => total + entry.weight, 0);
    const topScore = Math.max(marketingScore, applicationScore);
    const kind = topScore < 3
        ? "unknown"
        : marketingScore === applicationScore || Math.abs(marketingScore - applicationScore) <= 1
            ? "unknown"
            : marketingScore > applicationScore
                ? "marketing"
                : "application";
    const confidence = kind === "unknown"
        ? 0.4
        : Math.min(0.95, 0.55 + Math.abs(marketingScore - applicationScore) * 0.08);
    const supporting = (kind === "marketing" ? marketing : kind === "application" ? application : [
        ...marketing,
        ...application,
    ])
        .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
        .slice(0, 5);
    const opposing = (kind === "marketing" ? application : kind === "application" ? marketing : [])
        .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
        .slice(0, 3);
    return {
        inferredKind: kind,
        confidence: Number(confidence.toFixed(2)),
        requiresConfirmation: kind === "unknown" || confidence < 0.7,
        scores: {
            marketing: marketingScore,
            application: applicationScore,
            unknown: kind === "unknown" ? 1 : 0,
        },
        supporting,
        opposing,
    };
}
function createMarketingProfiles(surfaceId, observation) {
    const layoutDescriptor = observation.descriptor.layout.landingPattern;
    const typographyDescriptor = observation.descriptor.marketingTypography;
    if (!layoutDescriptor && !typographyDescriptor) {
        return undefined;
    }
    const layoutProfileId = "starter-marketing-layout";
    const typographyProfileId = "starter-marketing-typography";
    const layoutProfiles = layoutDescriptor
        ? [
            {
                id: layoutProfileId,
                description: `Starter marketing layout profile for ${surfaceId}.`,
                heroContainerMode: layoutDescriptor.heroContainerMode ?? "open-flow",
                heroVisualPlacement: layoutDescriptor.heroVisualPlacement ?? "none",
                sectionDividerMode: layoutDescriptor.sectionDividerMode ?? "none",
                sectionSpacingProfile: layoutDescriptor.sectionSpacingProfile ?? "compact",
            },
        ]
        : undefined;
    const typographyProfiles = typographyDescriptor && typographyDescriptor.roles.length > 0
        ? [
            {
                id: typographyProfileId,
                description: `Starter marketing typography profile for ${surfaceId}.`,
                roles: typographyDescriptor.roles
                    .filter((role) => role.tokens.length > 0)
                    .map((role) => ({
                    role: role.role,
                    allowedTokens: uniqueSorted(role.tokens.map((token) => token.value)),
                }))
                    .sort((a, b) => a.role.localeCompare(b.role)),
            },
        ]
        : undefined;
    if (!layoutProfiles && !typographyProfiles) {
        return undefined;
    }
    return {
        layout: layoutProfiles,
        typography: typographyProfiles,
    };
}
function applyAnalysisToContract(baseContract, observation, analysis) {
    const sections = observation.descriptor.sections.length > 0
        ? observation.descriptor.sections.map((section) => ({
            id: section.id,
            intent: inferIntentFromSectionId(section.id),
            description: defaultDescriptionFromSection(section.id),
        }))
        : baseContract.sections;
    const requiredSections = observation.descriptor.sections.length > 0
        ? uniqueSorted(observation.descriptor.sections.map((section) => section.id))
        : baseContract.surfaces[0]?.requiredSections ?? [PLACEHOLDER_SECTION_ID];
    const marketingProfiles = analysis.classification.confirmedKind === "marketing"
        ? createMarketingProfiles(baseContract.surfaces[0]?.id ?? analysis.surfaceId, observation)
        : undefined;
    const landingPattern = observation.descriptor.layout.landingPattern;
    const surface = baseContract.surfaces[0];
    const nextSurface = {
        ...surface,
        requiredSections,
        layout: {
            ...surface.layout,
            landingPattern: analysis.classification.confirmedKind === "marketing" && landingPattern
                ? {
                    policy: "warn",
                    requireTopLevelSections: landingPattern.topLevelSections.length > 0
                        ? landingPattern.topLevelSections
                        : undefined,
                    sectionOrder: landingPattern.sectionOrder.length > 0
                        ? landingPattern.sectionOrder
                        : undefined,
                    pageBackgroundMode: landingPattern.pageBackgroundMode === "unknown"
                        ? undefined
                        : landingPattern.pageBackgroundMode,
                    marketingLayoutPolicy: marketingProfiles?.layout?.length ? "warn" : undefined,
                    marketingLayoutProfile: marketingProfiles?.layout?.[0]?.id,
                }
                : surface.layout.landingPattern,
        },
        marketingTypographyPolicy: analysis.classification.confirmedKind === "marketing" &&
            marketingProfiles?.typography?.length
            ? "warn"
            : surface.marketingTypographyPolicy,
        marketingTypographyProfile: analysis.classification.confirmedKind === "marketing"
            ? marketingProfiles?.typography?.[0]?.id
            : undefined,
        phase0: analysis.proposedContract.phase0,
    };
    const nextContract = {
        ...baseContract,
        sections,
        marketingProfiles,
        surfaces: [nextSurface],
        x_extracted: {
            ...(baseContract.x_extracted ?? {}),
            routes: observation.routes,
            hasShell: observation.hasShell,
            authAware: observation.authAware,
            designSystemComponents: observation.designSystemComponents,
            iconSources: observation.surfaceIcons?.allowedSources ?? [],
        },
    };
    return nextContract;
}
function buildDraftArtifact(analysis, observation) {
    const typographyTokens = metadataFromPolicy(observation.tokenPolicies.typography);
    const layoutTokens = metadataFromPolicy(observation.tokenPolicies.layout);
    const motionTokens = metadataFromPolicy(observation.tokenPolicies.motion);
    const canonicalColors = analysis.extracted.colors
        .filter((entry) => entry.count > 0)
        .map((entry) => entry.canonical);
    const typographyFamilies = analysis.extracted.fonts.map((entry) => entry.value);
    const roleCoverage = observation.descriptor.marketingTypography?.roles.map((role) => role.role) ?? [];
    const structurePatterns = [];
    if (analysis.classification.confirmedKind === "marketing") {
        structurePatterns.push("landing");
    }
    if (analysis.classification.confirmedKind === "application") {
        structurePatterns.push("task-oriented");
    }
    if (analysis.extracted.hasShell) {
        structurePatterns.push("shell");
    }
    const manualFollowUp = analysis.inconsistencies.findings.map((finding) => finding.message);
    if (analysis.sourceHealth.status !== "ok") {
        manualFollowUp.push(analysis.sourceHealth.status === "access-denied"
            ? "Capture auth or switch to a local app root to analyze the target surface instead of the gate."
            : "Provide authenticated replay or switch to a local app root to analyze the target surface instead of the login view.");
    }
    if (analysis.classification.requiresConfirmation) {
        manualFollowUp.push("Review the inferred surface kind before tightening policy levels.");
    }
    if (analysis.proposedContract.sectionSeedMode === "placeholder") {
        manualFollowUp.push("Add stable section markers to improve future section-based seeding.");
    }
    return {
        schemaVersion: DEFAULT_ANALYSIS_SCHEMA_VERSION,
        surfaceId: analysis.surfaceId,
        surfaceName: analysis.surfaceName,
        webSurfaceKind: analysis.classification.confirmedKind,
        confidence: analysis.classification.confidence,
        mode: analysis.existingSystem.mode,
        summary: {
            tokenCount: typographyTokens.length + layoutTokens.length + motionTokens.length,
            inconsistencyCount: analysis.inconsistencies.findings.length,
            existingSystemScore: analysis.existingSystem.score,
        },
        categories: {
            typography: {
                canonicalTokens: typographyTokens,
                observedFamilies: typographyFamilies,
                roleCoverage,
                aliases: countAliases(typographyTokens),
                semanticGroups: roleCoverage.length > 0 ? ["copy-roles"] : ["type-scale"],
                outliers: typographyFamilies.length > 2 ? typographyFamilies.slice(2) : [],
            },
            color: {
                canonicalValues: canonicalColors,
                aliases: [],
                semanticGroups: canonicalColors.filter((value) => /background|surface|foreground/i.test(value)).length > 0
                    ? ["surface", "text", "accent"]
                    : ["palette"],
                outliers: canonicalColors.length > 6 ? canonicalColors.slice(6) : [],
            },
            layout: {
                canonicalTokens: layoutTokens,
                maxContentWidth: analysis.extracted.layout.maxContentWidth,
                containers: analysis.extracted.layout.containers,
                radiusPx: analysis.extracted.layout.chrome.maxBorderRadiusPx,
                shadowKinds: analysis.extracted.layout.chrome.shadowKinds,
                semanticGroups: ["container", "shape", "spacing"],
                outliers: analysis.extracted.layout.chrome.shadowKinds.length > 1
                    ? analysis.extracted.layout.chrome.shadowKinds.slice(1)
                    : [],
            },
            motion: {
                canonicalTokens: motionTokens,
                durationsMs: analysis.extracted.motion.map((entry) => entry.durationMs),
                timingFunctions: uniqueSorted(analysis.extracted.motion.map((entry) => entry.timingFunction)),
                aliases: countAliases(motionTokens),
                semanticGroups: ["transition", "animation"],
                outliers: analysis.extracted.motion.length > 2
                    ? analysis.extracted.motion.slice(2).map((entry) => `${entry.durationMs}ms/${entry.timingFunction}`)
                    : [],
            },
            icons: {
                allowedSources: analysis.extracted.iconSources.map((entry) => entry.value),
                outliers: analysis.extracted.iconSources.length > 1
                    ? analysis.extracted.iconSources.slice(1).map((entry) => entry.value)
                    : [],
            },
            structure: {
                sections: analysis.extracted.sections,
                primitives: analysis.extracted.primitives,
                surfacePatterns: structurePatterns,
                outliers: analysis.classification.confirmedKind === "unknown" ? ["mixed-signals"] : [],
            },
        },
        manualFollowUp: uniqueSorted(manualFollowUp),
        warnings: analysis.warnings,
    };
}
async function analyzeLocalSource(options) {
    if (!options.appRoot) {
        throw new Error("Missing appRoot for local-root analysis.");
    }
    const appRoot = path.resolve(options.workspaceRoot, options.appRoot);
    const { contract: extractedContract, report } = await extractContractFromNextApp({
        appRoot,
        surfaceId: options.surfaceId,
    });
    const descriptorContract = buildDescriptorSeedContract(options.surfaceId, options.surfaceName);
    const descriptorResult = await collectSurfaceDescriptors({
        workspaceRoot: options.workspaceRoot,
        contract: descriptorContract,
        surfaceFilters: new Set([options.surfaceId]),
        surfaceRootMap: new Map([[options.surfaceId, appRoot]]),
    });
    const descriptor = descriptorResult.descriptors.find((entry) => entry.surfaceId === options.surfaceId);
    if (!descriptor) {
        throw new Error(`Failed to collect descriptor for surface "${options.surfaceId}".`);
    }
    const uiSeeded = await seedObservedUiContract({
        workspaceRoot: options.workspaceRoot,
        appRoot,
        surfaceId: options.surfaceId,
        contract: extractedContract,
    });
    const colorSeeded = await seedColorPolicyFromObservedDescriptors({
        workspaceRoot: options.workspaceRoot,
        appRoot,
        surfaceId: options.surfaceId,
        contract: uiSeeded.contract,
    });
    const iconSeeded = await seedIconPolicyFromObservedDescriptors({
        workspaceRoot: options.workspaceRoot,
        appRoot,
        surfaceId: options.surfaceId,
        contract: colorSeeded.contract,
    });
    const chromeSeeded = await seedChromePolicyFromObservedDescriptors({
        workspaceRoot: options.workspaceRoot,
        appRoot,
        surfaceId: options.surfaceId,
        contract: iconSeeded.contract,
    });
    return {
        routes: report.extracted.routes,
        hasShell: report.extracted.hasShell,
        authAware: report.extracted.authAware,
        designSystemComponents: report.extracted.designSystemComponents,
        descriptor,
        ctaCount: 0,
        copyRoleCount: descriptor.marketingTypography?.roles.length ?? 0,
        heroSignal: Boolean(descriptor.layout.landingPattern?.heroContainerMode ||
            descriptor.marketingTypography?.roles.some((role) => role.role === "heroTitle")),
        warnings: [
            ...report.warnings,
            ...descriptorResult.warnings.map((warning) => ({
                code: warning.code,
                message: warning.message,
            })),
            ...descriptorResult.errors.map((warning) => ({
                code: warning.code,
                message: warning.message,
            })),
            ...uiSeeded.warnings,
            ...colorSeeded.warnings,
            ...iconSeeded.warnings,
            ...chromeSeeded.warnings,
        ],
        tokenPolicies: chromeSeeded.contract.tokens ?? {},
        colorAllowedValues: chromeSeeded.contract.color.allowedValues,
        surfaceIcons: chromeSeeded.contract.surfaces[0]?.icons,
        sourceAppRoot: appRoot,
        sourceHealth: {
            status: "ok",
            authMode: "none",
            confidence: "full",
        },
    };
}
function extractAttributeValuesFromTags(html, regex) {
    regex.lastIndex = 0;
    const matches = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
        if (value) {
            matches.push(value);
        }
    }
    return uniqueSorted(matches);
}
function parseRemotePrimitives(html, source) {
    const counts = new Map();
    const record = (role, count) => {
        if (count <= 0)
            return;
        counts.set(role, count);
    };
    record("navigation", (html.match(/<nav\b/gi) ?? []).length);
    record("header", (html.match(/<header\b/gi) ?? []).length);
    record("footer", (html.match(/<footer\b/gi) ?? []).length);
    record("sidebar", (html.match(/<aside\b/gi) ?? []).length + (html.match(/\bsidebar\b/gi) ?? []).length);
    record("auth-shell", (html.match(/\b(AuthLayout|AuthShell|SessionProvider)\b/gi) ?? []).length);
    return [...counts.entries()]
        .map(([role, count]) => ({ role, count, sources: [source] }))
        .sort((a, b) => a.role.localeCompare(b.role));
}
function extractRemoteLinks(rawHtml, sourceUrl) {
    const routes = new Set([sourceUrl.pathname || "/"]);
    const authHints = new Set();
    HREF_REGEX.lastIndex = 0;
    let match;
    while ((match = HREF_REGEX.exec(rawHtml)) !== null) {
        const href = match[1] ?? match[2] ?? "";
        if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
            continue;
        }
        try {
            const resolved = new URL(href, sourceUrl);
            if (resolved.origin !== sourceUrl.origin) {
                continue;
            }
            if (/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(resolved.pathname)) {
                continue;
            }
            const route = resolved.pathname.replace(/\/+$/, "") || "/";
            routes.add(route);
            if (AUTH_ROUTE_HINT.test(route)) {
                authHints.add(route);
            }
        }
        catch {
            continue;
        }
    }
    return {
        routes: [...routes].sort((a, b) => a.localeCompare(b)),
        authHints: [...authHints].sort((a, b) => a.localeCompare(b)),
    };
}
function collectInlineCssContents(sourceUrl, html) {
    const results = [];
    INLINE_STYLE_BLOCK_REGEX.lastIndex = 0;
    let styleMatch;
    while ((styleMatch = INLINE_STYLE_BLOCK_REGEX.exec(html)) !== null) {
        if (styleMatch[1]?.trim()) {
            results.push({
                source: `${sourceUrl.origin}/<inline-style>`,
                content: styleMatch[1],
            });
        }
    }
    return results;
}
function collectRemoteTokenPolicies(cssContents) {
    const definitions = new Map();
    const typography = new Map();
    const layout = new Map();
    const motion = new Map();
    const collectObserved = (content, source, regex, category, target) => {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(content)) !== null) {
            const rawValue = match[1]?.trim();
            if (!rawValue || !rawValue.startsWith("var(")) {
                continue;
            }
            const entry = target.get(`${source}:${rawValue}:${category}`) ?? {
                observedValue: rawValue,
                source,
                attributes: new Set(),
            };
            entry.attributes.add(category);
            target.set(`${source}:${rawValue}:${category}`, entry);
        }
    };
    for (const css of cssContents) {
        collectTokenDefinitionsFromContent(css.content, css.source, definitions);
        collectObserved(css.content, css.source, /font-(?:family|size|weight|line-height|letter-spacing)\s*:\s*([^;]+);/gi, "typography", typography);
        collectObserved(css.content, css.source, /(?:padding|margin|max-width|min-width|width|height|gap|border-radius)\s*:\s*([^;]+);/gi, "layout", layout);
        collectObserved(css.content, css.source, /(?:transition|animation)[^:]*:\s*([^;]+);/gi, "motion", motion);
    }
    const toPolicy = (category, values) => {
        const normalized = normalizeObservedTokens(category, new Map([...values.values()].map((entry, index) => [`${entry.source}:${entry.observedValue}:${index}`, entry])), definitions);
        const metadata = buildTokenMetadata(normalized.tokens);
        if (metadata.length === 0) {
            return undefined;
        }
        return {
            policy: "warn",
            allowedTokens: metadata.map((entry) => entry.token),
            tokenMetadata: metadata,
        };
    };
    return {
        typography: toPolicy("typography", typography),
        layout: toPolicy("layout", layout),
        motion: toPolicy("motion", motion),
    };
}
function buildTokenMetadata(tokens) {
    const metadata = new Map();
    for (const token of tokens) {
        const canonical = token.value.trim();
        if (!canonical)
            continue;
        const bucket = metadata.get(canonical) ?? {
            normalizedValue: token.normalizedValue ?? token.observedValue ?? token.value,
            attributes: new Set(),
            aliases: new Set(),
        };
        for (const attribute of token.attributes ?? []) {
            bucket.attributes.add(attribute);
        }
        if (token.observedValue && token.observedValue !== canonical) {
            bucket.aliases.add(token.observedValue);
        }
        metadata.set(canonical, bucket);
    }
    return [...metadata.entries()]
        .map(([token, entry]) => ({
        token,
        normalizedValue: entry.normalizedValue,
        attributes: [...entry.attributes].sort((a, b) => a.localeCompare(b)),
        aliases: [...entry.aliases].sort((a, b) => a.localeCompare(b)),
    }))
        .sort((a, b) => a.token.localeCompare(b.token));
}
async function analyzeRemoteSource(options) {
    if (!options.url) {
        throw new Error("Missing url for remote-url analysis.");
    }
    const sourceUrl = new URL(options.url);
    const observation = options.remoteObservation ?? await observeRemotePage({
        url: sourceUrl.toString(),
        storageState: options.authStorageState,
    });
    const finalUrl = new URL(observation.finalUrl);
    const redactedFinalUrl = redactSensitiveUrl(finalUrl.toString());
    const html = observation.html;
    const cssContents = [
        ...collectInlineCssContents(finalUrl, html),
        ...observation.cssContents,
    ].sort((a, b) => a.source.localeCompare(b.source));
    const routeInfo = extractRemoteLinks(html, finalUrl);
    const primitives = parseRemotePrimitives(html, finalUrl.toString());
    const renderedFonts = summarizeRemoteFontsFromRenderedStyles(redactedFinalUrl, observation.renderedStyles);
    const renderedColors = summarizeRemoteColorsFromRenderedStyles(redactedFinalUrl, observation.renderedStyles);
    const renderedMotions = summarizeRemoteMotionFromRenderedStyles(redactedFinalUrl, observation.renderedStyles);
    const fonts = renderedFonts.length > 0 ? renderedFonts : collectRemoteFontsFromCss(cssContents);
    const colors = renderedColors.length > 0 ? renderedColors : collectRemoteColorsFromCss(cssContents);
    const motions = renderedMotions.length > 0 ? renderedMotions : collectRemoteMotionFromCss(cssContents);
    const maxWidths = [];
    const radii = [];
    const shadowKinds = new Set();
    let pageBackgroundMode = "unknown";
    for (const css of cssContents) {
        MAX_WIDTH_REGEX.lastIndex = 0;
        let match;
        while ((match = MAX_WIDTH_REGEX.exec(css.content)) !== null) {
            const px = parseLengthToPx(`${match[1]}${match[2]}`);
            if (px !== null)
                maxWidths.push(px);
        }
        BORDER_RADIUS_REGEX.lastIndex = 0;
        while ((match = BORDER_RADIUS_REGEX.exec(css.content)) !== null) {
            const px = parseLengthToPx(`${match[1]}${match[2]}`);
            if (px !== null)
                radii.push(px);
        }
        BOX_SHADOW_REGEX.lastIndex = 0;
        while ((match = BOX_SHADOW_REGEX.exec(css.content)) !== null) {
            const shadowKind = classifyShadow(match[1]);
            if (shadowKind)
                shadowKinds.add(shadowKind);
        }
        if (/background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|var\(--background\)|white|rgb\()/i.test(css.content)) {
            pageBackgroundMode = "solid";
        }
        else if (/background(?:-image)?\s*:\s*(linear-gradient|radial-gradient|url\()/i.test(css.content)) {
            pageBackgroundMode = "custom";
        }
    }
    const observedMaxWidths = observation.renderedStyles.maxWidths.length > 0 ? observation.renderedStyles.maxWidths : maxWidths;
    const observedRadii = observation.renderedStyles.radii.length > 0 ? observation.renderedStyles.radii : radii;
    const observedShadowKinds = observation.renderedStyles.shadowKinds.length > 0
        ? observation.renderedStyles.shadowKinds
        : [...shadowKinds];
    const copyRoleCount = extractAttributeValuesFromTags(html, COPY_ROLE_REGEX).length;
    const sections = extractAttributeValuesFromTags(html, SECTION_ATTRIBUTE_REGEX);
    const heroSignal = /<h1\b/i.test(html);
    const ctaCount = (html.match(/<(?:a|button)\b[^>]*>([^<]{0,120})</gi) ?? [])
        .filter((entry) => CTA_TEXT_HINT.test(entry))
        .length;
    const tokenPolicies = collectRemoteTokenPolicies(cssContents);
    const loginOrDeniedDetected = observation.sourceHealth.status !== "ok";
    if (options.authStorageState && finalUrl.hostname !== sourceUrl.hostname) {
        throw new Error(`Authenticated replay for ${sourceUrl.hostname} redirected to ${finalUrl.hostname}. Capture a profile for the final host and retry.`);
    }
    if (options.authStorageState && loginOrDeniedDetected) {
        throw new Error(observation.sourceHealth.status === "access-denied"
            ? `Authenticated replay reached an access-denied page at ${redactSensitiveUrl(finalUrl.toString())}.`
            : `Authenticated replay still resolved to a login page at ${redactSensitiveUrl(finalUrl.toString())}. Re-capture the auth profile and retry.`);
    }
    const descriptor = {
        surfaceId: options.surfaceId,
        sections: sections.map((section) => ({ id: section, source: redactedFinalUrl })),
        fonts: fonts.map((entry) => ({ value: entry.value, source: entry.sources[0] ?? redactedFinalUrl })),
        colors: colors.map((entry) => ({ value: entry.canonical, source: entry.sources[0] ?? redactedFinalUrl })),
        icons: [],
        tokenUsage: {
            typography: metadataToDescriptors(metadataFromPolicy(tokenPolicies.typography)),
            layout: metadataToDescriptors(metadataFromPolicy(tokenPolicies.layout)),
            motion: metadataToDescriptors(metadataFromPolicy(tokenPolicies.motion)),
        },
        marketingTypography: copyRoleCount > 0
            ? {
                roles: [],
                source: redactedFinalUrl,
            }
            : undefined,
        layout: {
            maxContentWidth: observedMaxWidths.length > 0 ? Math.max(...observedMaxWidths) : null,
            containers: uniqueSorted([
                ...observation.renderedStyles.containers,
                ...(html.match(/\bclass=(?:"[^"]*\bcontainer\b[^"]*"|'[^']*\bcontainer\b[^']*')/gi) ?? []).map(() => "container"),
            ]),
            chrome: {
                targets: [],
                maxBorderRadiusPx: observedRadii.length > 0 ? Math.max(...observedRadii) : null,
                shadowKinds: observedShadowKinds.sort((a, b) => a.localeCompare(b)),
            },
            landingPattern: sections.length > 0 || heroSignal
                ? {
                    sectionOrder: sections,
                    topLevelSections: sections,
                    nestedSections: [],
                    pageBackgroundMode,
                    source: redactedFinalUrl,
                }
                : undefined,
        },
        motion: motions.map((entry) => ({
            durationMs: entry.durationMs,
            timingFunction: entry.timingFunction,
            source: entry.sources[0] ?? redactedFinalUrl,
        })),
        primitives,
    };
    return {
        routes: routeInfo.routes,
        hasShell: primitives.some((entry) => entry.role === "navigation" || entry.role === "header"),
        authAware: routeInfo.authHints.length > 0,
        designSystemComponents: [],
        descriptor,
        ctaCount,
        copyRoleCount,
        heroSignal,
        warnings: [
            ...(cssContents.length === 0
                ? [{ code: "remote.css.none-detected", message: "No same-origin CSS was fetched for remote analysis; design-system extraction will be partial." }]
                : []),
            ...(loginOrDeniedDetected && !options.authStorageState
                ? [{
                        code: observation.sourceHealth.status === "access-denied"
                            ? "remote.auth.access-denied-detected"
                            : "remote.auth.login-detected",
                        message: observation.sourceHealth.status === "access-denied"
                            ? "Remote analysis resolved to an access-denied page; results may reflect the gate instead of the target surface."
                            : "Remote analysis resolved to a login page; provide --auth-profile for authenticated replay if this surface is protected.",
                    }]
                : []),
        ],
        tokenPolicies,
        colorAllowedValues: colors.map((entry) => entry.canonical),
        surfaceIcons: undefined,
        sourceHealth: {
            status: observation.sourceHealth.status,
            finalUrl: redactedFinalUrl,
            authMode: observation.sourceHealth.authMode,
            confidence: observation.sourceHealth.confidence,
        },
    };
}
function metadataToDescriptors(metadata) {
    return metadata.map((entry) => ({
        value: entry.token,
        observedValue: entry.aliases[0] ?? entry.token,
        normalizedValue: entry.normalizedValue,
        attributes: entry.attributes,
    }));
}
function buildBaseContract(surfaceId, surfaceName, sourceRef, observation) {
    const requiredContainers = uniqueSorted(observation.descriptor.layout.containers ?? []);
    const sections = observation.descriptor.sections.length > 0
        ? observation.descriptor.sections.map((section) => ({
            id: section.id,
            intent: inferIntentFromSectionId(section.id),
            description: defaultDescriptionFromSection(section.id),
        }))
        : [
            {
                id: PLACEHOLDER_SECTION_ID,
                intent: "placeholder",
                description: "Placeholder section; explicit section markers were not detected.",
            },
        ];
    const requiredSections = observation.descriptor.sections.length > 0
        ? uniqueSorted(observation.descriptor.sections.map((section) => section.id))
        : [PLACEHOLDER_SECTION_ID];
    return {
        contractId: `${surfaceId}.generated`,
        version: DEFAULT_CONTRACT_VERSION,
        description: "Generated by interfacectl first-run onboarding.",
        surfaces: [
            {
                id: surfaceId,
                displayName: surfaceName,
                type: "web",
                requiredSections,
                allowedFonts: observation.descriptor.fonts.length > 0
                    ? uniqueSorted(observation.descriptor.fonts.map((font) => font.value))
                    : ["sans-serif"],
                layout: {
                    maxContentWidth: observation.descriptor.layout.maxContentWidth ?? 1120,
                    requiredContainers: requiredContainers.length > 0 ? requiredContainers : undefined,
                    chromePolicy: observation.descriptor.layout.chrome?.targets?.length
                        ? {
                            policy: "off",
                            targets: observation.descriptor.layout.chrome.targets,
                            maxBorderRadiusPx: observation.descriptor.layout.chrome.maxBorderRadiusPx ?? 0,
                            allowOuterShadow: observation.descriptor.layout.chrome.shadowKinds.includes("outer") ||
                                observation.descriptor.layout.chrome.shadowKinds.includes("mixed"),
                            allowInsetShadow: observation.descriptor.layout.chrome.shadowKinds.includes("inset") ||
                                observation.descriptor.layout.chrome.shadowKinds.includes("mixed"),
                        }
                        : undefined,
                },
                icons: observation.surfaceIcons,
            },
        ],
        sections,
        constraints: {
            motion: {
                allowedDurationsMs: uniquePositiveSortedNumbers(observation.descriptor.motion.map((motion) => motion.durationMs)).length > 0
                    ? uniquePositiveSortedNumbers(observation.descriptor.motion.map((motion) => motion.durationMs))
                    : [120],
                allowedTimingFunctions: uniqueSorted(observation.descriptor.motion.map((motion) => motion.timingFunction)).length > 0
                    ? uniqueSorted(observation.descriptor.motion.map((motion) => motion.timingFunction))
                    : ["linear"],
            },
        },
        color: {
            policy: "warn",
            allowedValues: observation.colorAllowedValues.length > 0
                ? uniqueSorted(observation.colorAllowedValues)
                : [],
        },
        tokens: observation.tokenPolicies,
        x_extracted: {
            routes: observation.routes,
            hasShell: observation.hasShell,
            authAware: observation.authAware,
            designSystemComponents: observation.designSystemComponents,
            iconSources: observation.surfaceIcons?.allowedSources ?? [],
            sourceRef,
        },
    };
}
function buildExtractionReport(options, observation, warnings) {
    const sourceUrl = options.sourceMode === "remote-url" && options.url
        ? redactSensitiveUrl(options.url)
        : options.appRoot
            ? pathToFileURL(path.resolve(options.workspaceRoot, options.appRoot)).toString()
            : undefined;
    return {
        surfaceId: options.surfaceId,
        appRoot: options.sourceMode === "local-root" && options.appRoot
            ? path.resolve(options.workspaceRoot, options.appRoot)
            : options.url,
        sourceHealth: {
            status: observation.sourceHealth.status,
            finalUrl: observation.sourceHealth.finalUrl,
            authMode: observation.sourceHealth.authMode,
            confidence: observation.sourceHealth.confidence,
        },
        warnings,
        extracted: {
            routes: observation.routes,
            hasShell: observation.hasShell,
            designSystemComponents: observation.designSystemComponents,
            authAware: observation.authAware,
            iconSources: observation.surfaceIcons?.allowedSources ?? [],
        },
        onboarding: {
            sourceUrl,
            authMode: options.authMode ?? "none",
            extractMode: options.sourceMode,
            profileName: options.authProfileName,
            profileDomain: options.url ? new URL(options.url).hostname : undefined,
            detection: {
                adapter: options.sourceMode === "local-root" ? "next-app-static-analysis" : "remote-url-observer",
                framework: options.sourceMode === "local-root" ? "nextjs" : "unknown",
                profile: "web-first-run",
            },
        },
    };
}
export async function analyzeSurface(options) {
    const observation = options.sourceMode === "local-root"
        ? await analyzeLocalSource(options)
        : await analyzeRemoteSource(options);
    const findings = buildFindings(observation);
    const classification = buildClassification(observation);
    const confirmedKind = options.surfaceKindOverride ?? classification.inferredKind;
    const phase0 = buildPhase0Seed(observation);
    const analysis = {
        schemaVersion: DEFAULT_ANALYSIS_SCHEMA_VERSION,
        surfaceId: options.surfaceId,
        surfaceName: options.surfaceName,
        source: {
            mode: options.sourceMode,
            appRoot: options.sourceMode === "local-root" && observation.sourceAppRoot
                ? toStableSourcePath(options.workspaceRoot, observation.sourceAppRoot)
                : undefined,
            url: options.url ? redactSensitiveUrl(options.url) : undefined,
        },
        extracted: {
            routes: observation.routes,
            hasShell: observation.hasShell,
            authAware: observation.authAware,
            designSystemComponents: observation.designSystemComponents,
            sections: uniqueSorted(observation.descriptor.sections.map((section) => section.id)),
            sectionCount: observation.descriptor.sections.length,
            fonts: summarizeFonts(observation.descriptor),
            colors: summarizeColors(observation.descriptor),
            motion: summarizeMotion(observation.descriptor),
            iconSources: summarizeIcons(observation.descriptor),
            primitives: observation.descriptor.primitives ?? [],
            layout: {
                maxContentWidth: observation.descriptor.layout.maxContentWidth ?? null,
                containers: observation.descriptor.layout.containers ?? [],
                chrome: {
                    maxBorderRadiusPx: observation.descriptor.layout.chrome?.maxBorderRadiusPx ?? null,
                    shadowKinds: observation.descriptor.layout.chrome?.shadowKinds ?? [],
                },
                landingSignals: {
                    sectionOrder: observation.descriptor.layout.landingPattern?.sectionOrder ?? [],
                    topLevelSections: observation.descriptor.layout.landingPattern?.topLevelSections ?? [],
                    nestedSections: observation.descriptor.layout.landingPattern?.nestedSections ?? [],
                    pageBackgroundMode: observation.descriptor.layout.landingPattern?.pageBackgroundMode ?? "unknown",
                    heroSignal: observation.heroSignal,
                    copyRoleCount: observation.copyRoleCount,
                    ctaCount: observation.ctaCount,
                },
            },
            tokens: {
                typography: metadataFromPolicy(observation.tokenPolicies.typography),
                layout: metadataFromPolicy(observation.tokenPolicies.layout),
                motion: metadataFromPolicy(observation.tokenPolicies.motion),
            },
        },
        sourceHealth: {
            status: observation.sourceHealth.status,
            finalUrl: observation.sourceHealth.finalUrl,
            authMode: observation.sourceHealth.authMode,
            confidence: observation.sourceHealth.confidence,
        },
        classification: {
            ...classification,
            confirmedKind,
        },
        existingSystem: calculateExistingSystem(observation, findings),
        inconsistencies: {
            findings,
        },
        proposedContract: {
            phase0,
            sectionSeedMode: observation.descriptor.sections.length > 0 ? "observed" : "placeholder",
            seedCounts: {
                typographyTokens: metadataFromPolicy(observation.tokenPolicies.typography).length,
                layoutTokens: metadataFromPolicy(observation.tokenPolicies.layout).length,
                motionTokens: metadataFromPolicy(observation.tokenPolicies.motion).length,
                colors: observation.colorAllowedValues.length,
                iconSources: observation.surfaceIcons?.allowedSources.length ?? 0,
                sections: observation.descriptor.sections.length,
            },
            suggestedMarketingProfile: confirmedKind === "marketing" &&
                (Boolean(observation.descriptor.layout.landingPattern) ||
                    (observation.descriptor.marketingTypography?.roles.length ?? 0) > 0),
        },
        warnings: observation.warnings.sort((a, b) => a.code.localeCompare(b.code)),
    };
    const baseContract = buildBaseContract(options.surfaceId, options.surfaceName, options.url ? redactSensitiveUrl(options.url) : options.appRoot ?? options.surfaceId, observation);
    const contract = applyAnalysisToContract(baseContract, observation, analysis);
    const extractionReport = buildExtractionReport(options, observation, analysis.warnings);
    const draft = buildDraftArtifact(analysis, observation);
    return {
        analysis,
        draft,
        contract,
        extractionReport,
        descriptor: observation.descriptor,
    };
}
export function stringifyStableArtifact(payload) {
    return `${stableStringify(payload)}\n`;
}
