import AjvModule from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import astSchema from "./schema/ui.surface.ast.schema.json" with {
    type: "json"
};
const frozenBundledUiAstSchema = Object.freeze(astSchema);
function createAjvValidator() {
    const ajv = new AjvModule({
        allErrors: true,
        strict: false,
    });
    addFormats(ajv);
    return ajv;
}
function formatAjvErrors(errors) {
    if (!errors) {
        return [];
    }
    return errors.map((error) => {
        const dataPath = error.instancePath || error.schemaPath;
        const baseMessage = error.message ?? "Validation error";
        if (error.params && Object.keys(error.params).length > 0) {
            return `${dataPath}: ${baseMessage} (${JSON.stringify(error.params)})`;
        }
        return `${dataPath}: ${baseMessage}`;
    });
}
export function getBundledUiAstSchema() {
    return frozenBundledUiAstSchema;
}
function findDuplicate(values) {
    const seen = new Set();
    for (const value of values) {
        if (seen.has(value)) {
            return value;
        }
        seen.add(value);
    }
    return null;
}
function validateSurfaceAst(surface) {
    const errors = [];
    const nodeIds = surface.nodes.map((node) => node.id);
    const duplicateNodeId = findDuplicate(nodeIds);
    if (duplicateNodeId) {
        errors.push(`/surfaces/${surface.id}/nodes must use unique node ids (${duplicateNodeId})`);
    }
    const stateIds = (surface.states ?? []).map((state) => state.id);
    const duplicateStateId = findDuplicate(stateIds);
    if (duplicateStateId) {
        errors.push(`/surfaces/${surface.id}/states must use unique ids (${duplicateStateId})`);
    }
    const platformIds = surface.platforms.map((platform) => platform.platform);
    const duplicatePlatformId = findDuplicate(platformIds);
    if (duplicatePlatformId) {
        errors.push(`/surfaces/${surface.id}/platforms must use unique platform entries (${duplicatePlatformId})`);
    }
    const nodeIdSet = new Set(nodeIds);
    const stateIdSet = new Set(stateIds);
    if (!nodeIdSet.has(surface.rootNodeId)) {
        errors.push(`/surfaces/${surface.id}/rootNodeId must reference a declared node`);
    }
    for (const node of surface.nodes) {
        for (const childId of node.children ?? []) {
            if (!nodeIdSet.has(childId)) {
                errors.push(`/surfaces/${surface.id}/nodes/${node.id}/children references missing node "${childId}"`);
            }
        }
        for (const stateRef of node.stateRefs ?? []) {
            if (!stateIdSet.has(stateRef)) {
                errors.push(`/surfaces/${surface.id}/nodes/${node.id}/stateRefs references missing state "${stateRef}"`);
            }
        }
        if (node.kind === "section" && !node.sectionId) {
            errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare sectionId when kind=section`);
        }
        if (node.kind === "action" && !node.actionIntent) {
            errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare actionIntent when kind=action`);
        }
        if (node.kind === "field" && !node.fieldType) {
            errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare fieldType when kind=field`);
        }
        if (node.kind === "selection" && !node.selectionMode) {
            errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare selectionMode when kind=selection`);
        }
        if (node.kind === "alert" && !node.severity) {
            errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare severity when kind=alert`);
        }
        if (node.kind === "heading") {
            if (!node.textRole) {
                errors.push(`/surfaces/${surface.id}/nodes/${node.id} must declare textRole when kind=heading`);
            }
            if (node.headingLevel !== undefined &&
                (node.headingLevel < 1 || node.headingLevel > 6)) {
                errors.push(`/surfaces/${surface.id}/nodes/${node.id} headingLevel must be between 1 and 6`);
            }
        }
    }
    return errors;
}
export function validateUiAstStructure(astData, schema = frozenBundledUiAstSchema) {
    const ajv = createAjvValidator();
    const validate = ajv.compile(schema);
    const valid = validate(astData);
    if (!valid) {
        return {
            ok: false,
            errors: formatAjvErrors(validate.errors),
        };
    }
    const ast = astData;
    const surfaceIds = ast.surfaces.map((surface) => surface.id);
    const duplicateSurfaceId = findDuplicate(surfaceIds);
    if (duplicateSurfaceId) {
        return {
            ok: false,
            errors: [`/surfaces must use unique surface ids (${duplicateSurfaceId})`],
        };
    }
    const errors = ast.surfaces.flatMap((surface) => validateSurfaceAst(surface));
    if (errors.length > 0) {
        return {
            ok: false,
            errors,
        };
    }
    return {
        ok: true,
        errors: [],
        ast,
    };
}
