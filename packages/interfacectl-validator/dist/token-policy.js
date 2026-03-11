const LENGTH_LITERAL_REGEX = /^(-?(?:\d+|\d*\.\d+))(px|rem|em)$/i;
const DURATION_LITERAL_REGEX = /^(-?(?:\d+|\d*\.\d+))(ms|s)$/i;
const WHITESPACE_REGEX = /\s+/g;
function formatNumber(value) {
    if (Number.isInteger(value)) {
        return String(value);
    }
    return value.toFixed(4).replace(/\.?0+$/, "");
}
function normalizeTypographyValue(input) {
    const trimmed = input.trim();
    if (!trimmed)
        return null;
    return trimmed
        .split(",")
        .map((part) => part.trim().replace(/^['"]|['"]$/g, "").toLowerCase())
        .filter(Boolean)
        .join(", ");
}
function normalizeLayoutValue(input) {
    const trimmed = input.trim();
    if (!trimmed)
        return null;
    if (/^0(?:[a-z%]+)?$/i.test(trimmed)) {
        return "0px";
    }
    const literalMatch = trimmed.match(LENGTH_LITERAL_REGEX);
    if (literalMatch) {
        const numericValue = Number.parseFloat(literalMatch[1]);
        if (!Number.isFinite(numericValue))
            return null;
        const unit = literalMatch[2].toLowerCase();
        const pxValue = unit === "px" ? numericValue : numericValue * 16;
        return `${formatNumber(pxValue)}px`;
    }
    return trimmed.toLowerCase().replace(WHITESPACE_REGEX, " ");
}
function normalizeMotionValue(input) {
    const trimmed = input.trim();
    if (!trimmed)
        return null;
    if (/^0(?:ms|s)?$/i.test(trimmed)) {
        return "0ms";
    }
    const durationMatch = trimmed.match(DURATION_LITERAL_REGEX);
    if (durationMatch) {
        const numericValue = Number.parseFloat(durationMatch[1]);
        if (!Number.isFinite(numericValue))
            return null;
        const unit = durationMatch[2].toLowerCase();
        const msValue = unit === "ms" ? numericValue : numericValue * 1000;
        return `${formatNumber(msValue)}ms`;
    }
    return trimmed.toLowerCase().replace(/\s*,\s*/g, ",").replace(WHITESPACE_REGEX, " ");
}
export function normalizeTokenLiteralValue(category, input) {
    if (category === "typography") {
        return normalizeTypographyValue(input);
    }
    if (category === "layout") {
        return normalizeLayoutValue(input);
    }
    return normalizeMotionValue(input);
}
export function matchTokenPolicy(policy, token) {
    const observedToken = (token.observedValue ?? token.value).trim();
    const canonicalCandidate = token.value.trim();
    const normalizedValue = token.normalizedValue?.trim() || undefined;
    if (!policy || policy.policy === "off") {
        return {
            observedToken,
            canonicalToken: canonicalCandidate || undefined,
            normalizedValue,
            matched: true,
        };
    }
    const allowedTokens = new Set(policy.allowedTokens.map((value) => value.trim()));
    if ((canonicalCandidate && allowedTokens.has(canonicalCandidate)) ||
        (observedToken && allowedTokens.has(observedToken))) {
        return {
            observedToken,
            canonicalToken: canonicalCandidate || observedToken || undefined,
            normalizedValue,
            matched: true,
        };
    }
    for (const metadata of policy.tokenMetadata ?? []) {
        if (!allowedTokens.has(metadata.token)) {
            continue;
        }
        if (metadata.token === canonicalCandidate ||
            metadata.token === observedToken ||
            metadata.aliases.includes(observedToken) ||
            metadata.aliases.includes(canonicalCandidate) ||
            (normalizedValue !== undefined && metadata.normalizedValue === normalizedValue)) {
            return {
                observedToken,
                canonicalToken: metadata.token,
                normalizedValue: normalizedValue ?? metadata.normalizedValue,
                matched: true,
            };
        }
    }
    return {
        observedToken,
        canonicalToken: canonicalCandidate || undefined,
        normalizedValue,
        matched: false,
    };
}
